/* ============================================================
 * verify.js — 通达信数据核验引擎
 * 比对「网页自爬数据(腾讯行情 + 东财基本面)」与「通达信快照 window.TDX_VERIFY」，
 * 找出差异字段，供 UI 标记与展示。纯只读，不修改任何数据。
 *
 * 数据来源：window.TDX_VERIFY = {
 *   updatedAt: '...', source: '通达信',
 *   items: { 'SH600519': { name, price, prevClose, peT, pb,
 *                          totalCapY, floatCapY, divY, roe }, ... }
 * }
 * 单位约定：price/prevClose 本币；totalCapY/floatCapY 为「亿元」；peT/pb 倍数；divY/roe 为 %。
 * ============================================================ */
(function () {
  const V = window.TDX_VERIFY || null;

  /* 差异阈值：口径明确字段从严，口径可能有差异的字段从宽 */
  const TH = {
    price: 0.01,      // 价格相对差 > 1%
    totalCap: 0.05,   // 总市值相对差 > 5%
    floatCap: 0.05,   // 流通市值相对差 > 5%
    peT: 0.20,        // PE 相对差 > 20%（TTM vs 静态口径可能不同，从宽）
    pb: 0.20,         // PB 相对差 > 20%
    divY: 1.5,        // 股息率绝对差 > 1.5 个百分点
    roe: 3.0          // ROE 绝对差 > 3 个百分点
  };
  const LABEL = {
    price: '价格', totalCap: '总市值', floatCap: '流通市值',
    peT: 'PE(TTM)', pb: 'PB', divY: '股息率', roe: 'ROE'
  };

  function rel(a, b) { return (a > 0 && b > 0) ? Math.abs(a - b) / Math.max(a, b) : 1; }
  function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }

  function cmp(field, web, tdx) {
    if (tdx == null || !isFinite(tdx) || tdx <= 0) return null;
    if (web == null || !isFinite(web) || web <= 0) return null;
    let diff = false;
    switch (field) {
      case 'price': diff = rel(web, tdx) > TH.price; break;
      case 'totalCap': case 'floatCap': case 'peT': case 'pb':
        diff = rel(web, tdx) > TH[field]; break;
      case 'divY': case 'roe': diff = Math.abs(web - tdx) > TH[field]; break;
    }
    return { field, label: LABEL[field], web, tdx, diff };
  }

  const Verify = {
    active: !!(V && V.items),
    updatedAt: V ? V.updatedAt : null,
    byCode(code) { return (V && V.items) ? V.items[code] : null; },

    /* 计算单只股票的逐字段比对结果（含未差异项） */
    diffsFor(s) {
      const t = this.byCode(s.code);
      if (!t) return null;
      const capY = s.totalShr > 0 ? num(s.price * s.totalShr) : 0;   // 总市值(亿元)
      const fcapY = s.floatShr > 0 ? num(s.price * s.floatShr) : 0;  // 流通市值(亿元)
      const arr = [
        cmp('price', s.price, t.price),
        cmp('totalCap', capY, t.totalCapY),
        cmp('floatCap', fcapY, t.floatCapY),
        cmp('peT', s.peT, t.peT),
        cmp('pb', s.pb, t.pb),
        cmp('divY', s.divY, t.divY),
        cmp('roe', s.roe, t.roe)
      ];
      return arr.filter(Boolean);
    },
    /* 是否有差异 */
    hasDiff(s) {
      const d = this.diffsFor(s);
      return !!(d && d.some(x => x.diff));
    },
    /* 全量差异报告：[{ code, name, diffs:[{field,label,web,tdx}] }] */
    report(list) {
      const out = [];
      (list || []).forEach(s => {
        if (!s) return;
        const d = this.diffsFor(s);
        if (!d) return;
        const diffs = d.filter(x => x.diff);
        if (diffs.length) out.push({ code: s.code, name: s.name, diffs });
      });
      return out;
    }
  };
  window.Verify = Verify;
})();
