/* ============================================================
 * engine.js — 行情引擎 / 本地存储 / 计算与格式化
 * 真实数据接入说明：
 *   国泰海通/iFinD 授权完成后，仅需把 Engine.refresh()
 *   内的 tickSimulator() 替换为真实快照接口返回值映射，
 *   其余渲染层、字段计算无需任何改动。
 * ============================================================ */
(function () {
  /* ---------- 确定性随机数（用于历史K线回放） ---------- */
  function hash(str) { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = h << 13 | h >>> 19; } return h >>> 0; }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* ---------- 股票代码规范化与市场判定 ---------- */
  function marketOfCode(code) {
    const c = String(code || '').toUpperCase();
    if (c.startsWith('SH') || c.startsWith('SZ') || c.startsWith('BJ')) return 'CN';
    if (c.startsWith('HK')) return 'HK';
    if (c.startsWith('US')) return 'US';
    return null;
  }
  /* 把任意形式的代码规范成带市场前缀的标准码；无法识别返回 null。
   * 能剥离任意数量的前导市场前缀（处理 SHSH/SHSZ/SZSZ/HKHK/USUS 等畸形重复），
   * 然后按纯代码判定市场：6位数字→A股(按首位)，5位→港股，纯字母→美股。 */
  function canonicalizeCode(input) {
    const c = String(input || '').trim().toUpperCase().split('.')[0];
    if (!c) return null;
    // 剥离所有前导字母（SH/SZ/BJ/HK/US 的任意组合），得到纯数字或纯字母
    const digits = c.replace(/^[A-Z]+/, '');
    if (/^\d{6}$/.test(digits)) {
      const d = digits[0];
      if ('69'.includes(d)) return { code: 'SH' + digits, market: 'CN' };
      if ('03'.includes(d)) return { code: 'SZ' + digits, market: 'CN' };
      if ('48'.includes(d)) return { code: 'BJ' + digits, market: 'CN' };
      return null;
    }
    if (/^\d{5}$/.test(digits)) return { code: 'HK' + digits, market: 'HK' };
    if (/^\d{1,4}$/.test(digits)) return { code: 'HK' + digits.padStart(5, '0'), market: 'HK' };
    // 美股：纯字母 ticker（剥离多余的 US 前缀叠加，如 USUS/USUSAAPL）
    if (/^[A-Z]+$/.test(c)) return { code: 'US' + c.replace(/^(US)+/, ''), market: 'US' };
    return null;
  }

  /* ---------- 本地存储（仅浏览器本地，不上传服务器） ---------- */
  const LS_KEY = 'hengshi_terminal_v1';
  const Store = {
    state: null,
    load() {
      try { this.state = JSON.parse(localStorage.getItem(LS_KEY)) || null; } catch (e) { this.state = null; }
      if (!this.state) this.state = { watchlist: [], compare: [], refreshMs: 10000, orderMap: {}, customTags: [], tagOrder: [] };
      if (!this.state.customTags) this.state.customTags = [];
      if (!this.state.tagOrder) this.state.tagOrder = [];
      if (!this.state.savedAt) this.state.savedAt = 0;
      this.sanitize();   // 规范化代码/去重/修正市场，修复 SHSH/SHSZ 等历史畸形数据
      return this.state;
    },
    /* 规范化 watchlist/compare/orderMap 里的代码并去重，修复历史遗留的畸形前缀（SHSH/SHSZ/SZSZ/HKHK） */
    sanitize() {
      let changed = false;
      const seen = new Set();
      const wl = [];
      (this.state.watchlist || []).forEach(w => {
        if (!w || typeof w !== 'object') return;
        const canon = canonicalizeCode(w.code);
        if (!canon) return;
        if (seen.has(canon.code)) {
          // 重复股票：合并信息，保留更全的一条（补 name/标签/击球点）
          changed = true;
          const exist = wl.find(x => x.code === canon.code);
          if (exist) {
            if (!exist.name && w.name) exist.name = w.name;
            const merged = [...new Set([...(exist.tags || []), ...(w.tags || [])])].slice(0, 5);
            if (merged.length !== (exist.tags || []).length) { exist.tags = merged; }
            if (!exist.strike && w.strike) exist.strike = w.strike;
          }
          return;
        }
        seen.add(canon.code);
        if (w.code !== canon.code) { w.code = canon.code; changed = true; }
        if (w.market !== canon.market) { w.market = canon.market; changed = true; }
        if (!w.name) {
          const s = stockMap[canon.code];
          if (s) { w.name = s.name; changed = true; }
        }
        wl.push(w);
      });
      this.state.watchlist = wl;
      // compare：规范化 + 去重
      const cmp = [];
      const seenC = new Set();
      (this.state.compare || []).forEach(c => {
        const canon = canonicalizeCode(c);
        if (canon && !seenC.has(canon.code)) { seenC.add(canon.code); cmp.push(canon.code); }
        else if (canon) changed = true;
      });
      this.state.compare = cmp.slice(0, 2);
      // orderMap：规范化其中的 code
      const om = {};
      Object.keys(this.state.orderMap || {}).forEach(tag => {
        const arr = [];
        const seenO = new Set();
        (this.state.orderMap[tag] || []).forEach(c => {
          const canon = canonicalizeCode(c);
          if (canon && !seenO.has(canon.code)) { seenO.add(canon.code); arr.push(canon.code); }
          else if (canon) changed = true;
        });
        om[tag] = arr;
      });
      this.state.orderMap = om;
      if (changed) this.save();
    },
    save() {
      this.state.savedAt = Date.now();
      localStorage.setItem(LS_KEY, JSON.stringify(this.state));
    },

    inWatch(code) { return this.state.watchlist.some(w => w.code === code); },
    getWatch(code) { return this.state.watchlist.find(w => w.code === code); },
    addWatch(code, tag) {
      const canon = canonicalizeCode(code);
      if (!canon) return;
      code = canon.code;
      if (this.inWatch(code)) return;
      this.state.watchlist.push({ code, market: canon.market, tags: tag ? [tag] : [], strike: '', addedAt: Date.now() });
      this.save();
    },
    removeWatch(code) { this.state.watchlist = this.state.watchlist.filter(w => w.code !== code); this.save(); },
    setTags(code, tags) { const w = this.getWatch(code); if (w) { w.tags = tags.slice(0, 5); this.save(); } },
    setStrike(code, val) { const w = this.getWatch(code); if (w) { w.strike = val; this.save(); } },
    allTags() {
      const s = new Set(this.state.customTags || []);
      this.state.watchlist.forEach(w => w.tags.forEach(t => s.add(t)));
      const order = this.state.tagOrder || [];
      const known = order.filter(t => s.has(t));
      const rest = [...s].filter(t => !order.includes(t));
      return known.concat(rest);
    },
    setTagOrder(arr) { this.state.tagOrder = arr; this.save(); },
    addCustomTag(t) {
      if (!this.allTags().includes(t)) {
        this.state.customTags.push(t);
        (this.state.tagOrder || (this.state.tagOrder = [])).push(t);
        this.save();
      }
    },
    renameTag(oldT, newT) {
      this.state.watchlist.forEach(w => {
        const i = w.tags.indexOf(oldT);
        if (i < 0) return;
        if (!w.tags.includes(newT)) w.tags[i] = newT; else w.tags.splice(i, 1);
      });
      this.state.customTags = (this.state.customTags || [])
        .map(t => t === oldT ? newT : t)
        .filter((v, i, a) => a.indexOf(v) === i);
      if (this.state.tagOrder) this.state.tagOrder = this.state.tagOrder.map(t => t === oldT ? newT : t);
      if (this.state.orderMap[oldT]) { this.state.orderMap[newT] = this.state.orderMap[oldT]; delete this.state.orderMap[oldT]; }
      this.save();
    },
    deleteTag(t) {
      this.state.watchlist.forEach(w => { w.tags = w.tags.filter(x => x !== t); });
      this.state.customTags = (this.state.customTags || []).filter(x => x !== t);
      if (this.state.tagOrder) this.state.tagOrder = this.state.tagOrder.filter(x => x !== t);
      delete this.state.orderMap[t];
      this.save();
    },

    /* 个股模块·标签内排序 */
    getOrder(tag) { return this.state.orderMap[tag] || []; },
    moveToTop(tag, code) {
      const arr = (this.state.orderMap[tag] || []).filter(c => c !== code);
      arr.unshift(code);
      this.state.orderMap[tag] = arr; this.save();
    },

    toggleCompare(code) {
      const i = this.state.compare.indexOf(code);
      if (i >= 0) { this.state.compare.splice(i, 1); this.save(); return 'removed'; }
      if (this.state.compare.length >= 2) return 'full';
      this.state.compare.push(code); this.save(); return 'added';
    },
    setCompare(idx, code) { this.state.compare[idx] = code; this.save(); },
    removeCompare(code) { this.state.compare = this.state.compare.filter(c => c !== code); this.save(); },

    setRefresh(ms) { this.state.refreshMs = ms; this.save(); },
    clearAll() { localStorage.removeItem(LS_KEY); this.load(); }
  };

  /* ---------- 股票索引 ---------- */
  const stockMap = {};
  MARKET_DATA.STOCKS.forEach(s => { stockMap[s.code] = s; });
  const indexMap = {};
  MARKET_DATA.INDICES.forEach(s => { indexMap[s.code] = s; });

  /* ---------- 历史K线（确定性回放生成，接入真实源后替换） ---------- */
  function genHistory(stock, days) {
    const rnd = mulberry32(hash(stock.code));
    const bars = [];
    let p = stock.prevClose * (1 - 0.18 - rnd() * 0.25); // 从低位走到基线
    const drift = Math.pow(stock.prevClose / p, 1 / days) - 1;
    const today = new Date();
    let d = new Date(today); d.setDate(d.getDate() - Math.floor(days * 1.5));
    while (bars.length < days) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      const o = p * (1 + (rnd() - 0.5) * stock.vol * 0.7);
      const c = o * (1 + drift + (rnd() - 0.5) * stock.vol * 1.6);
      const hi = Math.max(o, c) * (1 + rnd() * stock.vol * 0.6);
      const lo = Math.min(o, c) * (1 - rnd() * stock.vol * 0.6);
      bars.push({ date: d.toISOString().slice(0, 10), open: o, high: hi, low: lo, close: c, vol: 0.5 + rnd() * 1.4 });
      p = c;
    }
    // 校正最后一根收盘 = 基线价
    const k = stock.prevClose / bars[bars.length - 1].close;
    bars.forEach(b => { b.open *= k; b.high *= k; b.low *= k; b.close *= k; });
    return bars;
  }
  function aggregate(bars, n) {
    const out = [];
    for (let i = 0; i < bars.length; i += n) {
      const g = bars.slice(i, i + n);
      out.push({ date: g[0].date, open: g[0].open, high: Math.max(...g.map(b => b.high)), low: Math.min(...g.map(b => b.low)), close: g[g.length - 1].close, vol: g.reduce((a, b) => a + b.vol, 0) });
    }
    return out;
  }
  function getBars(stock, period) {
    if (!stock._hist) stock._hist = genHistory(stock, 240);
    if (period === 'week') return aggregate(stock._hist, 5);
    if (period === 'month') return aggregate(stock._hist, 21);
    return stock._hist;
  }
  /* 分时序列（日内） */
  function genIntraday(stock) {
    const rnd = mulberry32(hash(stock.code + 'day'));
    const pts = []; let p = stock.prevClose * (1 + (rnd() - 0.5) * 0.006);
    for (let i = 0; i < 242; i++) { p = p * (1 + (rnd() - 0.5) * stock.vol * 0.16); pts.push(p); }
    const k = stock.price / pts[pts.length - 1]; // 收盘对齐当前价
    return pts.map(v => v * k);
  }

  /* ---------- 腾讯行情代码映射 ---------- */
  const US_TC = { AAPL: 'usAAPL', TSLA: 'usTSLA', NVDA: 'usNVDA', MSFT: 'usMSFT', GOOG: 'usGOOG', AMZN: 'usAMZN', META: 'usMETA', BABA: 'usBABA', PDD: 'usPDD', NFLX: 'usNFLX', JPM: 'usJPM', MCD: 'usMCD', GS: 'usGS', NIO: 'usNIO', XPEV: 'usXPEV', LI: 'usLI' };
  const IDX_TC = { IDXSH: 'sh000001', IDXSZ: 'sz399001', IDXKC: 'sh000688', IDXHSI: 'hkHSI', IDXHST: 'hkHSTECH', IDXSPX: 'usSPX', IDXIXIC: 'usIXIC', IDXDJI: 'usDJI' };
  function canonTc(t) {
    t = String(t || '').trim();
    const pre = t.slice(0, 2).toLowerCase();
    if (pre === 'us') return 'us' + t.slice(2).split('.')[0].toUpperCase();
    if (pre === 'hk') return 'hk' + t.slice(2).toUpperCase();
    return t.toLowerCase();
  }
  function tcOf(s) {
    if (s.tc) return canonTc(s.tc); // 动态添加的股票直接带tc
    if (s.market === 'SH') return 'sh' + s.code.slice(2);
    if (s.market === 'SZ') return 'sz' + s.code.slice(2);
    if (s.market === 'BJ') return 'bj' + s.code.slice(2);
    if (s.market === 'HK') return 'hk' + s.code.slice(2);
    if (s.market === 'US') return US_TC[s.code.slice(2)] || ('us' + s.code.slice(2));
    return null;
  }
  /* ---------- 浏览器直连腾讯行情（无后端/静态托管降级；腾讯 qt.gtimg.cn 带 CORS:*） ---------- */
  function numV(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
  function parseGtimg(txt) {
    const out = {};
    const re = /v_([A-Za-z0-9.]+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(txt))) out[canonTc(m[1])] = m[2].split('~');
    return out;
  }
  function mapQuote(tc, a) {
    if (!a || a.length < 35) return null;
    const pre = tc.slice(0, 2);
    const base = {
      tc, name: a[1] || '', price: numV(a[3]), prevClose: numV(a[4]),
      open: numV(a[5]), high: numV(a[33]), low: numV(a[34]), chgPct: numV(a[32])
    };
    if (pre === 'hk') return Object.assign(base, { peT: numV(a[39]), peS: numV(a[57]), pb: numV(a[58]), floatCap: numV(a[44]), totalCap: numV(a[45]), divY: numV(a[59]) });
    if (pre === 'us') return base; // 美股 PE/PB 该源不提供
    return Object.assign(base, { peT: numV(a[39]), floatCap: numV(a[44]), totalCap: numV(a[45]), pb: numV(a[46]), peDyn: numV(a[52]), peS: numV(a[53]) });
  }
  async function fetchQuotesDirect(tcs) {
    const uniq = [...new Set(tcs.map(canonTc))];
    const quotes = {};
    for (let i = 0; i < uniq.length; i += 50) {
      const batch = uniq.slice(i, i + 50);
      try {
        const r = await fetch('https://qt.gtimg.cn/q=' + batch.join(','), { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const txt = new TextDecoder('gbk').decode(await r.arrayBuffer());
        const parsed = parseGtimg(txt);
        for (const tc of batch) { const q = mapQuote(tc, parsed[tc]); if (q && q.price > 0) quotes[tc] = q; }
      } catch (e) { /* 直连失败返回空 */ }
    }
    return quotes;
  }
  /* 统一行情取数：优先本地服务器行情桥（双源+缓存），不可用时直连腾讯（静态托管/GitHub Pages） */
  async function fetchQuotes(tcs) {
    try {
      const r = await fetch('/api/quotes?codes=' + tcs.join(','), { signal: AbortSignal.timeout(6000) });
      if (r.ok) { const data = await r.json(); if (data && data.quotes) return data.quotes; }
    } catch (e) { /* fallthrough 到直连 */ }
    return fetchQuotesDirect(tcs);
  }

  /* ---------- 东财基本面数据（前端直连，datacenter.eastmoney.com 带 CORS:*） ---------- */
  function secuCodeOf(code) {
    const c = String(code || '').toUpperCase();
    if (/^SH\d{6}$/.test(c)) return c.slice(2) + '.SH';
    if (/^SZ\d{6}$/.test(c)) return c.slice(2) + '.SZ';
    if (/^BJ\d{6}$/.test(c)) return c.slice(2) + '.BJ';
    if (/^HK\d{5}$/.test(c)) return c.slice(2) + '.HK';
    return null; // 美股暂无
  }
  async function emGet(reportName, filter, sortColumns) {
    try {
      const url = 'https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=' + reportName +
        '&columns=ALL&filter=' + encodeURIComponent(filter) +
        '&pageNumber=1&pageSize=10&sortColumns=' + encodeURIComponent(sortColumns) + '&sortTypes=-1';
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const d = await r.json();
      return (d && d.result && d.result.data) ? d.result.data : null;
    } catch (e) { return null; }
  }
  /* 财务指标：ROE / 净利润 / 营收 / 股本（A股 + 港股） */
  async function fetchFundamental(code) {
    const secu = secuCodeOf(code); if (!secu) return null;
    if (/^HK/.test(code)) return fetchHKFundamental(secu);
    const rows = await emGet('RPT_F10_FINANCE_MAINFINADATA', '(SECUCODE="' + secu + '")', 'REPORT_DATE');
    if (!rows || !rows.length) return null;
    const L = rows[0], P = rows[1] || null;
    return {
      roe: numV(L.ROEJQ),
      profit: numV(L.PARENTNETPROFIT) / 1e8,          // 归母净利润(亿)
      revenue: numV(L.TOTALOPERATEREVE) / 1e8,        // 营业总收入(亿)
      totalShr: numV(L.TOTAL_SHARE) / 1e8,            // 总股本(亿股)
      floatShr: (numV(L.A_FREE_SHARE) + numV(L.B_FREE_SHARE)) / 1e8, // 流通股本(亿股)
      prevShr: P ? numV(P.TOTAL_SHARE) / 1e8 : 0      // 上期总股本(亿股)
    };
  }
  /* 港股财务指标（东财 HKF10 主要指标） */
  async function fetchHKFundamental(secu) {
    const rows = await emGet('RPT_CUSTOM_HKF10_FN_MAININDICATORMAX', '(SECUCODE="' + secu + '")', 'REPORT_DATE');
    if (!rows || !rows.length) return null;
    const L = rows[0];
    return {
      roe: numV(L.ROE_AVG),                           // 平均 ROE(%)
      profit: numV(L.HOLDER_PROFIT) / 1e8,            // 归属股东净利润(亿)
      revenue: numV(L.OPERATE_INCOME) / 1e8,          // 营业收入(亿)
      totalShr: numV(L.ISSUED_COMMON_SHARES) / 1e8,   // 总股本(亿股)
      floatShr: numV(L.HK_COMMON_SHARES) / 1e8,       // 港股流通股本(亿股)
      prevShr: 0,
      peT: numV(L.PE_TTM), pb: numV(L.PB_TTM),        // 港股 PE/PB 东财直接给
      divY: numV(L.DIVIDEND_RATE)                     // 股息率(%)
    };
  }
  /* 分红：每股派息 / 分红总额 */
  async function fetchDividend(code) {
    const secu = secuCodeOf(code); if (!secu) return null;
    const rows = await emGet('RPT_SHAREBONUS_DET', '(SECUCODE="' + secu + '")', 'EX_DIVIDEND_DATE');
    if (!rows || !rows.length) return null;
    const impl = rows.filter(r => String(r.ASSIGN_PROGRESS || '').indexOf('实施') >= 0);
    if (!impl.length) return null;
    const L = impl[0], P = impl[1] || null;
    const dLast = numV(L.PRETAX_BONUS_RMB) / 10;       // 每10股派息 → 每股
    return {
      divLast: dLast,
      divPrev: P ? numV(P.PRETAX_BONUS_RMB) / 10 : 0,
      divTotal: dLast * numV(L.TOTAL_SHARES) / 1e8     // 分红总额(亿)
    };
  }
  /* 回购：近一年回购金额汇总 */
  async function fetchBuyback(code) {
    const c6 = code.slice(2);
    try {
      const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_WEB_GETHGLIST_NEW&columns=ALL&filter=' +
        encodeURIComponent('(DIM_SCODE="' + c6 + '")') + '&pageNumber=1&pageSize=50&sortColumns=UPD&sortTypes=-1&source=WEB';
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const d = await r.json();
      const rows = d && d.result && d.result.data;
      if (!rows || !rows.length) return null;
      const yearAgo = Date.now() - 365 * 86400000;
      let total = 0;
      rows.forEach(r => {
        const t = r.DIM_TRADEDATE ? new Date(String(r.DIM_TRADEDATE).replace(' ', 'T')).getTime() : 0;
        if (t >= yearAgo) total += numV(r.REPURAMOUNT);
      });
      return { buyback: total / 1e8 };
    } catch (e) { return null; }
  }
  /* 单只股票完整数据抓取（行情 + 基本面并行），供详情/搜索优先调用 */
  async function fetchStockData(code) {
    const s = stockMap[code];
    if (!s) return null;
    const tc = tcOf(s);
    const needFund = !s._fund;
    // 行情 + 基本面并行抓取
    const [qs, fin, div, bb] = await Promise.all([
      tc ? fetchQuotes([tc]) : Promise.resolve(null),
      needFund ? fetchFundamental(code) : Promise.resolve(null),
      needFund ? fetchDividend(code) : Promise.resolve(null),
      needFund ? fetchBuyback(code) : Promise.resolve(null)
    ]);
    // 先应用行情（让价格就绪）
    const q = qs && qs[tc];
    if (q && q.price > 0) applyReal(s, q);
    // 再应用基本面（此时价格已就绪，能正确算出 PS / 股息率）
    if (needFund) {
      if (fin || div || bb) applyFundamental(s, fin, div, bb);
      s._fund = true;
    }
    return s;
  }

  /* 应用基本面数据（含可信度校验，异常/缺失保持 0 → 显示"—"） */
  function applyFundamental(s, fin, div, bb) {
    if (fin) {
      if (fin.roe > -100 && fin.roe < 100) s.roe = fin.roe;
      if (fin.profit !== 0) s.profit = fin.profit;
      if (fin.totalShr > 0) { s.totalShr = fin.totalShr; s._fundShr = true; }
      if (fin.floatShr > 0) s.floatShr = fin.floatShr;
      if (fin.prevShr > 0) s.prevShr = fin.prevShr;
      // 港股东财直接给 PE/PB/股息率
      if (fin.peT > 0) s.peT = fin.peT;
      if (fin.pb > 0) s.pb = fin.pb;
      if (fin.divY > 0) s.divY = fin.divY;
      // PS = 总市值 / 营收
      if (fin.revenue > 0 && s.price > 0 && s.totalShr > 0) {
        const ps = (s.price * s.totalShr) / fin.revenue;
        if (ps > 0 && ps < 1000) s.ps = ps;
      }
    }
    if (div) {
      if (div.divLast > 0) s.divLast = div.divLast;
      if (div.divPrev > 0) s.divPrev = div.divPrev;
      if (div.divTotal > 0) s.divTotal = div.divTotal;
      if (div.divLast > 0 && s.price > 0) {
        const dy = div.divLast / s.price * 100;
        if (dy >= 0 && dy < 50) s.divY = dy;
      }
    }
    if (bb && bb.buyback >= 0) s.buyback = bb.buyback;
    s._fund = true;
  }

  /* 导出股票对象的完整字段快照（随备份保存，导入时先展示、后台再刷新） */
  function stockSnapshot(s) {
    if (!s) return null;
    return {
      price: s.price || 0, prevClose: s.prevClose || 0,
      peS: s.peS || 0, peT: s.peT || 0, pb: s.pb || 0, ps: s.ps || 0,
      roe: s.roe || 0, divY: s.divY || 0,
      divLast: s.divLast || 0, divPrev: s.divPrev || 0, divTotal: s.divTotal || 0,
      profit: s.profit || 0, buyback: s.buyback || 0, incentive: s.incentive || 0,
      floatShr: s.floatShr || 0, totalShr: s.totalShr || 0, prevShr: s.prevShr || 0
    };
  }
  /* 把快照恢复到股票对象（导入后立即展示保存时的数据，后台抓取后再覆盖更新） */
  function applySnapshot(s, snap) {
    if (!s || !snap || typeof snap !== 'object') return;
    if (snap.price > 0) s.price = snap.price;
    if (snap.prevClose > 0) s.prevClose = snap.prevClose;
    if (snap.peS > 0) s.peS = snap.peS;
    if (snap.peT > 0) s.peT = snap.peT;
    if (snap.pb > 0) s.pb = snap.pb;
    if (snap.ps > 0) s.ps = snap.ps;
    if (snap.roe) s.roe = snap.roe;
    if (snap.divY) s.divY = snap.divY;
    if (snap.divLast) s.divLast = snap.divLast;
    if (snap.divPrev) s.divPrev = snap.divPrev;
    if (snap.divTotal) s.divTotal = snap.divTotal;
    if (snap.profit) s.profit = snap.profit;
    if (snap.buyback) s.buyback = snap.buyback;
    if (snap.incentive) s.incentive = snap.incentive;
    if (snap.floatShr > 0) s.floatShr = snap.floatShr;
    if (snap.totalShr > 0) { s.totalShr = snap.totalShr; s._fundShr = true; }
    if (snap.prevShr > 0) s.prevShr = snap.prevShr;
    s._snapLoaded = true;
  }

  /* 应用真实行情快照到股票对象 */
  function applyReal(s, q) {
    // 离线时物化的股票（价格为0）首次拿到真实数据：清除已生成的空白历史/分时缓存
    if (s._noquote && q.price > 0) { delete s._hist; delete s.series; delete s._day; s._noquote = false; s._justQuoted = true; }
    s.price = q.price;
    if (q.prevClose > 0) s.prevClose = q.prevClose;
    if (q.open > 0 || q.high > 0 || q.low > 0) {
      const d = s._day || (s._day = { open: q.open || q.price, high: q.price, low: q.price });
      if (q.open > 0) d.open = q.open;
      if (q.high > 0) d.high = Math.max(d.high, q.high);
      if (q.low > 0) d.low = Math.min(d.low, q.low);
    }
    if (q.peT > 0) s.peT = q.peT;
    if (q.peS > 0) s.peS = q.peS;
    if (q.pb > 0) s.pb = q.pb;
    // 股本：东财精确股本优先（_fundShr），否则用腾讯市值反推兜底
    if (!s._fundShr && q.totalCap > 0 && q.price > 0) s.totalShr = q.totalCap * 1e8 / q.price / 1e8;
    if (!s._fundShr && q.floatCap > 0 && q.price > 0) s.floatShr = q.floatCap * 1e8 / q.price / 1e8;
    if (!s.prevShr) s.prevShr = s.totalShr;
    s._real = true;
    if (s.series) { s.series.push(s.price); if (s.series.length > 242) s.series.shift(); }
  }

  /* ---------- 实时引擎：真实行情优先，模拟兜底 ---------- */
  const listeners = [];
  const Engine = {
    timer: null,
    realMode: false,      // 数据源是否在线
    start() {
      this.stop();
      this.timer = setInterval(() => this.refresh(), Store.state.refreshMs);
    },
    stop() { if (this.timer) clearInterval(this.timer); },
    onTick(fn) { listeners.push(fn); },
    emit() { listeners.forEach(f => f()); },
    async refresh() {
      // 1) 尝试真实行情：优先本地行情桥，静态托管(GitHub Pages)时直连腾讯
      let real = false;
      try {
        const tcs = [];
        MARKET_DATA.STOCKS.forEach(s => { const t = tcOf(s); if (t) tcs.push(t); });
        Object.keys(IDX_TC).forEach(k => tcs.push(IDX_TC[k]));
        const byTc = await fetchQuotes(tcs);
        if (byTc && Object.keys(byTc).length) {
          MARKET_DATA.STOCKS.forEach(s => {
            const q = byTc[tcOf(s)];
            if (q && q.price > 0) applyReal(s, q);
            else this.simStock(s);
          });
          MARKET_DATA.INDICES.forEach(x => {
            const q = byTc[IDX_TC[x.code]];
            if (q && q.price > 0) {
              x.price = q.price;
              if (q.prevClose > 0) x.prevClose = q.prevClose;
              x.chgPct = q.chgPct || (x.prevClose ? (x.price / x.prevClose - 1) * 100 : 0);
              if (x.series) { x.series.push(x.price); if (x.series.length > 120) x.series.shift(); }
            }
          });
          real = Object.keys(byTc).length > 0;
        }
      } catch (e) { real = false; }
      // 2) 行情桥不可用时，全体走模拟
      if (!real) MARKET_DATA.STOCKS.forEach(s => this.simStock(s));
      this.realMode = real;
      this.emit();
    },
    simStock(s) {
      const shock = (Math.random() - 0.5) * 2 * s.vol * 0.12;
      let np = s.price * (1 + shock);
      const up = s.prevClose * 1.1, dn = s.prevClose * 0.9;
      s.price = Math.min(up, Math.max(dn, np));
      if (s.series) { s.series.push(s.price); if (s.series.length > 242) s.series.shift(); }
    }
  };

  /* ---------- 动态添加股票（搜索命中入库，行情可后补） ---------- */
  function addDynamicStock(meta, q) {
    // 统一用 canonicalizeCode 规范化：兼容纯代码/带前缀/畸形重复前缀/美股ticker，避免二次叠加前缀
    const canon = canonicalizeCode(meta.code);
    if (!canon) return null;
    const mkt = canon.market === 'CN'
      ? (canon.code.startsWith('SZ') ? 'SZ' : canon.code.startsWith('BJ') ? 'BJ' : 'SH')
      : canon.market; // HK / US
    const code = canon.code;
    if (stockMap[code]) return stockMap[code];
    const price = q && q.price > 0 ? q.price : 0;
    const totalShr = q && q.totalCap > 0 && price > 0 ? q.totalCap * 1e8 / price / 1e8 : 0;
    const floatShr = q && q.floatCap > 0 && price > 0 ? q.floatCap * 1e8 / price / 1e8 : 0;
    const s = {
      code, name: meta.name, market: mkt,
      currency: mkt === 'US' ? 'USD' : mkt === 'HK' ? 'HKD' : 'CNY',
      tc: canonTc(meta.tc),
      price, prevClose: q && q.prevClose > 0 ? q.prevClose : price,
      peS: q && q.peS > 0 ? q.peS : (q && q.peT > 0 ? q.peT : 0),
      peT: q && q.peT > 0 ? q.peT : 0,
      pb: q && q.pb > 0 ? q.pb : 0,
      ps: 0, roe: 0, divY: q && q.divY > 0 ? q.divY : 0,
      divLast: 0, divPrev: 0, divTotal: 0, profit: 0,
      buyback: 0, incentive: 0,
      floatShr, totalShr, prevShr: totalShr,
      vol: mkt === 'US' ? 0.022 : mkt === 'HK' ? 0.018 : 0.014,
      _noquote: !(q && q.price > 0)
    };
    MARKET_DATA.STOCKS.push(s);
    stockMap[code] = s;
    s._dynamic = true;
    if (q) applyReal(s, q);
    return s;
  }

  /* 确保某只股票已入库（自选/对比里存在但尚未物化时，从本地清单补建） */
  function ensureStockInUniverse(code) {
    if (stockMap[code]) return stockMap[code];
    if (!window.STOCK_LIST || !code) return null;
    const canon = canonicalizeCode(code);
    if (!canon) return null;
    if (stockMap[canon.code]) return stockMap[canon.code];
    const mktPrefix = canon.code.slice(0, 2);
    const code6 = canon.code.slice(2);
    for (const it of window.STOCK_LIST) {
      if (it[2] === mktPrefix && it[0] === code6) {
        return addDynamicStock({ code: it[0], name: it[1], market: it[2].toLowerCase(), tc: it[3] }, null);
      }
    }
    return null;
  }
  /* 把自选/对比里所有股票物化入库，保证刷新或导入后仍能显示 */
  function materializeWatchlist() {
    (Store.state.watchlist || []).forEach(w => ensureStockInUniverse(w.code));
    (Store.state.compare || []).forEach(c => ensureStockInUniverse(c));
  }

  /* ---------- 字段计算 ---------- */
  function chgPct(s) { return s.prevClose > 0 ? (s.price / s.prevClose - 1) * 100 : 0; }
  function mktCap(s) { return s.price * s.totalShr * 1e8; }      // 总市值(本币)
  function floatCap(s) { return s.price * s.floatShr * 1e8; }    // 流通市值
  function rollDivY(s) { return s.price > 0 ? (s.divLast + s.divPrev) / s.price * 100 : 0; } // 滚动股息率
  function payout(s) { return s.profit > 0 ? s.divTotal / s.profit * 100 : 0; }              // 股息支付率
  function shareGrow(s) { return s.prevShr > 0 ? (s.totalShr / s.prevShr - 1) * 100 : 0; }   // 股本增多

  /* ---------- 格式化 ---------- */
  const CUR = { CNY: '¥', HKD: 'HK$', USD: '$' };
  function fmtPrice(s) {
    const v = s.price;
    if (!v || v <= 0) return '—';
    return v >= 1000 ? v.toFixed(2) : v >= 10 ? v.toFixed(2) : v.toFixed(3);
  }
  function fmtPct(v, sign) {
    const cls = v > 0.0001 ? 'c-up' : v < -0.0001 ? 'c-down' : 'c-flat';
    const t = (v > 0 && sign !== false ? '+' : '') + v.toFixed(2) + '%';
    return { cls, text: t };
  }
  function fmtCap(v, cur) {
    const c = CUR[cur] || '';
    if (v >= 1e12) return c + (v / 1e12).toFixed(2) + '万亿';
    if (v >= 1e8) return c + (v / 1e8).toFixed(0) + '亿';
    return c + (v / 1e4).toFixed(0) + '万';
  }
  function fmtYi(v, cur) { // 已是“亿”为单位的量
    const c = CUR[cur] || '';
    if (v === 0 || v == null) return '—';
    const neg = v < 0 ? '-' : '';
    return neg + c + Math.abs(v).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + '亿';
  }
  function fmtShares(v) { // 亿股
    if (!v) return '—';
    return v >= 100 ? v.toFixed(0) + '亿' : v.toFixed(2) + '亿';
  }
  function fmtRatio(v, unit) {
    if (v == null || !isFinite(v)) return '—';
    if (v === 0) return '—';
    return v.toFixed(2) + (unit || '');
  }

  window.Engine = Engine;
  window.Store = Store;
  window.Calc = { chgPct, mktCap, floatCap, rollDivY, payout, shareGrow, getBars, genIntraday };
  window.Fmt = { CUR, fmtPrice, fmtPct, fmtCap, fmtYi, fmtShares, fmtRatio };
  window.StockMap = stockMap;
  window.IndexMap = indexMap;
  window.Market = { tcOf, addDynamicStock, ensureStockInUniverse, materializeWatchlist, marketOfCode, canonicalizeCode, applyQuote, fetchQuotes, secuCodeOf, fetchFundamental, fetchDividend, fetchBuyback, applyFundamental, stockSnapshot, applySnapshot, fetchStockData };
  /* 按代码应用行情快照（股票已入库时更新，未入库返回null） */
  function applyQuote(code, q) { const s = stockMap[code]; if (s && q && q.price > 0) { applyReal(s, q); return s; } return s; }
})();
