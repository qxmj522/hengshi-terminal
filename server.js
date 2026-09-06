/* 衡石资本 · 本地服务器（公开部署时同源托管静态页面 + 行情接口）
 * 1) 静态文件服务
 * 2) 实时行情桥：/api/quotes?codes=sh600519,hk00700 （腾讯行情源，8秒轮询缓存）
 * 3) 全市场搜索：/api/search?q=关键词 （腾讯 smartbox，覆盖A股/港股/美股/指数）
 * 4) 市场预热：POST /api/prepare （后台分块缓存行情）
 * 用户数据仅存浏览器本地，服务器不保存任何用户数据。
 * 零依赖，直接 node server.js 运行。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = __dirname;
const HOST = process.env.HOST || '127.0.0.1'; // 公开部署设为 0.0.0.0
const PORT = Number(process.env.PORT) || 8899;

/* ---------- 管理员凭据（仅存服务器，不被静态服务暴露） ---------- */
const ADMIN_FILE = path.join(ROOT, 'admin.json');
function loadAdmin() {
  try { return JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')); }
  catch (e) {
    const admin = {
      user: 'admin',
      pass: crypto.randomBytes(6).toString('hex'),       // 初始随机密码
      secret: crypto.randomBytes(24).toString('hex')      // 令牌签名密钥
    };
    fs.writeFileSync(ADMIN_FILE, JSON.stringify(admin, null, 2));
    console.log('[admin] 已生成管理员配置 admin.json，初始密码：' + admin.pass);
    return admin;
  }
}
const ADMIN = loadAdmin();

function safeEq(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function makeToken(user) {
  const exp = Date.now() + 3600 * 1000; // 1 小时有效
  const payload = user + ':' + exp;
  const sig = crypto.createHmac('sha256', ADMIN.secret).update(payload).digest('hex');
  return Buffer.from(payload + '.' + sig).toString('base64url');
}
function verifyToken(token) {
  try {
    const s = Buffer.from(token, 'base64url').toString();
    const i = s.lastIndexOf('.');
    const payload = s.slice(0, i), sig = s.slice(i + 1);
    const expect = crypto.createHmac('sha256', ADMIN.secret).update(payload).digest('hex');
    if (!safeEq(sig, expect)) return false;
    const exp = Number(payload.split(':')[1]);
    return Date.now() < exp ? payload.split(':')[0] : false;
  } catch (e) { return false; }
}
const loginFails = new Map(); // ip -> {count, until}，简单防爆破
function tooMany(ip) {
  const r = loginFails.get(ip);
  if (!r) return false;
  if (Date.now() > r.until) { loginFails.delete(ip); return false; }
  return r.count >= 5;
}
function recordFail(ip) {
  const r = loginFails.get(ip) || { count: 0, until: 0 };
  r.count += 1; if (r.count >= 5) r.until = Date.now() + 60000;
  loginFails.set(ip, r);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

/* ================= 行情桥（腾讯 qt.gtimg.cn） ================= */
const Q_CACHE = {};          // tcCode -> { ts, q }
const POLL_SET = new Set();  // 需要轮询的腾讯代码
let lastPollOk = 0;

/* 腾讯代码规范化：hk/us 需大写主体（hkHSI/usAAPL.OQ），沪深京小写 */
function canonTc(t) {
  t = String(t || '').trim();
  const pre = t.slice(0, 2).toLowerCase();
  if (pre === 'us') return 'us' + t.slice(2).split('.')[0].toUpperCase(); // 美股不带交易所后缀
  if (pre === 'hk') return 'hk' + t.slice(2).toUpperCase();
  return t.toLowerCase();
}

function parseGtimg(txt) {
  const out = {};
  const re = /v_([A-Za-z0-9.]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(txt))) out[canonTc(m[1])] = m[2].split('~');
  return out;
}
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }

/* 按市场解析字段（腾讯各市场字段布局不同） */
function mapQuote(tc, a) {
  if (!a || a.length < 35) return null;
  const pre = tc.slice(0, 2);
  const base = {
    tc, name: a[1] || '', price: num(a[3]), prevClose: num(a[4]),
    open: num(a[5]), high: num(a[33]), low: num(a[34]),
    chg: num(a[31]), chgPct: num(a[32]), time: a[30] || ''
  };
  if (pre === 'hk') {
    return Object.assign(base, {
      peT: num(a[39]), peS: num(a[57]), pb: num(a[58]),
      floatCap: num(a[44]), totalCap: num(a[45]), divY: num(a[59])
    });
  }
  if (pre === 'us') {
    return Object.assign(base, { currency: a[35] || 'USD' }); // 美股PE/PB该源不提供
  }
  // A股（sh/sz/bj，含指数）
  return Object.assign(base, {
    turnover: num(a[38]), peT: num(a[39]), volRatio: num(a[49]),
    floatCap: num(a[44]), totalCap: num(a[45]), pb: num(a[46]),
    peDyn: num(a[52]), peS: num(a[53])
  });
}

async function fetchQuotes(codes) {
  if (!codes.length) return;
  const uniq = [...new Set(codes.map(canonTc))];
  for (let i = 0; i < uniq.length; i += 50) {
    const batch = uniq.slice(i, i + 50);
    try {
      const r = await fetch('https://qt.gtimg.cn/q=' + batch.join(','), { signal: AbortSignal.timeout(8000) });
      const txt = new TextDecoder('gbk').decode(Buffer.from(await r.arrayBuffer()));
      const parsed = parseGtimg(txt);
      const now = Date.now();
      for (const tc of batch) {
        const q = mapQuote(tc, parsed[tc]);
        if (q && q.price > 0) { Q_CACHE[tc] = { ts: now, q }; }
      }
      lastPollOk = Date.now();
    } catch (e) { /* 网络异常时保留旧缓存 */ }
  }
}

/* ================= 备用行情源（新浪 hq.sinajs.cn） ================= */
function tcToSina(tc) {
  if (/^(sh|sz|bj)\d{6}$/.test(tc)) return tc;               // A股同码
  if (/^hk\d{5}$/.test(tc)) return 'rt_' + tc;               // 港股 rt_hk00700
  if (/^us[a-z0-9.]+$/i.test(tc)) return 'gb_' + tc.slice(2).toLowerCase(); // 美股 gb_aapl
  return null;                                                // 指数等由腾讯独占
}
function mapQuoteSina(tc, a) {
  if (!a || a.length < 8) return null;
  if (/^hk/.test(tc)) {
    return { tc, name: a[1] || a[0] || '', open: num(a[2]), prevClose: num(a[3]), high: num(a[4]), low: num(a[5]), price: num(a[6]), chg: num(a[7]), chgPct: num(a[8]), peT: num(a[13]), pb: 0, floatCap: 0, totalCap: 0, divY: 0 };
  }
  if (/^us/.test(tc)) {
    const price = num(a[1]), chg = num(a[4]);
    return { tc, name: a[0] || '', price, prevClose: price - chg, open: num(a[5]), high: num(a[6]), low: num(a[7]), chg, chgPct: num(a[2]), peT: 0, pb: 0, floatCap: 0, totalCap: 0, divY: 0 };
  }
  const price = num(a[3]), prevClose = num(a[2]);
  return { tc, name: a[0] || '', open: num(a[1]), prevClose, price, high: num(a[4]), low: num(a[5]), chg: price - prevClose, chgPct: prevClose > 0 ? (price / prevClose - 1) * 100 : 0, peT: 0, pb: 0, floatCap: 0, totalCap: 0, divY: 0 };
}
async function fetchQuotesSina(codes) {
  if (!codes.length) return;
  const pairs = [...new Set(codes.map(canonTc))].map(tc => [tc, tcToSina(tc)]).filter(p => p[1]);
  for (let i = 0; i < pairs.length; i += 60) {
    const chunk = pairs.slice(i, i + 60);
    try {
      const list = chunk.map(p => p[1]).join(',');
      const r = await fetch('https://hq.sinajs.cn/list=' + list, {
        headers: { 'Referer': 'https://finance.sina.com.cn' },
        signal: AbortSignal.timeout(8000)
      });
      const txt = new TextDecoder('gbk').decode(Buffer.from(await r.arrayBuffer()));
      const map = {};
      const re = /var hq_str_([A-Za-z0-9_.]+)="([^"]*)";?/g; let m;
      while ((m = re.exec(txt))) map[m[1]] = m[2].split(',');
      const now = Date.now();
      for (const [tc, sCode] of chunk) {
        const q = mapQuoteSina(tc, map[sCode]);
        if (!q || q.price <= 0) continue;
        if (!Q_CACHE[tc] || Date.now() - Q_CACHE[tc].ts > 60000) Q_CACHE[tc] = { ts: now, q, src: 'sina' };
        else Q_CACHE[tc].q2 = q;   // 双源都有 → 存样本做交叉校验
      }
      lastPollOk = Date.now();
    } catch (e) { /* 新浪异常时保留腾讯结果 */ }
  }
}

/* 双源并行：腾讯主源 + 新浪备源，任一成功即可；价差异常时记录告警 */
async function fetchQuotesMulti(codes) {
  const uniq = [...new Set(codes.map(canonTc))];
  await Promise.allSettled([fetchQuotes(uniq), fetchQuotesSina(uniq)]);
  for (const tc of uniq) {
    const e = Q_CACHE[tc];
    if (e && e.q && e.q2 && e.q.price > 0 && e.q2.price > 0) {
      const diff = Math.abs(e.q.price - e.q2.price) / e.q.price;
      if (diff > 0.05) console.log('[warn] 双源价差异常', tc, '腾讯', e.q.price, '新浪', e.q2.price);
    }
  }
}

/* 8秒轮询已登记代码 */
setInterval(() => { if (POLL_SET.size) fetchQuotesMulti([...POLL_SET]); }, 8000);

/* 市场预热：后台分块抓取该市场全部代码，写入行情缓存（非阻塞，可被新请求覆盖） */
let warmToken = 0;
function warmCache(codes) {
  const token = ++warmToken;
  const uniq = [...new Set(codes.map(canonTc))];
  (async () => {
    for (let i = 0; i < uniq.length; i += 50) {
      if (token !== warmToken) return;      // 新预热请求覆盖旧的
      await fetchQuotesMulti(uniq.slice(i, i + 50));
      await new Promise(r => setTimeout(r, 120)); // 限速，避免冲击上游
    }
  })();
}

/* ================= 搜索桥（smartbox.gtimg.cn） ================= */
async function searchGtimg(q) {
  const r = await fetch('https://smartbox.gtimg.cn/s3/?v=2&q=' + encodeURIComponent(q) + '&t=all', { signal: AbortSignal.timeout(8000) });
  const txt = new TextDecoder('gbk').decode(Buffer.from(await r.arrayBuffer()));
  const m = txt.match(/v_hint="([^"]*)"/);
  if (!m || !m[1]) return [];
  return m[1].split('^').map(seg => {
    const p = seg.split('~');
    if (p.length < 5) return null;
    const market = p[0]; // sh/sz/bj/hk/us/jj...
    const type = p[4];   // GP/GP-A/ZS/KJ...
    if (!['sh', 'sz', 'bj', 'hk', 'us'].includes(market)) return null;
    if (!String(type).startsWith('GP') && type !== 'ZS') return null;
    return { tc: canonTc(market + p[1]), market, code: p[1], name: p[2], type };
  }).filter(Boolean).slice(0, 8);
}

/* ================= HTTP ================= */
function sendJSON(res, obj, code) {
  res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const url = u.pathname;

  /* ---- 实时行情 ---- */
  if (url === '/api/quotes') {
    const codes = (u.searchParams.get('codes') || '').split(',').map(canonTc).filter(Boolean);
    if (!codes.length) return sendJSON(res, { ts: Date.now(), quotes: {} });
    codes.forEach(c => {
      POLL_SET.add(c);
      // 轮询集合限容，防止会话内无限增长
      if (POLL_SET.size > 400) POLL_SET.delete(POLL_SET.values().next().value);
    });
    // 缓存缺失或超过15秒的，先同步取一次
    const need = codes.filter(c => !Q_CACHE[c] || Date.now() - Q_CACHE[c].ts > 15000);
    if (need.length) await fetchQuotesMulti(need);
    const quotes = {};
    codes.forEach(c => { if (Q_CACHE[c]) quotes[c] = Q_CACHE[c].q; });
    sendJSON(res, { ts: Date.now(), lastPollOk, quotes });
    return;
  }

  /* ---- 全市场搜索 ---- */
  if (url === '/api/search') {
    const q = (u.searchParams.get('q') || '').trim();
    if (!q) return sendJSON(res, { results: [] });
    try {
      const results = await searchGtimg(q);
      sendJSON(res, { results });
    } catch (e) { sendJSON(res, { results: [], err: 'upstream' }); }
    return;
  }

  /* ---- 市场预热（POST 一组代码，后台分块缓存行情） ---- */
  if (url === '/api/prepare' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on('end', () => {
      let codes;
      try { codes = JSON.parse(body); } catch (e) { return sendJSON(res, { ok: false }, 400); }
      if (!Array.isArray(codes)) return sendJSON(res, { ok: false }, 400);
      warmCache(codes);
      sendJSON(res, { ok: true, queued: codes.length });
    });
    return;
  }

  /* ---- 管理员登录（校验在服务器端，凭据不进前端） ---- */
  if (url === '/api/admin/login' && req.method === 'POST') {
    const ip = (req.socket.remoteAddress || '') + (req.headers['x-forwarded-for'] || '');
    if (tooMany(ip)) return sendJSON(res, { ok: false, err: '尝试次数过多，请 1 分钟后再试' }, 429);
    let body = '';
    req.on('data', c => { body += c; if (body.length > 1024) req.destroy(); });
    req.on('end', () => {
      let u, p;
      try { const o = JSON.parse(body); u = o.user; p = o.pass; } catch (e) { return sendJSON(res, { ok: false, err: '参数错误' }, 400); }
      if (safeEq(u, ADMIN.user) && safeEq(p, ADMIN.pass)) {
        loginFails.delete(ip);
        sendJSON(res, { ok: true, token: makeToken(ADMIN.user), expiresAt: Date.now() + 3600000 });
      } else {
        recordFail(ip);
        sendJSON(res, { ok: false, err: '账号或密码错误' }, 401);
      }
    });
    return;
  }

  /* ---- 管理员状态（需令牌） ---- */
  if (url === '/api/admin/status' && req.method === 'GET') {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!verifyToken(token)) return sendJSON(res, { ok: false, err: '未授权或登录已过期' }, 401);
    sendJSON(res, {
      ok: true, user: ADMIN.user,
      realMode: Date.now() - lastPollOk < 60000,
      cacheSize: Object.keys(Q_CACHE).length,
      pollSize: POLL_SET.size
    });
    return;
  }

  /* ---- 静态文件 ---- */
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  let fp = path.join(ROOT, url === '/' ? 'index.html' : decodeURIComponent(url));
  if (!path.resolve(fp).startsWith(path.resolve(ROOT))) { res.writeHead(403); res.end(); return; }
  // 公开部署安全：只允许返回网页静态资源，不暴露源码/脚本/点文件
  const ALLOWED = ['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff2'];
  const ext = path.extname(fp).toLowerCase();
  const base = path.basename(fp);
  if (!ALLOWED.includes(ext) || base.startsWith('.') || base === 'server.js' || base === '启动.command') {
    res.writeHead(404); res.end('not found'); return;
  }
  fs.readFile(fp, (e, d) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    const type = MIME[ext] || 'application/octet-stream';
    // 带 ?v= 的静态资源可长期缓存；html 不缓存
    const cacheable = ['.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff2'].includes(ext);
    const cache = cacheable ? 'public, max-age=31536000, immutable' : 'no-cache';
    const compressible = /text|javascript|json|svg|css/.test(type) && d.length > 1024;
    const enc = req.headers['accept-encoding'] || '';
    if (compressible && enc.includes('gzip')) {
      res.writeHead(200, { 'Content-Type': type, 'Content-Encoding': 'gzip', 'Cache-Control': cache });
      res.end(zlib.gzipSync(d));
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': cache });
      res.end(d);
    }
  });
}).listen(PORT, HOST, () => console.log('衡石资本 terminal serving at http://' + HOST + ':' + PORT));
