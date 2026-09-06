/* ============================================================
 * app.js — 视图渲染与交互
 * 视图：首页 / 自选 / 个股 / 行情 / 对比 / 个人账户 + 单股全屏详情
 * ============================================================ */
(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
  }

  /* ---------- 运行时状态 ---------- */
  const UI = {
    view: 'home',
    wlTab: 'all',          // 自选：all/US/HK/CN
    tagTab: null,          // 个股：当前标签
    detailCode: null,
    detailPeriod: 'intraday',
    searchOpen: false,
    searchMarket: 'ALL'    // 搜索市场：ALL/CN/HK/US
  };

  /* ---------- 首次运行演示数据（可在账户页一键清除） ---------- */
  Store.load();
  if (!localStorage.getItem('hengshi_seeded')) {
    const seed = [
      ['SZ000333', '白色家电', '82.00'], ['SH600519', '白酒', '1500'], ['SH600036', '银行', '40'],
      ['HK00700', '互联网', '580'], ['HK09988', '互联网', '105'],
      ['USAAPL', '科技巨头', '300'], ['USNVDA', '半导体', '160']
    ];
    seed.forEach(([code, tag, strike]) => { Store.addWatch(code, tag); Store.setStrike(code, strike); });
    Store.state.compare = ['SH600519', 'SH601211'];
    Store.save();
    localStorage.setItem('hengshi_seeded', '1');
  }

  function findStock(q) {
    q = q.trim().toLowerCase();
    if (!q) return null;
    return MARKET_DATA.STOCKS.find(s =>
      s.code.toLowerCase() === q || s.code.toLowerCase().replace(/^(sh|sz|hk|us)/, '') === q ||
      s.name.toLowerCase() === q);
  }
  function seriesOf(s) { if (!s.series) s.series = Calc.genIntraday(s); return s.series; }
  /* 解析股票：先查已入库，再查本地全市场清单，最后直接按代码向行情桥查询（保证有响应） */
  async function resolveStock(q) {
    const s = findStock(q);
    if (s) return s;
    const k = q.trim().toLowerCase();
    const canon = Market.canonicalizeCode(q.trim());
    // 1) 本地清单精确匹配
    if (k && window.STOCK_LIST && canon) {
      const mktPrefix = canon.code.slice(0, 2), code6 = canon.code.slice(2);
      let hit = null;
      for (const it of window.STOCK_LIST) {
        if (it[2] === mktPrefix && it[0].toLowerCase() === code6.toLowerCase()) { hit = it; break; }
      }
      if (hit) {
        const meta = { code: hit[0], name: hit[1], market: hit[2], tc: hit[3] };
        let quote = null;
        try { const qs = await Market.fetchQuotes([hit[3]]); quote = qs && qs[hit[3]]; } catch (e) {}
        return Market.addDynamicStock(meta, quote);
      }
    }
    // 2) 兜底：直接按规范代码查行情桥（覆盖本地清单之外的可交易代码）
    if (canon) {
      const tc = Market.tcOf
        ? (canon.code.startsWith('SH') || canon.code.startsWith('SZ') || canon.code.startsWith('BJ')
            ? canon.code.toLowerCase()
            : canon.code.slice(0, 2).toLowerCase() + canon.code.slice(2).toUpperCase())
        : canon.code.toLowerCase();
      const mktLower = canon.market === 'CN' ? (canon.code.startsWith('SZ') ? 'sz' : canon.code.startsWith('BJ') ? 'bj' : 'sh') : canon.market.toLowerCase();
      let quote = null;
      try { const qs = await Market.fetchQuotes([tc]); quote = qs && qs[tc]; } catch (e) {}
      if (quote && quote.price > 0) {
        const meta = { code: canon.code.slice(2), name: quote.name || canon.code, market: mktLower, tc };
        return Market.addDynamicStock(meta, quote);
      }
    }
    return null;
  }
  function idxSeries(x) { if (!x.series) { const pts = []; let p = x.prevClose * 0.997; for (let i = 0; i < 80; i++) { p *= 1 + (Math.random() - 0.5) * 0.0012; pts.push(p); } pts[pts.length - 1] = x.price; x.series = pts; } return x.series; }

  function ensureDay(s) {
    if (!s._day) {
      const rnd = Math.random;
      s._day = { open: s.prevClose * (1 + (rnd() - 0.5) * 0.008), high: Math.max(s.price, s.prevClose), low: Math.min(s.price, s.prevClose) };
    }
    s._day.high = Math.max(s._day.high, s.price);
    s._day.low = Math.min(s._day.low, s.price);
    return s._day;
  }

  /* ============================================================
   * 路由
   * ============================================================ */
  function navigate(view) {
    UI.view = view;
    if (('#' + view) !== location.hash) history.replaceState(null, '', '#' + view);
    $$('.main-nav .nav-item, .account-entry').forEach(a => a.classList.toggle('active', a.dataset.view === view));
    closeDetail();
    closeSearch();
    const R = $('#viewRoot');
    ({ home: viewHome, watchlist: viewWatchlist, stocks: viewStocks, market: viewMarket, compare: viewCompare, account: viewAccount })[view](R);
    window.scrollTo(0, 0);
  }

  /* ============================================================
   * 首页
   * ============================================================ */
  function viewHome(R) {
    R.innerHTML = `
      <section class="home-hero">
        <div class="hero-title">洞见全球资本脉搏</div>
        <div class="hero-sub">GLOBAL MARKET INTELLIGENCE TERMINAL</div>
        <div class="search-wrap">
          <div class="search-box">
            <div class="mkt-select" id="mktSelect">
              <button class="mkt-btn" id="mktBtn" type="button"><span id="mktLabel">全部</span><span class="mkt-caret">▾</span></button>
              <div class="mkt-menu hidden" id="mktMenu">
                <div class="mkt-item" data-mkt="ALL">全部市场</div>
                <div class="mkt-item" data-mkt="CN">沪深</div>
                <div class="mkt-item" data-mkt="HK">港股</div>
                <div class="mkt-item" data-mkt="US">美股</div>
              </div>
            </div>
            <span class="search-icon">⌕</span>
            <input class="search-input" id="homeSearch" placeholder="输入股票代码或名称，如 600519 / 茅台 / 腾讯 / AAPL" autocomplete="off">
            <button class="search-btn" id="homeSearchBtn">搜索</button>
          </div>
          <div class="search-results hidden" id="searchResults"></div>
        </div>
        <div class="search-hint">覆盖 <b>A股 · 港股 · 美股</b>，回车直达 · 双击名称查看全屏详情</div>
      </section>
      <section class="ticker-section">
        <div class="container-1700 ticker-head">
          <div class="ticker-title">指数脉搏 · INDEX PULSE</div>
          <div class="session-badge" id="sessionBadge">—</div>
        </div>
        <div class="ticker-viewport"><div class="ticker-track" id="tickerTrack"></div></div>
      </section>`;
    buildTicker();
    const inp = $('#homeSearch');
    let searchDeb = null;
    inp.addEventListener('input', () => {
      clearTimeout(searchDeb);
      const v = inp.value;
      searchDeb = setTimeout(() => renderSearch(v), 250); // 防抖，停止输入250ms后再查询
    });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(searchDeb); renderSearch(inp.value, true); } });
    $('#homeSearchBtn').addEventListener('click', () => renderSearch(inp.value, true));
    // 市场选择器
    const mktBtn = $('#mktBtn'), mktMenu = $('#mktMenu');
    mktBtn.addEventListener('click', e => { e.stopPropagation(); mktMenu.classList.toggle('hidden'); });
    $$('#mktMenu .mkt-item').forEach(item => item.addEventListener('click', () => {
      const mkt = item.dataset.mkt;
      UI.searchMarket = mkt;
      $('#mktLabel').textContent = item.textContent;
      mktMenu.classList.add('hidden');
      prepareMarket(mkt);
      if (inp.value.trim()) renderSearch(inp.value);
      toast(mkt === 'ALL' ? '已切换：全部市场' : '已切换：' + item.textContent + ' · 后台预热该市场行情中');
    }));
    const pre = new URLSearchParams(location.search).get('q');
    if (pre) { inp.value = pre; renderSearch(pre); }
    else inp.focus();
    // 检测行情桥是否在线（file:// 直接打开或后端未启动时给出提示）
    fetch('/api/quotes?codes=sh000001').then(r => r.json()).then(d => {
      if (!d.quotes || !Object.keys(d.quotes).length) warnOffline();
    }).catch(warnOffline);
  }

  /* ---------- 指数滚动带（按当地时间分组） ---------- */
  function buildTicker() {
    const sess = MARKET_DATA.sessionIndices(new Date());
    $('#sessionBadge').textContent = '当前时段 · ' + sess.label + '（本地时间）';
    const cards = sess.list.map(code => idxCardHTML(IndexMap[code])).join('');
    const track = $('#tickerTrack');
    track.innerHTML = cards + cards + cards + cards; // 复制实现无缝循环
    // 依据内容宽度设定滚动时长（右→左匀速）
    requestAnimationFrame(() => {
      const w = track.scrollWidth / 4;
      track.style.animationDuration = Math.max(18, w / 47) + 's';
    });
    track.querySelectorAll('canvas').forEach(cv => {
      const x = IndexMap[cv.dataset.idx];
      Charts.spark(cv, idxSeries(x));
    });
  }
  function warnOffline() {
    const b = $('#sessionBadge');
    if (b) b.textContent = '行情桥未连接 · 双击「启动.command」后访问 http://127.0.0.1:8899 获取实时行情';
  }
  function idxCardHTML(x) {
    const f = Fmt.fmtPct(x.chgPct);
    return `<div class="idx-card" data-idx="${x.code}">
      <div class="idx-top"><span class="idx-name">${x.name}</span><span class="idx-mkt">${x.en}</span></div>
      <div class="idx-value ${f.cls}" data-f="val">${x.price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      <div class="idx-bottom">
        <span class="idx-chg ${f.cls}" data-f="chg">${f.text}</span>
        <canvas class="idx-spark" data-idx="${x.code}" width="120" height="30" style="width:120px;height:30px"></canvas>
      </div>
    </div>`;
  }
  function updateTicker() {
    $$('#tickerTrack .idx-card').forEach(card => {
      const x = IndexMap[card.dataset.idx];
      const f = Fmt.fmtPct(x.chgPct);
      const v = card.querySelector('[data-f=val]'), c = card.querySelector('[data-f=chg]');
      v.textContent = x.price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      v.className = 'idx-value ' + f.cls;
      c.textContent = f.text; c.className = 'idx-chg ' + f.cls;
    });
    $$('#tickerTrack canvas.idx-spark').forEach(cv => Charts.spark(cv, idxSeries(IndexMap[cv.dataset.idx])));
  }

  /* ============================================================
   * 搜索模块（全 A 股本地清单 + 宇宙 + 港美股远端）
   * ============================================================ */
  let searchSeq = 0;
  function marketToCode(m) {
    const mm = { sh: 'SH', sz: 'SZ', bj: 'BJ', hk: 'HK', us: 'US' };
    const pre = mm[m.market] || 'SH';
    return m.market === 'us' ? 'US' + m.code.split('.')[0].toUpperCase() : pre + m.code;
  }
  /* 全市场搜索：宇宙优先，再扫本地全A股清单，最后并入远端港美股 */
  function inMarket(mkt, sel) {
    if (sel === 'ALL') return true;
    if (sel === 'CN') return mkt === 'SH' || mkt === 'SZ' || mkt === 'BJ';
    return mkt === sel;
  }
  function searchAll(q) {
    const k = q.trim().toLowerCase();
    if (!k) return { univ: [], metas: [] };
    const sel = UI.searchMarket;
    const canon = Market.canonicalizeCode(q.trim());
    // 宇宙优先，精确代码置顶
    const univ = MARKET_DATA.STOCKS
      .filter(s => inMarket(s.market, sel) && (s.code.toLowerCase().includes(k) || s.name.toLowerCase().includes(k)))
      .sort((a, b) => (a.code === (canon && canon.code) ? -1 : 0) - (b.code === (canon && canon.code) ? -1 : 0))
      .slice(0, 8);
    const seen = new Set(univ.map(s => s.code));
    const metas = [];
    const push = (it) => {
      const code = it[2] + it[0];
      if (seen.has(code)) return;
      seen.add(code);
      metas.push({ code, name: it[1], market: it[2], tc: it[3] });
    };
    const cap = () => 8 - univ.length;
    if (window.STOCK_LIST) {
      // 1) 代码精确匹配（数字/代码输入最友好）
      for (const it of window.STOCK_LIST) { if (metas.length >= cap()) break; if (!inMarket(it[2], sel)) continue; if (it[0].toLowerCase() === k) push(it); }
      // 2) 代码前缀匹配
      if (metas.length < cap()) for (const it of window.STOCK_LIST) { if (metas.length >= cap()) break; if (!inMarket(it[2], sel)) continue; if (it[0].toLowerCase().startsWith(k)) push(it); }
      // 3) 名称包含匹配
      if (metas.length < cap()) for (const it of window.STOCK_LIST) { if (metas.length >= cap()) break; if (!inMarket(it[2], sel)) continue; if (it[1].toLowerCase().includes(k)) push(it); }
    }
    return { univ, metas };
  }
  /* 市场预热：把所选市场的全部代码交给后端，后台分块缓存行情，加速后续搜索取价 */
  function prepareMarket(mkt) {
    if (!window.STOCK_LIST) return;
    const codes = [];
    for (const it of window.STOCK_LIST) {
      if (mkt === 'CN' && (it[2] === 'SH' || it[2] === 'SZ' || it[2] === 'BJ')) codes.push(it[3]);
      else if (mkt === 'HK' && it[2] === 'HK') codes.push(it[3]);
      else if (mkt === 'US' && it[2] === 'US') codes.push(it[3]);
    }
    if (!codes.length) return;
    fetch('/api/prepare', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(codes)
    }).catch(() => { /* 离线时忽略 */ });
  }
  async function renderSearch(q) {
    const box = $('#searchResults');
    if (!q.trim()) { box.classList.add('hidden'); UI.searchOpen = false; return; }
    UI.searchOpen = true;
    box.classList.remove('hidden');
    const sel = UI.searchMarket;
    const { univ, metas } = searchAll(q);
    const seq = ++searchSeq;

    // 远端智能搜索：仅当本地清单覆盖不全时启用（美股），沪深/港股本地全量，跳过以减压提速
    if (sel === 'US' || sel === 'ALL') {
      try {
        const d = await (await fetch('/api/search?q=' + encodeURIComponent(q.trim()))).json();
        if (seq === searchSeq && UI.view === 'home' && d.results) {
          for (const m of d.results) {
            if (metas.length >= 8 - univ.length) break;
            const mkt = { sh: 'SH', sz: 'SZ', bj: 'BJ', hk: 'HK', us: 'US' }[m.market];
            if (!inMarket(mkt, sel)) continue;
            const code = marketToCode(m);
            if (univ.some(s => s.code === code) || metas.some(x => x.code === code)) continue;
            metas.push({ code, name: m.name, market: m.market, tc: m.tc });
          }
        }
      } catch (e) { /* 行情桥离线时仅本地清单 */ }
    }

    // 立即物化（先不取行情），让名称/代码秒显；价格先显示 "—"
    metas.forEach(m => Market.addDynamicStock(m, null));
    let list = univ.concat(metas.map(m => StockMap[m.code]).filter(Boolean));

    // 兜底：若无结果且输入像代码，直接按代码解析一次，保证有响应
    if (!list.length && seq === searchSeq) {
      const canon = Market.canonicalizeCode(q.trim());
      if (canon) {
        const s = await resolveStock(q.trim());
        if (s && inMarket(s.market, sel)) list = [s];
      }
    }
    renderSearchCards(list, q, sel);   // 立即渲染

    // 后台取行情，到位后原地刷新价格与走势图（不阻塞首次显示）
    if (metas.length && seq === searchSeq) {
      const tcs = metas.map(m => m.tc);
      Market.fetchQuotes(tcs).then(qs => {
        if (seq !== searchSeq || UI.view !== 'home') return;
        metas.forEach(m => { const q = qs && qs[m.tc]; if (q) Market.applyQuote(m.code, q); });
        updateSearch();
      }).catch(() => {});
    }
  }
  function renderSearchCards(hits, q, sel) {
    const box = $('#searchResults');
    if (!hits.length) {
      const mktName = { CN: '沪深', HK: '港股', US: '美股', ALL: '' }[sel || 'ALL'];
      box.innerHTML = `<div class="search-empty">${mktName ? mktName + '市场' : ''}未找到「${esc(q)}」<br><span style="font-size:11px;color:var(--ink-4)">试试完整代码或名称；若代码无误，可切换市场后重试</span></div>`;
      return;
    }
    box.innerHTML = hits.map(s => {
      const f = Fmt.fmtPct(Calc.chgPct(s));
      const inW = Store.inWatch(s.code);
      const inC = Store.state.compare.includes(s.code);
      const w = Store.getWatch(s.code);
      const badge = s._dynamic ? '<span class="tag-chip gold" style="font-size:9px;padding:1px 7px">全市场</span>' : '';
      return `<div class="sr-card" data-code="${s.code}">
        <div class="sr-main">
          <div class="sr-name-row">
            <span class="sr-name" data-act="detail">${esc(s.name)}</span>
            <span class="sr-code" data-act="detail">${s.code}</span>${badge}
          </div>
          <div class="sr-price-row">
            <span class="sr-price ${f.cls}" data-f="price">${Fmt.fmtPrice(s)}</span>
            <span class="${f.cls}" data-f="chg" style="font-size:12.5px">${f.text}</span>
          </div>
          <div class="sr-tags" data-f="tags">${tagsHTML(w ? w.tags : [])}</div>
        </div>
        <canvas class="sr-chart" data-code="${s.code}"></canvas>
        <div class="sr-actions">
          <button class="btn-mini ${inW ? 'danger' : 'primary'}" data-act="watch">${inW ? '取消自选' : '＋ 加入自选'}</button>
          <button class="btn-mini ${inC ? 'danger' : ''}" data-act="compare">${inC ? '移出对比' : '⇄ 加入对比'}</button>
          <button class="btn-mini" data-act="tags" ${inW ? '' : 'disabled style="opacity:.4;cursor:not-allowed"'}>🏷 标签设置</button>
        </div>
      </div>`;
    }).join('');
    box.querySelectorAll('canvas.sr-chart').forEach(cv => {
      const s = StockMap[cv.dataset.code];
      if (s && s.price > 0) Charts.spark(cv, seriesOf(s));
      else {
        const dpr = window.devicePixelRatio || 1;
        const r = cv.getBoundingClientRect();
        cv.width = Math.max(1, r.width * dpr); cv.height = Math.max(1, r.height * dpr);
        const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.fillStyle = '#EEF0F4'; c.fillRect(0, 0, r.width, r.height);
        c.fillStyle = '#A6ACBB'; c.font = '11px -apple-system, "PingFang SC", sans-serif'; c.textAlign = 'center';
        c.fillText('加载中…', r.width / 2, r.height / 2 + 4);
      }
    });
  }
  function updateSearch() {
    if (!UI.searchOpen || UI.view !== 'home') return;
    $$('#searchResults .sr-card').forEach(card => {
      const s = StockMap[card.dataset.code]; if (!s) return;
      const f = Fmt.fmtPct(Calc.chgPct(s));
      const p = card.querySelector('[data-f=price]'), c = card.querySelector('[data-f=chg]');
      if (p) { p.textContent = Fmt.fmtPrice(s); p.className = 'sr-price ' + f.cls; }
      if (c) { c.textContent = f.text; c.className = f.cls; }
      const cv = card.querySelector('canvas.sr-chart');
      if (cv) Charts.spark(cv, seriesOf(s));
    });
  }
  function closeSearch() { const b = $('#searchResults'); if (b) b.classList.add('hidden'); UI.searchOpen = false; }
  document.addEventListener('click', e => { if (!e.target.closest('.search-wrap')) closeSearch(); });
  /* 全局一次绑定：点击外部关闭各类弹出菜单（避免每次渲染重复绑定监听） */
  document.addEventListener('click', e => {
    if (!e.target.closest('.mkt-select')) { const m = document.querySelector('.mkt-menu'); if (m) m.classList.add('hidden'); }
    if (!e.target.closest('.tag-picker')) { const t = document.querySelector('.tag-picker-menu'); if (t) t.classList.add('hidden'); }
  });

  function tagsHTML(tags) {
    if (!tags || !tags.length) return '<span class="tag-empty">暂无标签</span>';
    return tags.map((t, i) => `<span class="tag-chip ${i === 0 ? 'gold' : ''}">${esc(t)}</span>`).join('');
  }

  /* 搜索卡片按钮（事件委托） */
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const card = btn.closest('[data-code]'); if (!card) return;
    const code = card.dataset.code;
    const act = btn.dataset.act;
    if (act === 'detail') return; // 双击处理
    if (act === 'watch') {
      if (Store.inWatch(code)) {
        Store.removeWatch(code); toast('已取消自选 · ' + StockMap[code].name);
        refreshSearchCard(card, code);
      } else {
        askIndustryTag(code, () => refreshSearchCard(card, code));
      }
    }
    if (act === 'compare') {
      const r = Store.toggleCompare(code);
      if (r === 'full') toast('最多同时对比 2 只股票');
      else toast(r === 'added' ? '已加入对比 · ' + StockMap[code].name : '已移出对比');
      refreshSearchCard(card, code);
    }
    if (act === 'tags') { if (Store.inWatch(code)) openTagManager(code, () => refreshSearchCard(card, code)); }
  });
  function refreshSearchCard(card, code) {
    const inp = $('#homeSearch');
    if (UI.view === 'home' && inp) renderSearch(inp.value || StockMap[code].name);
  }
  /* 双击名称/代码 → 全屏详情；双击标签 → 编辑该股标签 */
  document.addEventListener('dblclick', e => {
    const tagChip = e.target.closest('.tag-chip');
    if (tagChip) {
      const host = tagChip.closest('[data-code]'); if (!host) return;
      const code = host.dataset.code;
      if (!Store.inWatch(code)) { toast('请先加入自选，再编辑标签'); return; }
      openTagManager(code, () => {
        if (UI.view === 'home') refreshSearchCard(host, code);   // 搜索结果内编辑后原地刷新，不重置搜索
        else navigate(UI.view);
      });
      return;
    }
    const t = e.target.closest('.sr-name, .sr-code, .cell-name, .cell-code');
    if (!t) return;
    const host = t.closest('[data-code]'); if (!host) return;
    openDetail(host.dataset.code);
  });

  /* ---------- 加入自选 · 行业标签询问框 ---------- */
  function askIndustryTag(code, done) {
    const s = StockMap[code];
    openModal(`
      <div class="modal-title">加入自选 · ${esc(s.name)}</div>
      <div class="modal-q"><b>该股票为什么行业？</b>（输入内容将作为该股票的标签）</div>
      <input class="modal-input" id="mTagInput" placeholder="例如：白酒 / 半导体 / 互联网 / 银行" maxlength="12">
      <div class="modal-actions">
        <div class="tag-picker">
          <button class="btn-ghost" id="mTagPick" type="button">🏷 标签</button>
          <div class="tag-picker-menu hidden" id="mTagMenu"></div>
        </div>
        <button class="btn-ghost" id="mCancel">取消</button>
        <button class="btn-solid" id="mOk">确定加入</button>
      </div>`);
    const inp = $('#mTagInput'); inp.focus();
    const menu = $('#mTagMenu');
    const renderMenu = () => {
      const tags = Store.allTags();
      menu.innerHTML = tags.length
        ? tags.map(t => `<div class="tp-item" data-t="${esc(t)}">${esc(t)}</div>`).join('')
        : '<div class="tp-empty">暂无已有标签，可输入新建</div>';
      menu.querySelectorAll('.tp-item').forEach(item => item.addEventListener('click', e => {
        e.stopPropagation();
        inp.value = item.dataset.t;          // 选择现有标签，无需输入
        menu.classList.add('hidden');
        inp.focus();
      }));
    };
    renderMenu();
    $('#mTagPick').addEventListener('click', e => { e.stopPropagation(); renderMenu(); menu.classList.toggle('hidden'); });
    $('#mCancel').onclick = closeModal;
    $('#mOk').onclick = () => {
      const tag = inp.value.trim();
      if (!tag) { toast('请选择或输入行业标签'); inp.focus(); return; }
      Store.addWatch(code, tag);
      closeModal(); toast('已加入自选 · ' + s.name + '（标签：' + tag + '）');
      done && done();
    };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') $('#mOk').click(); });
  }

  /* ---------- 标签设置（增 / 删，最多5个） ---------- */
  function openTagManager(code, done) {
    const s = StockMap[code];
    const w = Store.getWatch(code); if (!w) return;
    openModal(`
      <div class="modal-title">标签设置 · ${esc(s.name)}</div>
      <div class="modal-count">每只证券最多 5 个标签，当前 <b id="mCnt">${w.tags.length}</b> / 5</div>
      <div class="modal-tags" id="mTags"></div>
      <input class="modal-input" id="mNewTag" placeholder="输入新标签，回车添加" maxlength="12">
      <div class="modal-actions"><button class="btn-solid" id="mDone">完成</button></div>`);
    const render = () => {
      $('#mCnt').textContent = w.tags.length;
      $('#mTags').innerHTML = w.tags.length
        ? w.tags.map((t, i) => `<span class="tag-edit">${esc(t)}<span class="x" data-i="${i}">✕</span></span>`).join('')
        : '<span class="tag-empty">暂无标签，可在下方添加</span>';
      $$('#mTags .x').forEach(x => x.onclick = () => { w.tags.splice(+x.dataset.i, 1); Store.setTags(code, w.tags); render(); });
    };
    render();
    $('#mNewTag').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const v = e.target.value.trim(); if (!v) return;
      if (w.tags.length >= 5) { toast('最多 5 个标签'); return; }
      if (w.tags.includes(v)) { toast('标签已存在'); return; }
      w.tags.push(v); Store.setTags(code, w.tags); e.target.value = ''; render();
    });
    $('#mDone').onclick = () => { closeModal(); done && done(); };
  }

  /* ============================================================
   * 自选 / 个股 共用表格
   * ============================================================ */
  const COLUMNS = [
    { f: 'no', t: '序号', cls: 'c' }, { f: 'tags', t: '股票标签', cls: 'l' },
    { f: 'code', t: '股票代码', cls: 'l' }, { f: 'name', t: '股票名称', cls: 'l' },
    { f: 'price', t: '实时股价' }, { f: 'strike', t: '击球点' },
    { f: 'fcap', t: '流通市值' }, { f: 'tcap', t: '总市值' },
    { f: 'peS', t: 'PE(静)' }, { f: 'peT', t: 'PE(TTM)' }, { f: 'pb', t: 'PB' }, { f: 'ps', t: 'PS' },
    { f: 'roe', t: 'ROE' }, { f: 'divY', t: '股息率' }, { f: 'rollDiv', t: '滚动股息率' },
    { f: 'divTotal', t: '分红总额' }, { f: 'profit', t: '净利润' }, { f: 'payout', t: '股息支付率' },
    { f: 'buyback', t: '回购' }, { f: 'incentive', t: '股权激励' },
    { f: 'floatShr', t: '流通股本' }, { f: 'totalShr', t: '总股本' }, { f: 'shrGrow', t: '股本增多' }
  ];

  function cellHTML(s, f, i) {
    const w = Store.getWatch(s.code);
    const pct = Calc.chgPct(s), fc = Fmt.fmtPct(pct);
    const ratio = s.price / s.prevClose;
    switch (f) {
      case 'no': return `<td class="c row-no" data-f="no">${i + 1}</td>`;
      case 'tags': return `<td class="l" data-f="tags">${tagsHTML(w ? w.tags : [])}</td>`;
      case 'code': return `<td class="l cell-code" data-f="code">${s.code}</td>`;
      case 'name': return `<td class="l cell-name" data-f="name">${esc(s.name)}</td>`;
      case 'price': return `<td class="cell-price ${fc.cls}" data-f="price">${Fmt.fmtPrice(s)}</td>`;
      case 'strike': {
        const hit = w && w.strike !== '' && !isNaN(+w.strike) && s.price <= +w.strike;
        return `<td data-f="strike"><input class="strike-input ${hit ? 'strike-hit' : ''}" data-code="${s.code}" value="${w ? esc(w.strike) : ''}" placeholder="—"></td>`;
      }
      case 'fcap': return `<td data-f="fcap">${Fmt.fmtCap(Calc.floatCap(s), s.currency)}</td>`;
      case 'tcap': return `<td data-f="tcap">${Fmt.fmtCap(Calc.mktCap(s), s.currency)}</td>`;
      case 'peS': return `<td data-f="peS">${Fmt.fmtRatio(s.peS * ratio)}</td>`;
      case 'peT': return `<td data-f="peT">${Fmt.fmtRatio(s.peT * ratio)}</td>`;
      case 'pb': return `<td data-f="pb">${Fmt.fmtRatio(s.pb * ratio)}</td>`;
      case 'ps': return `<td data-f="ps">${Fmt.fmtRatio(s.ps * ratio)}</td>`;
      case 'roe': return `<td data-f="roe">${s.roe ? s.roe.toFixed(1) + '%' : '—'}</td>`;
      case 'divY': return `<td data-f="divY">${s.divY ? (s.divY / ratio).toFixed(2) + '%' : '—'}</td>`;
      case 'rollDiv': return `<td data-f="rollDiv">${Calc.rollDivY(s) ? Calc.rollDivY(s).toFixed(2) + '%' : '—'}</td>`;
      case 'divTotal': return `<td data-f="divTotal">${Fmt.fmtYi(s.divTotal, s.currency)}</td>`;
      case 'profit': return `<td data-f="profit">${Fmt.fmtYi(s.profit, s.currency)}</td>`;
      case 'payout': return `<td data-f="payout">${Calc.payout(s) ? Calc.payout(s).toFixed(1) + '%' : '—'}</td>`;
      case 'buyback': return `<td data-f="buyback">${Fmt.fmtYi(s.buyback, s.currency)}</td>`;
      case 'incentive': return `<td data-f="incentive">${Fmt.fmtYi(s.incentive, s.currency)}</td>`;
      case 'floatShr': return `<td data-f="floatShr">${Fmt.fmtShares(s.floatShr)}</td>`;
      case 'totalShr': return `<td data-f="totalShr">${Fmt.fmtShares(s.totalShr)}</td>`;
      case 'shrGrow': { const g = Calc.shareGrow(s); const gcls = g > 0.05 ? 'c-up' : g < -0.05 ? 'c-down' : ''; return `<td data-f="shrGrow" class="${gcls}">${(g > 0 ? '+' : '') + g.toFixed(2) + '%'}</td>`; }
    }
    return '<td></td>';
  }
  function rowHTML(s, i) {
    return `<tr data-code="${s.code}">${COLUMNS.map(c => cellHTML(s, c.f, i)).join('')}</tr>`;
  }
  function tableHTML(list) {
    return `<div class="table-card"><div class="table-scroll"><table class="data-table">
      <thead><tr>${COLUMNS.map(c => `<th class="${c.cls || ''}">${c.t}</th>`).join('')}</tr></thead>
      <tbody>${list.map((s, i) => rowHTML(s, i)).join('')}</tbody>
    </table></div></div>`;
  }
  /* 10秒一跳：直接更新单元格文本，不做 innerHTML 解析 */
  function updateTable() {
    $$('#viewRoot tbody tr[data-code]').forEach(tr => {
      const s = StockMap[tr.dataset.code]; if (!s) return;
      const ratio = s.price / s.prevClose;
      const fc = Fmt.fmtPct(Calc.chgPct(s));
      const g = Calc.shareGrow(s);
      const val = {
        price: [Fmt.fmtPrice(s), 'cell-price ' + fc.cls],
        fcap: [Fmt.fmtCap(Calc.floatCap(s), s.currency), ''],
        tcap: [Fmt.fmtCap(Calc.mktCap(s), s.currency), ''],
        peS: [Fmt.fmtRatio(s.peS * ratio), ''], peT: [Fmt.fmtRatio(s.peT * ratio), ''],
        pb: [Fmt.fmtRatio(s.pb * ratio), ''], ps: [Fmt.fmtRatio(s.ps * ratio), ''],
        roe: [s.roe ? s.roe.toFixed(1) + '%' : '—', ''],
        divY: [s.divY ? (s.divY / ratio).toFixed(2) + '%' : '—', ''],
        rollDiv: [Calc.rollDivY(s) ? Calc.rollDivY(s).toFixed(2) + '%' : '—', ''],
        divTotal: [Fmt.fmtYi(s.divTotal, s.currency), ''],
        profit: [Fmt.fmtYi(s.profit, s.currency), ''],
        payout: [Calc.payout(s) ? Calc.payout(s).toFixed(1) + '%' : '—', ''],
        buyback: [Fmt.fmtYi(s.buyback, s.currency), ''],
        incentive: [Fmt.fmtYi(s.incentive, s.currency), ''],
        floatShr: [Fmt.fmtShares(s.floatShr), ''],
        totalShr: [Fmt.fmtShares(s.totalShr), ''],
        shrGrow: [(g > 0 ? '+' : '') + g.toFixed(2) + '%', g > 0.05 ? 'c-up' : g < -0.05 ? 'c-down' : '']
      };
      tr.querySelectorAll('td[data-f]').forEach(td => {
        const v = val[td.dataset.f]; if (!v) return;
        td.textContent = v[0];
        if (td.dataset.f === 'price' || td.dataset.f === 'shrGrow') td.className = v[1];
      });
      // 击球点命中状态
      const w = Store.getWatch(s.code);
      const inp = tr.querySelector('.strike-input');
      if (inp && document.activeElement !== inp) {
        const hit = w && w.strike !== '' && !isNaN(+w.strike) && s.price <= +w.strike;
        inp.classList.toggle('strike-hit', !!hit);
      }
    });
  }
  /* 击球点输入 */
  document.addEventListener('change', e => {
    if (!e.target.classList.contains('strike-input')) return;
    const code = e.target.dataset.code;
    const v = e.target.value.trim();
    if (v !== '' && isNaN(+v)) { toast('击球点请输入数字'); e.target.value = Store.getWatch(code)?.strike || ''; return; }
    Store.setStrike(code, v);
    if (v !== '') toast('已设置击球点 · ' + StockMap[code].name + ' → ' + v);
  });

  /* ---------- 抓取自选里 A 股的基本面数据（东财：ROE/净利润/营收/股本/分红/回购） ---------- */
  let fundamentalBusy = false;
  function refreshFundamentals(onDone) {
    if (fundamentalBusy) { onDone && onDone(); return; }
    const codes = Store.state.watchlist.map(w => w.code).filter(c => /^(SH|SZ|BJ)\d{6}$/.test(c));
    if (!codes.length) { onDone && onDone(); return; }
    fundamentalBusy = true;
    const fetchOne = async (code) => {
      const s = StockMap[code]; if (!s) return;
      try {
        const [fin, div, bb] = await Promise.all([
          Market.fetchFundamental(code),
          Market.fetchDividend(code),
          Market.fetchBuyback(code)
        ]);
        if (fin || div || bb) Market.applyFundamental(s, fin, div, bb);
      } catch (e) { /* 单个失败不影响其他 */ }
    };
    (async () => {
      try {
        for (let i = 0; i < codes.length; i += 5) {
          await Promise.all(codes.slice(i, i + 5).map(fetchOne));
        }
      } finally {
        fundamentalBusy = false;
      }
      if (UI.view === 'watchlist') viewWatchlist($('#viewRoot'));
      else if (UI.view === 'stocks') viewStocks($('#viewRoot'));
      onDone && onDone();
    })();
  }

  /* ============================================================
   * 自选模块
   * ============================================================ */
  function viewWatchlist(R) {
    const tabs = [
      ['all', '全部'], ['US', '美股'], ['HK', '港股'], ['CN', '沪深']
    ];
    Store.state.watchlist.forEach(w => Market.ensureStockInUniverse(w.code)); // 兜底：保证自选里的股票一定入库可显示
    const list = Store.state.watchlist
      .map(w => StockMap[w.code]).filter(Boolean)
      .filter(s => UI.wlTab === 'all' ? true : UI.wlTab === 'CN' ? (s.market === 'SH' || s.market === 'SZ' || s.market === 'BJ') : s.market === UI.wlTab);
    R.innerHTML = `<div class="page container-1700">
      <div class="page-head">
        <div class="page-title">我的自选<small>WATCHLIST</small></div>
        <div class="refresh-note"><span class="dot"></span>每 ${Store.state.refreshMs / 1000} 秒实时刷新 · 双击股票名称/代码查看全屏详情</div>
      </div>
      <div class="seg-tabs">${tabs.map(([k, t]) => {
        const cnt = k === 'all' ? Store.state.watchlist.length
          : Store.state.watchlist.map(w => StockMap[w.code]).filter(Boolean)
              .filter(s => k === 'CN' ? (s.market === 'SH' || s.market === 'SZ' || s.market === 'BJ') : s.market === k).length;
        return `<button class="seg-tab ${UI.wlTab === k ? 'active' : ''}" data-tab="${k}">${t}<span class="cnt">${cnt}</span></button>`;
      }).join('')}</div>
      ${list.length ? tableHTML(list) : `<div class="table-card"><div class="table-empty"><div class="big">暂无自选标的</div>回首页搜索股票，点击「加入自选」并设置行业标签</div></div>`}
    </div>`;
    $$('.seg-tab').forEach(b => b.onclick = () => { UI.wlTab = b.dataset.tab; viewWatchlist(R); });
  }

  /* ============================================================
   * 个股模块（按标签分组 + 右键置顶）
   * ============================================================ */
  function viewStocks(R) {
    Store.state.watchlist.forEach(w => Market.ensureStockInUniverse(w.code)); // 兜底：保证标签下的股票一定入库可显示
    const tags = Store.allTags();
    if (!tags.length) {
      R.innerHTML = `<div class="page container-1700">
        <div class="page-head">
          <div class="page-title">个股分组<small>BY TAG</small></div>
          <button class="btn-mini" id="btnEditTags">✎ 编辑标签</button>
        </div>
        <div class="table-card"><div class="table-empty"><div class="big">暂无标签分组</div>点击右上角「编辑标签」新建分组，或在加入自选时设置行业标签</div></div></div>`;
      $('#btnEditTags').onclick = openTagGroupManager;
      return;
    }
    if (!UI.tagTab || !tags.includes(UI.tagTab)) UI.tagTab = tags[0];
    const tag = UI.tagTab;
    // 排序：置顶记录优先，其后按加入时间
    const order = Store.getOrder(tag);
    const list = Store.state.watchlist
      .filter(w => w.tags.includes(tag))
      .map(w => StockMap[w.code]).filter(Boolean)
      .sort((a, b) => {
        const ia = order.indexOf(a.code), ib = order.indexOf(b.code);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1; if (ib >= 0) return 1;
        return (Store.getWatch(a.code).addedAt - Store.getWatch(b.code).addedAt);
      });
    R.innerHTML = `<div class="page container-1700">
      <div class="page-head">
        <div class="page-title">个股分组<small>BY TAG · 右键行可置顶</small></div>
        <div style="display:flex;align-items:center;gap:16px">
          <button class="btn-mini" id="btnEditTags">✎ 编辑标签</button>
          <div class="refresh-note"><span class="dot"></span>每 ${Store.state.refreshMs / 1000} 秒实时刷新 · 右键任意行「移动至顶部」</div>
        </div>
      </div>
      <div class="seg-tabs" id="stockTagTabs">${tags.map(t => {
        const cnt = Store.state.watchlist.filter(w => w.tags.includes(t)).length;
        return `<button class="seg-tab ${UI.tagTab === t ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)}<span class="cnt">${cnt}</span></button>`;
      }).join('')}</div>
      ${list.length ? tableHTML(list) : `<div class="table-card"><div class="table-empty"><div class="big">该标签下暂无股票</div></div></div>`}
    </div>`;
    const tabsEl = $('#stockTagTabs');
    $$('#stockTagTabs .seg-tab').forEach(b => b.onclick = () => {
      if (Date.now() - tagDragTime < 300) return;        // 拖动刚结束，忽略紧随的点击
      UI.tagTab = b.dataset.tag; viewStocks(R);
    });
    $('#btnEditTags').onclick = openTagGroupManager;
    if (tabsEl) initTagDrag(tabsEl);
    /* 右键菜单 */
    $('#viewRoot tbody').addEventListener('contextmenu', e => {
      const tr = e.target.closest('tr[data-code]'); if (!tr) return;
      e.preventDefault();
      showCtx(e.clientX, e.clientY, tr.dataset.code, tag);
    });
  }
  /* ---------- 标签分组管理（新建 / 重命名 / 删除） ---------- */
  function openTagGroupManager() {
    openModal(`
      <div class="modal-title">编辑标签分组</div>
      <div class="modal-count">直接修改名称即可重命名（失焦生效）；删除标签会同时移除所有股票上的该标签</div>
      <div class="gm-list" id="gmTags"></div>
      <input class="modal-input" id="gmNew" placeholder="新建标签名称，回车添加" maxlength="12" style="margin-top:14px">
      <div class="modal-actions"><button class="btn-solid" id="gmDone">完成</button></div>`);
    const render = () => {
      const tags = Store.allTags();
      $('#gmTags').innerHTML = tags.length ? tags.map(t => {
        const cnt = Store.state.watchlist.filter(w => w.tags.includes(t)).length;
        return `<div class="gm-row" data-tag="${esc(t)}">
          <input class="gm-name" value="${esc(t)}" maxlength="12">
          <span class="gm-cnt">${cnt} 只</span>
          <button class="gm-del" title="删除标签">✕</button>
        </div>`;
      }).join('') : '<div class="tag-empty" style="padding:10px 2px">暂无标签，可在下方新建</div>';
    };
    render();
    $('#gmTags').addEventListener('click', e => {
      const del = e.target.closest('.gm-del'); if (!del) return;
      const tag = del.closest('.gm-row').dataset.tag;
      Store.deleteTag(tag);
      if (UI.tagTab === tag) UI.tagTab = null;
      toast('已删除标签 · ' + tag);
      render();
    });
    $('#gmTags').addEventListener('change', e => {
      if (!e.target.classList.contains('gm-name')) return;
      const oldT = e.target.closest('.gm-row').dataset.tag;
      const newT = e.target.value.trim();
      if (!newT || newT === oldT) { e.target.value = oldT; return; }
      if (Store.allTags().includes(newT)) { toast('标签「' + newT + '」已存在'); e.target.value = oldT; return; }
      Store.renameTag(oldT, newT);
      if (UI.tagTab === oldT) UI.tagTab = newT;
      toast('标签已重命名：' + oldT + ' → ' + newT);
      render();
    });
    $('#gmTags').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
    $('#gmNew').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const v = e.target.value.trim(); if (!v) return;
      if (Store.allTags().includes(v)) { toast('标签已存在'); return; }
      Store.addCustomTag(v);
      e.target.value = ''; render();
      toast('已新建标签分组 · ' + v);
    });
    $('#gmDone').onclick = () => { closeModal(); viewStocks($('#viewRoot')); };
  }

  /* ---------- 标签左右拖动排序（覆盖1/3自动让位） ---------- */
  let tagDragTime = 0;
  function initTagDrag(container) {
    let dragEl = null, startX = 0, moved = false;

    /* FLIP：让被顶开的标签平滑滑到新位置 */
    function flipSiblings(except) {
      const tabs = [...container.children];
      const first = new Map(tabs.map(t => [t, t.getBoundingClientRect().left]));
      return function after() {
        tabs.forEach(t => {
          if (t === except) return;
          const delta = first.get(t) - t.getBoundingClientRect().left;
          if (Math.abs(delta) > 0.5) {
            t.style.transition = 'none';
            t.style.transform = 'translateX(' + delta + 'px)';
            t.getBoundingClientRect();
            t.style.transition = 'transform .18s ease';
            t.style.transform = 'translateX(0)';
          }
        });
      };
    }

    container.addEventListener('pointerdown', e => {
      const tab = e.target.closest('.seg-tab'); if (!tab) return;
      dragEl = tab; moved = false;
      startX = e.clientX;
      tab.setPointerCapture(e.pointerId);
      tab.classList.add('dragging');
      document.body.classList.add('no-select');
      e.preventDefault();
    });

    container.addEventListener('pointermove', e => {
      if (!dragEl) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 3) moved = true;
      dragEl.style.transform = 'translateX(' + dx + 'px)';

      // 按 DOM 索引找邻居（重叠时索引不变，仍能正确找到被覆盖的标签）
      if (dx < 0) {
        while (true) {
          const ch = [...container.children];
          const idx = ch.indexOf(dragEl);
          if (idx <= 0) break;
          const left = ch[idx - 1];
          const lr = left.getBoundingClientRect();
          const dr = dragEl.getBoundingClientRect();
          const overlap = lr.right - dr.left;                 // 拖拽标签覆盖左侧标签的宽度
          if (overlap < lr.width / 3) break;
          const beforeLeft = dr.left;
          const flip = flipSiblings(dragEl);
          container.insertBefore(dragEl, left);               // 左侧标签向右让位
          startX -= (beforeLeft - dragEl.getBoundingClientRect().left);
          dragEl.style.transform = 'translateX(' + (e.clientX - startX) + 'px)';
          flip();
        }
      } else if (dx > 0) {
        while (true) {
          const ch = [...container.children];
          const idx = ch.indexOf(dragEl);
          if (idx < 0 || idx >= ch.length - 1) break;
          const right = ch[idx + 1];
          const rr = right.getBoundingClientRect();
          const dr = dragEl.getBoundingClientRect();
          const overlap = dr.right - rr.left;                 // 拖拽标签覆盖右侧标签的宽度
          if (overlap < rr.width / 3) break;
          const beforeLeft = dr.left;
          const flip = flipSiblings(dragEl);
          container.insertBefore(right, dragEl);              // 右侧标签向左让位
          startX += (dragEl.getBoundingClientRect().left - beforeLeft);
          dragEl.style.transform = 'translateX(' + (e.clientX - startX) + 'px)';
          flip();
        }
      }
    });

    function end() {
      if (!dragEl) return;
      dragEl.classList.remove('dragging');
      dragEl.style.transform = '';
      document.body.classList.remove('no-select');
      const order = [...container.children].map(c => c.dataset.tag);
      Store.setTagOrder(order);                              // 持久化标签顺序
      if (moved) tagDragTime = Date.now();                   // 记录拖动结束时刻，抑制紧随的 click
      dragEl = null;
    }
    container.addEventListener('pointerup', end);
    container.addEventListener('pointercancel', end);
  }

  function showCtx(x, y, code, tag) {
    const m = $('#ctxMenu');
    m.innerHTML = `<div class="ctx-item" id="ctxTop">⤒ 移动至顶部</div><div class="ctx-item" id="ctxDetail">⤢ 查看全屏详情</div>`;
    m.classList.remove('hidden');
    const W = m.offsetWidth, H = m.offsetHeight;
    m.style.left = Math.min(x, innerWidth - W - 8) + 'px';
    m.style.top = Math.min(y, innerHeight - H - 8) + 'px';
    $('#ctxTop').onclick = () => {
      Store.moveToTop(tag, code); hideCtx();
      toast('已置顶 · ' + StockMap[code].name);
      viewStocks($('#viewRoot'));
    };
    $('#ctxDetail').onclick = () => { hideCtx(); openDetail(code); };
  }
  function hideCtx() { $('#ctxMenu').classList.add('hidden'); }
  document.addEventListener('click', e => { if (!e.target.closest('#ctxMenu')) hideCtx(); });

  /* ============================================================
   * 行情模块
   * ============================================================ */
  function viewMarket(R) {
    const idxCards = MARKET_DATA.INDICES.map(x => {
      const f = Fmt.fmtPct(x.chgPct);
      return `<div class="mkt-card" data-idx="${x.code}">
        <div class="idx-top"><span class="idx-name">${x.name}</span><span class="idx-mkt">${x.en}</span></div>
        <div class="idx-value ${f.cls}" data-f="val" style="margin:10px 0 4px">${x.price.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</div>
        <div class="idx-bottom"><span class="idx-chg ${f.cls}" data-f="chg">${f.text}</span>
        <canvas class="idx-spark" data-idx="${x.code}" width="130" height="32" style="width:130px;height:32px"></canvas></div>
      </div>`;
    }).join('');
    const movers = [...MARKET_DATA.STOCKS].sort((a, b) => Calc.chgPct(b) - Calc.chgPct(a));
    const up = movers.filter(s => Calc.chgPct(s) > 0).length, dn = movers.filter(s => Calc.chgPct(s) < 0).length;
    const row = s => {
      const f = Fmt.fmtPct(Calc.chgPct(s));
      return `<tr data-code="${s.code}">
        <td class="l cell-name">${esc(s.name)}</td><td class="l cell-code">${s.code}</td>
        <td class="cell-price ${f.cls}" data-f="price">${Fmt.fmtPrice(s)}</td>
        <td class="${f.cls}" data-f="chg">${f.text}</td>
        <td data-f="tcap">${Fmt.fmtCap(Calc.mktCap(s), s.currency)}</td></tr>`;
    };
    R.innerHTML = `<div class="page container-1700">
      <div class="page-head">
        <div class="page-title">全球行情<small>GLOBAL MARKETS</small></div>
        <div class="refresh-note"><span class="dot"></span>上涨 <b class="c-up">${up}</b> 家 · 下跌 <b class="c-down">${dn}</b> 家（样本池）</div>
      </div>
      <div class="mkt-grid">${idxCards}</div>
      <div class="table-card"><div class="table-scroll"><table class="data-table" style="min-width:900px">
        <thead><tr><th class="l">名称</th><th class="l">代码</th><th>最新价</th><th>涨跌幅</th><th>总市值</th></tr></thead>
        <tbody>${movers.map(row).join('')}</tbody>
      </table></div></div>
    </div>`;
    $$('.mkt-card canvas.idx-spark').forEach(cv => Charts.spark(cv, idxSeries(IndexMap[cv.dataset.idx])));
  }
  function updateMarket() {
    $$('.mkt-card').forEach(card => {
      const x = IndexMap[card.dataset.idx]; const f = Fmt.fmtPct(x.chgPct);
      const v = card.querySelector('[data-f=val]'), c = card.querySelector('[data-f=chg]');
      v.textContent = x.price.toLocaleString('zh-CN', { minimumFractionDigits: 2 }); v.className = 'idx-value ' + f.cls;
      c.textContent = f.text; c.className = 'idx-chg ' + f.cls;
      Charts.spark(card.querySelector('canvas'), idxSeries(x));
    });
    $$('#viewRoot tbody tr[data-code]').forEach(tr => {
      const s = StockMap[tr.dataset.code]; if (!s) return;
      const f = Fmt.fmtPct(Calc.chgPct(s));
      const p = tr.querySelector('[data-f=price]'), c = tr.querySelector('[data-f=chg]'), tc = tr.querySelector('[data-f=tcap]');
      if (p) { p.textContent = Fmt.fmtPrice(s); p.className = 'cell-price ' + f.cls; }
      if (c) { c.textContent = f.text; c.className = f.cls; }
      if (tc) tc.textContent = Fmt.fmtCap(Calc.mktCap(s), s.currency);
    });
  }

  /* ============================================================
   * 对比模块（最多2只，左右各半）
   * ============================================================ */
  function viewCompare(R) {
    const list = Store.state.compare.map(c => StockMap[c]).filter(Boolean);
    R.innerHTML = `<div class="page container-1700">
      <div class="page-head">
        <div class="page-title">标的对比<small>COMPARE · 最多 2 只</small></div>
        <div class="refresh-note"><span class="dot"></span>每 ${Store.state.refreshMs / 1000} 秒实时刷新</div>
      </div>
      <div class="cmp-bar">
        <input class="cmp-input" id="cmpInp0" placeholder="标的A：输入代码或名称回车确认" value="${list[0] ? list[0].code : ''}">
        <span class="cmp-vs">VS</span>
        <input class="cmp-input" id="cmpInp1" placeholder="标的B：输入代码或名称回车确认" value="${list[1] ? list[1].code : ''}">
      </div>
      <div class="cmp-grid" id="cmpGrid">
        ${[0, 1].map(i => list[i] ? cmpPaneHTML(list[i], i) : `<div class="cmp-empty-slot"><div style="font-size:15px;letter-spacing:3px">虚位以待</div><div>在上方输入框选择对比标的，或在搜索结果中「加入对比」</div></div>`).join('')}
      </div>
    </div>`;
    [0, 1].forEach(i => {
      const inp = $('#cmpInp' + i);
      inp.addEventListener('keydown', async e => {
        if (e.key !== 'Enter') return;
        const s = await resolveStock(inp.value);
        if (!s) { toast('未找到该标的，请检查代码或名称'); return; }
        const other = Store.state.compare[1 - i];
        if (other === s.code) { toast('两只标的不能相同'); return; }
        Store.setCompare(i, s.code); viewCompare(R);
      });
      const s = list[i];
      if (s) drawCmpChart(s, i);
    });
    $$('.cmp-remove').forEach(b => b.onclick = () => { Store.removeCompare(b.dataset.code); viewCompare(R); });
  }
  function cmpPaneHTML(s, i) {
    const f = Fmt.fmtPct(Calc.chgPct(s));
    return `<div class="cmp-pane" data-code="${s.code}" data-slot="${i}">
      <div class="cmp-pane-head">
        <span class="cmp-name cell-name" data-code="${s.code}">${esc(s.name)}</span>
        <span class="cmp-code cell-code" data-code="${s.code}">${s.code}</span>
        <button class="cmp-remove" data-code="${s.code}">移出</button>
        <span class="cmp-price ${f.cls}" data-f="price">${Fmt.fmtPrice(s)}</span>
        <span class="${f.cls}" data-f="chg" style="font-size:13px">${f.text}</span>
      </div>
      <canvas class="cmp-chart" id="cmpChart${i}"></canvas>
      <div class="info-grid">${infoGridHTML(s)}</div>
    </div>`;
  }
  function drawCmpChart(s, i) {
    const cv = $('#cmpChart' + i); if (!cv) return;
    Charts.candle(cv, Calc.getBars(s, 'day').slice(-120), { ma: [5, 10, 20] });
  }
  function updateCompare() {
    $$('.cmp-pane').forEach(p => {
      const s = StockMap[p.dataset.code]; if (!s) return;
      const f = Fmt.fmtPct(Calc.chgPct(s));
      const pr = p.querySelector('[data-f=price]'), c = p.querySelector('[data-f=chg]');
      if (pr) { pr.textContent = Fmt.fmtPrice(s); pr.className = 'cmp-price ' + f.cls; }
      if (c) { c.textContent = f.text; c.className = f.cls; }
      drawCmpChart(s, +p.dataset.slot);
    });
  }

  /* ---------- 信息网格（详情/对比共用） ---------- */
  function infoGridHTML(s) {
    const d = ensureDay(s);
    const ratio = s.price / s.prevClose;
    const hist = Calc.getBars(s, 'day');
    const hi52 = Math.max(...hist.map(b => b.high)), lo52 = Math.min(...hist.map(b => b.low));
    const items = [
      ['今开', d.open.toFixed(2)], ['昨收', s.prevClose.toFixed(2)],
      ['最高', d.high.toFixed(2)], ['最低', d.low.toFixed(2)],
      ['总市值', Fmt.fmtCap(Calc.mktCap(s), s.currency)], ['流通市值', Fmt.fmtCap(Calc.floatCap(s), s.currency)],
      ['PE(静)', Fmt.fmtRatio(s.peS * ratio)], ['PE(TTM)', Fmt.fmtRatio(s.peT * ratio)],
      ['PB', Fmt.fmtRatio(s.pb * ratio)], ['PS', Fmt.fmtRatio(s.ps * ratio)],
      ['ROE', s.roe ? s.roe.toFixed(1) + '%' : '—'], ['股息率', s.divY ? (s.divY / ratio).toFixed(2) + '%' : '—'],
      ['滚动股息率', Calc.rollDivY(s) ? Calc.rollDivY(s).toFixed(2) + '%' : '—'],
      ['52周高', hi52.toFixed(2)], ['52周低', lo52.toFixed(2)],
      ['总股本', Fmt.fmtShares(s.totalShr)], ['流通股本', Fmt.fmtShares(s.floatShr)],
      ['分红总额', Fmt.fmtYi(s.divTotal, s.currency)], ['净利润', Fmt.fmtYi(s.profit, s.currency)],
      ['股息支付率', Calc.payout(s) ? Calc.payout(s).toFixed(1) + '%' : '—'],
      ['近一年回购', Fmt.fmtYi(s.buyback, s.currency)], ['股权激励', Fmt.fmtYi(s.incentive, s.currency)]
    ];
    return items.map(([k, v]) => `<div class="info-item"><span class="k">${k}</span><span class="v">${v}</span></div>`).join('');
  }

  /* ============================================================
   * 单股全屏详情（双击触发）
   * ============================================================ */
  function openDetail(code) {
    const s = StockMap[code]; if (!s) return;
    UI.detailCode = code; UI.detailPeriod = UI.detailPeriod || 'intraday';
    $('#detailOverlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    renderDetailHead();
    renderDetailBody();
  }
  function closeDetail() {
    $('#detailOverlay').classList.add('hidden');
    document.body.style.overflow = '';
    UI.detailCode = null;
  }
  function renderDetailHead() {
    const s = StockMap[UI.detailCode]; if (!s) return;
    const pct = Calc.chgPct(s), f = Fmt.fmtPct(pct);
    $('#dtName').textContent = s.name;
    $('#dtCode').textContent = s.code + ' · ' + Fmt.CUR[s.currency];
    const p = $('#dtPrice'); p.textContent = Fmt.fmtPrice(s); p.className = 'detail-price ' + f.cls;
    const c = $('#dtChg'); c.textContent = (pct > 0 ? '+' : '') + (s.price - s.prevClose).toFixed(2) + '  ' + f.text; c.className = 'detail-chg ' + f.cls;
    $$('#dtPeriods .period-btn').forEach(b => b.classList.toggle('active', b.dataset.period === UI.detailPeriod));
    // 自选按钮状态
    const inW = Store.inWatch(s.code);
    const wb = $('#dtWatch');
    wb.textContent = inW ? '✓ 已自选 · 点击移除' : '＋ 加入自选';
    wb.classList.toggle('in', inW);
  }
  function renderDetailBody() {
    const s = StockMap[UI.detailCode]; if (!s) return;
    const inW = Store.inWatch(s.code);
    $('#dtInfo').innerHTML = `<div class="info-section">基本信息 · BASIC</div><div class="info-grid">${infoGridHTML(s)}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:18px">
        <div class="info-section" style="margin:0">我的标签 · TAGS</div>
        <button class="btn-mini" id="dtEditTags">🏷 编辑标签</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px 2px 4px">${tagsHTML(Store.getWatch(s.code)?.tags || [])}</div>`;
    $('#dtEditTags').addEventListener('click', () => {
      if (!Store.inWatch(UI.detailCode)) { toast('请先加入自选，再编辑标签'); return; }
      openTagManager(UI.detailCode, () => renderDetailBody());
    });
    const cv = $('#dtChart');
    requestAnimationFrame(() => {
      if (s.price <= 0) {
        const ctx = cv.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const w = cv.width / dpr, h = cv.height / dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#A6ACBB'; ctx.font = '13px -apple-system, "PingFang SC", sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('行情数据加载中，请稍候…', w / 2, h / 2);
        return;
      }
      if (UI.detailPeriod === 'intraday') Charts.line(cv, seriesOf(s), { base: s.prevClose });
      else Charts.candle(cv, Calc.getBars(s, UI.detailPeriod).slice(-160), { ma: [5, 10, 20, 60] });
    });
  }
  $('#dtClose').addEventListener('click', closeDetail);
  $('#dtWatch').addEventListener('click', () => {
    const code = UI.detailCode; if (!code) return;
    const s = StockMap[code];
    if (Store.inWatch(code)) { Store.removeWatch(code); toast('已取消自选 · ' + s.name); renderDetailHead(); }
    else askIndustryTag(code, () => renderDetailHead());
  });
  $('#dtPeriods').addEventListener('click', e => {
    const b = e.target.closest('.period-btn'); if (!b) return;
    UI.detailPeriod = b.dataset.period; renderDetailHead(); renderDetailBody();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDetail(); closeModal(); } });

  /* ============================================================
   * 个人账户
   * ============================================================ */
  /* 校验并规范化导入的备份数据，返回可安全入库的 state 或 null */
  function normalizeState(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.watchlist)) return null;
    const watchlist = [];
    const seen = new Set();
    raw.watchlist.forEach(w => {
      if (!w || typeof w !== 'object') return;
      // 用代码规范化：自动纠正缺失/错误前缀的代码，确定市场
      const canon = Market.canonicalizeCode(w.code);
      if (!canon) return;
      if (seen.has(canon.code)) return;
      seen.add(canon.code);
      const tags = Array.isArray(w.tags)
        ? [...new Set(w.tags.map(t => String(t).trim().slice(0, 12)).filter(Boolean))].slice(0, 5)
        : [];
      const name = w.name ? String(w.name) : (StockMap[canon.code] ? StockMap[canon.code].name : '');
      watchlist.push({
        code: canon.code,
        market: canon.market,
        name,
        tags,
        strike: (w.strike == null || w.strike === '') ? '' : String(w.strike),
        addedAt: Number(w.addedAt) || Date.now()
      });
    });
    const customTags = (Array.isArray(raw.customTags) ? raw.customTags : []).map(t => String(t).trim().slice(0, 12)).filter(Boolean);
    const tagOrder = Array.isArray(raw.tagOrder) ? raw.tagOrder.map(t => String(t).trim()).filter(Boolean) : [];
    const orderMap = raw.orderMap && typeof raw.orderMap === 'object' && !Array.isArray(raw.orderMap) ? raw.orderMap : {};
    const compare = Array.isArray(raw.compare)
      ? raw.compare.map(c => { const cc = Market.canonicalizeCode(c); return cc ? cc.code : null; }).filter(Boolean).slice(0, 2)
      : [];
    const refreshMs = [5000, 10000, 30000].includes(raw.refreshMs) ? raw.refreshMs : 10000;
    return { watchlist, customTags, tagOrder, orderMap, compare, refreshMs, savedAt: Date.now() };
  }

  function viewAccount(R) {
    const wl = Store.state.watchlist.length, tg = Store.allTags().length, cp = Store.state.compare.length;
    R.innerHTML = `<div class="page container-1700">
      <div class="page-head">
        <div style="display:flex;align-items:center;gap:16px">
          <div class="page-title">个人账户<small>ACCOUNT</small></div>
          <button class="btn-mini" id="btnAdmin">🔒 管理员</button>
        </div>
      </div>
      <div class="acct-grid">
        <div class="acct-card">
          <div class="acct-profile">
            <div class="acct-avatar">衡</div>
            <div class="acct-name">个人投资者</div>
            <div class="acct-level">PRO · 终端用户</div>
          </div>
          <div class="acct-stats">
            <div class="acct-stat"><div class="n">${wl}</div><div class="t">自选标的</div></div>
            <div class="acct-stat"><div class="n">${tg}</div><div class="t">标签分组</div></div>
            <div class="acct-stat"><div class="n">${cp}</div><div class="t">对比中</div></div>
          </div>
        </div>
        <div class="acct-card">
          <div class="set-row">
            <div><div class="k">行情刷新频率</div><div class="d">自选 / 个股 / 对比 / 指数滚动带的数据刷新间隔</div></div>
            <select class="set-select" id="setRefresh">
              ${[5000, 10000, 30000].map(ms => `<option value="${ms}" ${Store.state.refreshMs === ms ? 'selected' : ''}>${ms / 1000} 秒</option>`).join('')}
            </select>
          </div>
          <div class="set-row">
            <div><div class="k">数据源状态</div><div class="d">腾讯实时行情桥（A股/港股/美股/指数，8秒轮询）${Engine.realMode ? '在线，行情为真实数据' : '当前离线，使用基线+模拟引擎'}</div></div>
            <span class="tag-chip ${Engine.realMode ? '' : 'gold'}">${Engine.realMode ? '● 实时在线' : '模拟运行'}</span>
          </div>
          <div class="set-row">
            <div><div class="k">数据存储位置</div><div class="d">仅保存在当前浏览器本地（localStorage），不上传服务器；换设备/换浏览器请用下方「导出/导入」迁移</div></div>
            <span class="tag-chip gold">本地存储 · 无账号</span>
          </div>
          <div class="set-row">
            <div><div class="k">备份与恢复</div><div class="d">把自选、标签分组、击球点、排序、对比打包为 JSON 文件下载到本地；下次导入即可续用，无需重新设置</div></div>
            <div style="display:flex;gap:10px">
              <button class="btn-mini" id="btnExport">⤓ 导出备份</button>
              <button class="btn-mini" id="btnImport">⤒ 导入数据</button>
              <input type="file" id="importFile" accept=".json,application/json" style="display:none">
            </div>
          </div>
          <div class="set-row" style="border-bottom:none">
            <div><div class="k">清除本地数据</div><div class="d">删除全部自选、标签、击球点、排序与对比记录（不可恢复）</div></div>
            <button class="btn-danger-ghost" id="btnClear">清除数据</button>
          </div>
        </div>
      </div>
    </div>`;
    $('#setRefresh').onchange = e => { Store.setRefresh(+e.target.value); Engine.start(); toast('刷新频率已更新为 ' + (+e.target.value / 1000) + ' 秒'); };
    /* 管理员入口：登录校验在服务器端 */
    $('#btnAdmin').onclick = () => {
      if (sessionStorage.getItem('hs_admin_token')) { openAdminPanel(); return; }
      openModal(`
        <div class="modal-title">管理员登录</div>
        <div class="modal-q">请输入管理员账号与密码（凭据仅存服务器端，不在网页代码中）</div>
        <input class="modal-input" id="admUser" placeholder="账号" style="margin-bottom:10px">
        <input class="modal-input" id="admPass" type="password" placeholder="密码">
        <div class="modal-actions"><button class="btn-ghost" id="mCancel">取消</button><button class="btn-solid" id="admOk">登录</button></div>`);
      $('#mCancel').onclick = closeModal;
      $('#admOk').onclick = async () => {
        const u = $('#admUser').value.trim(), p = $('#admPass').value;
        if (!u || !p) { toast('请输入账号和密码'); return; }
        try {
          const r = await (await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: u, pass: p }) })).json();
          if (r.ok) { sessionStorage.setItem('hs_admin_token', r.token); closeModal(); openAdminPanel(); toast('管理员登录成功'); }
          else toast(r.err || '登录失败');
        } catch (e) { toast('无法连接服务器，请确认已通过启动脚本访问'); }
      };
      $('#admPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#admOk').click(); });
    };
    async function openAdminPanel() {
      openModal('<div class="modal-title">管理员面板</div><div class="modal-q" id="admBody">加载中…</div><div class="modal-actions"><button class="btn-ghost" id="admLogout">退出登录</button><button class="btn-solid" id="admDone">关闭</button></div>');
      $('#admDone').onclick = closeModal;
      $('#admLogout').onclick = () => { sessionStorage.removeItem('hs_admin_token'); closeModal(); toast('已退出管理员'); };
      try {
        const token = sessionStorage.getItem('hs_admin_token');
        const r = await (await fetch('/api/admin/status', { headers: { Authorization: 'Bearer ' + token } })).json();
        if (r.ok) {
          $('#admBody').innerHTML = `账号：<b>${esc(r.user)}</b><br>行情桥：<b>${r.realMode ? '在线' : '离线'}</b> · 行情缓存 ${r.cacheSize} 条 · 轮询 ${r.pollSize} 个<br><br><span style="color:var(--ink-4);font-size:12px">提示：网页代码/内容的修改，请通过编辑服务器目录下的文件（如 js/data.js、js/stocklist.js、server.js）后重新部署完成。本登录保护管理员专属功能，网页端不提供在线改代码（会留下被攻击入口）。</span>`;
        } else { $('#admBody').textContent = '登录已过期，请重新登录'; sessionStorage.removeItem('hs_admin_token'); }
      } catch (e) { $('#admBody').textContent = '无法获取服务器状态'; }
    }
    /* 导出备份（带版本信封，纯本地文件） */
    $('#btnExport').onclick = () => {
      // 构建完备数据：每条自选带 market + name，并按市场/标签双重分类
      const entries = Store.state.watchlist.map(w => {
        const s = StockMap[w.code];
        const canon = Market.canonicalizeCode(w.code);
        return {
          code: canon ? canon.code : w.code,
          market: canon ? canon.market : Market.marketOfCode(w.code),
          name: s ? s.name : (w.name || ''),
          tags: w.tags || [],
          strike: w.strike || '',
          addedAt: w.addedAt || 0
        };
      });
      const byMarket = { CN: [], HK: [], US: [] };
      const byTag = {};
      entries.forEach(e => {
        if (e.market) (byMarket[e.market] || (byMarket[e.market] = [])).push(e.code);
        (e.tags || []).forEach(t => { (byTag[t] || (byTag[t] = [])).push(e.code); });
      });
      const payload = {
        app: 'hengshi-terminal',
        version: 2,
        exportedAt: new Date().toISOString(),
        summary: { watchlist: entries.length, tags: Store.allTags().length },
        data: {
          watchlist: entries,
          customTags: Store.state.customTags || [],
          tagOrder: Store.state.tagOrder || [],
          orderMap: Store.state.orderMap || {},
          compare: Store.state.compare || [],
          refreshMs: Store.state.refreshMs,
          classified: { byMarket, byTag }
        }
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      a.download = '衡石资本备份_' + ts + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('已导出备份文件，请妥善保存到本地');
    };
    /* 导入恢复：解析 → 校验 → 确认覆盖 */
    $('#btnImport').onclick = () => $('#importFile').click();
    $('#importFile').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        let payload;
        try { payload = JSON.parse(rd.result); } catch (err) { toast('导入失败：不是有效的 JSON 文件'); return; }
        // 兼容带信封的新格式与旧版直接数据格式
        const raw = (payload && payload.data && typeof payload.data === 'object') ? payload.data : payload;
        const state = normalizeState(raw);
        if (!state) { toast('导入失败：文件内容不是本工具的备份数据'); return; }
        const curWl = Store.state.watchlist.length;
        openModal(`
          <div class="modal-title">确认导入并覆盖当前数据？</div>
          <div class="modal-q">文件包含：<b>${state.watchlist.length} 只自选</b> · <b>${state.customTags.length} 个标签</b> · <b>${state.compare.length} 只对比</b><br>
            将覆盖当前 <b>${curWl} 只自选</b> 及全部设置，是否继续？</div>
          <div class="modal-actions"><button class="btn-ghost" id="mCancel">取消</button><button class="btn-solid" id="mOk">确认导入</button></div>`);
        $('#mCancel').onclick = closeModal;
        $('#mOk').onclick = () => {
          Store.state = state; Store.save();
          Market.materializeWatchlist(); // 导入后立即把自选/对比的股票补建入库，确保各页能显示
          UI.tagTab = null; UI.wlTab = 'all'; UI.detailCode = null;
          closeModal();
          navigate('home');
          refreshFundamentals(); // 导入后立即抓取自选的基本面数据（ROE/股息率/分红/净利润等）
          toast('导入成功 · 自选 ' + state.watchlist.length + ' 只 / 标签 ' + state.customTags.length + ' 个');
        };
      };
      rd.readAsText(f);
      e.target.value = '';
    };
    $('#btnClear').onclick = () => {
      openModal(`<div class="modal-title">确认清除全部本地数据？</div>
        <div class="modal-q">将删除：<b>${wl} 只自选</b>、<b>${tg} 个标签</b>、全部击球点与排序记录，且不可恢复。</div>
        <div class="modal-actions"><button class="btn-ghost" id="mCancel">取消</button><button class="btn-solid" id="mOk" style="background:var(--up)">确认清除</button></div>`);
      $('#mCancel').onclick = closeModal;
      $('#mOk').onclick = () => { Store.clearAll(); localStorage.removeItem('hengshi_seeded'); closeModal(); toast('已清除全部本地数据'); navigate('home'); };
    };
  }

  /* ============================================================
   * 弹窗基础
   * ============================================================ */
  function openModal(html) { $('#modalBox').innerHTML = html; $('#modalMask').classList.remove('hidden'); }
  function closeModal() { $('#modalMask').classList.add('hidden'); }
  $('#modalMask').addEventListener('click', e => { if (e.target.id === 'modalMask') closeModal(); });

  /* ============================================================
   * 顶栏 / 时钟 / 引擎
   * ============================================================ */
  $$('.nav-item').forEach(a => a.addEventListener('click', () => navigate(a.dataset.view)));
  $('#brandHome').addEventListener('click', () => navigate('home'));

  function tickClock() {
    const d = new Date();
    const t = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
    $('#clockText').textContent = t;
    // 时段切换时重建滚动带
    if (UI.view === 'home' && d.getSeconds() % 30 === 0) {
      const sess = MARKET_DATA.sessionIndices(d);
      const badge = $('#sessionBadge');
      if (badge && !badge.textContent.includes(sess.label)) buildTicker();
    }
  }
  setInterval(tickClock, 1000); tickClock();

  Engine.onTick(() => {
    if (UI.view === 'home') { updateTicker(); updateSearch(); }
    if (UI.view === 'watchlist' || UI.view === 'stocks') updateTable();
    if (UI.view === 'market') updateMarket();
    if (UI.view === 'compare') updateCompare();
    if (UI.detailCode) {
      renderDetailHead();
      const s = StockMap[UI.detailCode];
      if (s && s.price > 0) {
        // 行情刚到位（此前是"—"），刷新右侧信息面板与图表
        if (s._justQuoted) { s._justQuoted = false; renderDetailBody(); }
        else if (UI.detailPeriod === 'intraday') Charts.line($('#dtChart'), seriesOf(s), { base: s.prevClose });
      }
    }
  });

  /* 窗口尺寸变化时重绘可见画布 */
  let rzTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => {
      if (UI.view === 'home') buildTicker();
      if (UI.detailCode) renderDetailBody();
      if (UI.view === 'compare') viewCompare($('#viewRoot'));
    }, 200);
  });

  const validViews = ['home', 'watchlist', 'stocks', 'market', 'compare', 'account'];
  const rawHash = location.hash; // 先保存原始hash，navigate会改写
  const initView = validViews.includes(rawHash.slice(1)) ? rawHash.slice(1) : 'home';
  Market.materializeWatchlist(); // 启动时先把自选/对比里的股票补建入库，确保能显示
  refreshFundamentals(); // 启动时抓取自选的基本面数据（ROE/股息率/分红/净利润等）
  navigate(initView);
  // 支持 #detail=CODE 直达单股全屏详情
  const m = rawHash.match(/detail=([A-Z0-9]+)/i);
  if (m && StockMap[m[1].toUpperCase()]) openDetail(m[1].toUpperCase());
  Engine.start();
})();
