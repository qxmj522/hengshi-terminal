/* ============================================================
 * charts.js — 轻量 Canvas 图表（零依赖）
 * K线(含MA/成交量) · 分时线 · 迷你走势图
 * 中国配色：涨红 #D43D33 / 跌绿 #0E9066
 * ============================================================ */
(function () {
  const UP = '#D43D33', DOWN = '#0E9066', GRID = '#EEF0F4', AXIS = '#A6ACBB';
  const MA_COLORS = { 5: '#E8B44C', 10: '#7A9CC6', 20: '#B08D57', 60: '#9B8AA6' };

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, r.width * dpr);
    canvas.height = Math.max(1, r.height * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    return { ctx, W: r.width, H: r.height };
  }

  function ma(bars, n) {
    return bars.map((_, i) => {
      if (i < n - 1) return null;
      let s = 0; for (let j = i - n + 1; j <= i; j++) s += bars[j].close;
      return s / n;
    });
  }

  /* ---------- K线图 ---------- */
  function candle(canvas, bars, opts) {
    opts = opts || {};
    const { ctx, W, H } = setup(canvas);
    if (!bars || !bars.length) return;
    const padL = 8, padR = 64, padT = 14;
    const volH = opts.volume === false ? 0 : Math.floor(H * 0.18);
    const padB = 20 + volH;
    const chW = W - padL - padR, chH = H - padT - padB;
    const n = bars.length;

    let hi = -Infinity, lo = Infinity, vMax = 0;
    bars.forEach(b => { hi = Math.max(hi, b.high); lo = Math.min(lo, b.low); vMax = Math.max(vMax, b.vol); });
    const mas = (opts.ma || [5, 10, 20]).map(p => ({ p, vals: ma(bars, p) }));
    mas.forEach(m => m.vals.forEach(v => { if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v); } }));
    const pad = (hi - lo) * 0.06 || hi * 0.01; hi += pad; lo -= pad;

    const x = i => padL + (i + 0.5) * (chW / n);
    const y = v => padT + (hi - v) / (hi - lo) * chH;

    // 网格 + 右侧刻度
    ctx.strokeStyle = GRID; ctx.fillStyle = AXIS; ctx.lineWidth = 1;
    ctx.font = '10px -apple-system, "PingFang SC", sans-serif'; ctx.textAlign = 'left';
    for (let g = 0; g <= 4; g++) {
      const gy = padT + chH * g / 4;
      ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
      const val = hi - (hi - lo) * g / 4;
      const mid = (hi + lo) / 2;
      ctx.fillStyle = val > mid ? UP : val < mid ? DOWN : AXIS;
      ctx.fillText(val >= 100 ? val.toFixed(1) : val.toFixed(2), W - padR + 8, gy + 3);
    }
    // 底部日期
    ctx.fillStyle = AXIS; ctx.textAlign = 'center';
    const step = Math.ceil(n / 5);
    for (let i = 0; i < n; i += step) ctx.fillText(bars[i].date.slice(2), x(i), H - volH - 6);

    // 蜡烛
    const bw = Math.max(2, Math.min(12, (chW / n) * 0.62));
    bars.forEach((b, i) => {
      const up = b.close >= b.open;
      const cx = x(i);
      ctx.strokeStyle = up ? UP : DOWN;
      ctx.fillStyle = up ? UP : DOWN;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx, y(b.high)); ctx.lineTo(cx, y(b.low)); ctx.stroke();
      const t = y(Math.max(b.open, b.close)), btm = y(Math.min(b.open, b.close));
      const bh = Math.max(1, btm - t);
      if (up) { ctx.globalAlpha = 0.92; ctx.fillRect(cx - bw / 2, t, bw, bh); ctx.globalAlpha = 1; }
      else ctx.fillRect(cx - bw / 2, t, bw, bh);
    });

    // MA线
    mas.forEach(m => {
      ctx.strokeStyle = MA_COLORS[m.p] || '#999'; ctx.lineWidth = 1.1; ctx.beginPath();
      let started = false;
      m.vals.forEach((v, i) => { if (v == null) return; const px = x(i), py = y(v); if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py); });
      ctx.stroke();
    });
    // MA 图例
    ctx.textAlign = 'left'; let lx = padL + 6;
    mas.forEach(m => { ctx.fillStyle = MA_COLORS[m.p] || '#999'; ctx.font = 'bold 10px sans-serif'; ctx.fillText('MA' + m.p, lx, padT + 4); lx += 38; });

    // 成交量
    if (volH > 0) {
      const vy = H - volH + 4, vh = volH - 10;
      bars.forEach((b, i) => {
        const up = b.close >= b.open;
        ctx.fillStyle = up ? 'rgba(212,61,51,.45)' : 'rgba(14,144,102,.45)';
        const h = vMax ? b.vol / vMax * vh : 0;
        ctx.fillRect(x(i) - bw / 2, vy + vh - h, bw, Math.max(1, h));
      });
    }
  }

  /* ---------- 分时/线图 ---------- */
  function line(canvas, pts, opts) {
    opts = opts || {};
    const { ctx, W, H } = setup(canvas);
    if (!pts || pts.length < 2) return;
    const padL = opts.axis === false ? 2 : 8, padR = opts.axis === false ? 2 : 56, padT = 10, padB = opts.axis === false ? 2 : 18;
    const W2 = W - padL - padR, H2 = H - padT - padB;
    let hi = Math.max(...pts), lo = Math.min(...pts);
    const base = opts.base != null ? opts.base : pts[0];
    hi = Math.max(hi, base); lo = Math.min(lo, base);
    const pad = (hi - lo) * 0.1 || hi * 0.005; hi += pad; lo -= pad;
    const x = i => padL + i / (pts.length - 1) * W2;
    const y = v => padT + (hi - v) / (hi - lo) * H2;
    const up = pts[pts.length - 1] >= base;
    const col = up ? UP : DOWN;

    if (opts.axis !== false) {
      ctx.strokeStyle = GRID; ctx.fillStyle = AXIS; ctx.lineWidth = 1; ctx.font = '10px sans-serif';
      for (let g = 0; g <= 4; g++) {
        const gy = padT + H2 * g / 4;
        ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(W - padR, gy); ctx.stroke();
        const val = hi - (hi - lo) * g / 4;
        const pct = (val / base - 1) * 100;
        ctx.fillStyle = pct > 0 ? UP : pct < 0 ? DOWN : AXIS;
        ctx.fillText(pct.toFixed(2) + '%', W - padR + 6, gy + 3);
      }
      // 昨收虚线
      ctx.setLineDash([4, 4]); ctx.strokeStyle = '#C9CEDA';
      ctx.beginPath(); ctx.moveTo(padL, y(base)); ctx.lineTo(W - padR, y(base)); ctx.stroke();
      ctx.setLineDash([]);
    }

    // 渐变填充
    const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
    grad.addColorStop(0, up ? 'rgba(212,61,51,.18)' : 'rgba(14,144,102,.18)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath();
    pts.forEach((v, i) => { const px = x(i), py = y(v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.lineTo(x(pts.length - 1), H - padB); ctx.lineTo(x(0), H - padB); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // 末端点
    const lx = x(pts.length - 1), ly = y(pts[pts.length - 1]);
    ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
  }

  /* ---------- 迷你走势 ---------- */
  function spark(canvas, pts, opts) {
    opts = opts || {};
    const { ctx, W, H } = setup(canvas);
    if (!pts || pts.length < 2) return;
    let hi = Math.max(...pts), lo = Math.min(...pts);
    const pad = (hi - lo) * 0.12 || hi * 0.004; hi += pad; lo -= pad;
    const x = i => 2 + i / (pts.length - 1) * (W - 4);
    const y = v => 3 + (hi - v) / (hi - lo) * (H - 6);
    const up = pts[pts.length - 1] >= pts[0];
    const col = opts.color || (up ? UP : DOWN);
    ctx.beginPath();
    pts.forEach((v, i) => { const px = x(i), py = y(v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.strokeStyle = col; ctx.lineWidth = 1.4; ctx.stroke();
    if (opts.fill !== false) {
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, up ? 'rgba(212,61,51,.14)' : 'rgba(14,144,102,.14)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.lineTo(x(pts.length - 1), H); ctx.lineTo(x(0), H); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
    }
  }

  window.Charts = { candle, line, spark };
})();
