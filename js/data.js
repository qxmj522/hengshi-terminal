/* ============================================================
 * data.js — 股票宇宙与基线数据
 * 基线价格取自 2026-09-04/05 真实行情快照（用户截图），
 * 待国泰海通/iFinD 授权后可切换为纯实时数据源。
 *
 * 字段说明：
 *  market: SH/SZ/HK/US   currency: CNY/HKD/USD
 *  peS/peT: 静态/TTM市盈率  pb: 市净率  ps: 市销率  roe: 净资产收益率(%)
 *  divY: 股息率(%)  divLast/divPrev: 最近/上一次每股股息
 *  divTotal: 最近一次分红总额(亿)  profit: 归母净利润(亿)
 *  buyback: 近一年回购(亿)  incentive: 近一年股权激励(亿)
 *  floatShr/totalShr: 流通/总股本(亿)  prevShr: 去年同期总股本(亿)
 * ============================================================ */
(function () {
  const S = (code, name, market, currency, price, f) => Object.assign({
    code, name, market, currency, price, prevClose: price,
    peS: 0, peT: 0, pb: 0, ps: 0, roe: 0, divY: 0,
    divLast: 0, divPrev: 0, divTotal: 0, profit: 0,
    buyback: 0, incentive: 0, floatShr: 0, totalShr: 0, prevShr: 0,
    vol: 0.016 // 波动率（模拟引擎用）
  }, f);

  /* ---------------- 股票宇宙 ---------------- */
  const STOCKS = [
    /* ===== A股 · 上海 ===== */
    S('SH600519', '贵州茅台', 'SH', 'CNY', 1628.00, { peS: 24.8, peT: 23.9, pb: 8.6, ps: 11.8, roe: 34.5, divY: 3.4, divLast: 27.63, divPrev: 27.62, divTotal: 347, profit: 892, buyback: 0, incentive: 0, floatShr: 12.56, totalShr: 12.56, prevShr: 12.56, vol: 0.011 }),
    S('SH601211', '国泰海通', 'SH', 'CNY', 17.87, { peS: 15.7, peT: 11.30, pb: 0.95, ps: 5.9, roe: 7.8, divY: 2.79, divLast: 0.28, divPrev: 0.22, divTotal: 49.4, profit: 200, buyback: 12.0, incentive: 0, floatShr: 134.49, totalShr: 175.81, prevShr: 175.81, vol: 0.014 }),
    S('SH600036', '招商银行', 'SH', 'CNY', 43.26, { peS: 7.6, peT: 7.4, pb: 1.02, ps: 2.9, roe: 14.1, divY: 4.9, divLast: 2.00, divPrev: 1.97, divTotal: 504, profit: 1484, buyback: 0, incentive: 0, floatShr: 206.3, totalShr: 252.2, prevShr: 252.2, vol: 0.009 }),
    S('SH601318', '中国平安', 'SH', 'CNY', 58.40, { peS: 8.9, peT: 8.2, pb: 1.05, ps: 1.1, roe: 12.6, divY: 4.5, divLast: 1.62, divPrev: 1.01, divTotal: 293, profit: 1266, buyback: 0, incentive: 0, floatShr: 107.6, totalShr: 182.1, prevShr: 182.1, vol: 0.012 }),
    S('SH600900', '长江电力', 'SH', 'CNY', 28.15, { peS: 20.4, peT: 19.8, pb: 3.1, ps: 7.6, roe: 15.2, divY: 2.9, divLast: 0.51, divPrev: 0.31, divTotal: 200, profit: 337, buyback: 0, incentive: 0, floatShr: 227.4, totalShr: 244.7, prevShr: 244.7, vol: 0.007 }),
    S('SH601899', '紫金矿业', 'SH', 'CNY', 25.62, { peS: 15.1, peT: 13.6, pb: 4.4, ps: 2.1, roe: 26.3, divY: 2.2, divLast: 0.32, divPrev: 0.24, divTotal: 85, profit: 415, buyback: 0, incentive: 2.1, floatShr: 205.9, totalShr: 265.8, prevShr: 263.3, vol: 0.015 }),
    S('SH600276', '恒瑞医药', 'SH', 'CNY', 62.80, { peS: 55.2, peT: 48.6, pb: 8.1, ps: 12.4, roe: 14.8, divY: 0.4, divLast: 0.16, divPrev: 0.14, divTotal: 10.2, profit: 74, buyback: 6.5, incentive: 1.8, floatShr: 63.8, totalShr: 65.4, prevShr: 63.8, vol: 0.016 }),
    S('SH600030', '中信证券', 'SH', 'CNY', 29.45, { peS: 16.8, peT: 14.2, pb: 1.55, ps: 6.8, roe: 8.9, divY: 2.4, divLast: 0.48, divPrev: 0.23, divTotal: 71, profit: 237, buyback: 0, incentive: 0, floatShr: 121.2, totalShr: 148.2, prevShr: 148.2, vol: 0.013 }),
    S('SH600887', '伊利股份', 'SH', 'CNY', 29.10, { peS: 16.2, peT: 15.5, pb: 3.2, ps: 1.5, roe: 19.4, divY: 4.2, divLast: 1.22, divPrev: 1.04, divTotal: 77, profit: 110, buyback: 10.2, incentive: 0, floatShr: 63.2, totalShr: 63.7, prevShr: 63.7, vol: 0.010 }),
    S('SH601088', '中国神华', 'SH', 'CNY', 40.35, { peS: 13.2, peT: 12.8, pb: 1.9, ps: 2.4, roe: 14.6, divY: 5.8, divLast: 2.26, divPrev: 0.22, divTotal: 449, profit: 587, buyback: 0, incentive: 0, floatShr: 164.9, totalShr: 198.7, prevShr: 198.7, vol: 0.010 }),
    S('SH601398', '工商银行', 'SH', 'CNY', 7.28, { peS: 6.8, peT: 6.7, pb: 0.68, ps: 2.6, roe: 10.2, divY: 5.1, divLast: 0.165, divPrev: 0.143, divTotal: 587, profit: 3659, buyback: 0, incentive: 0, floatShr: 2696, totalShr: 3564, prevShr: 3564, vol: 0.006 }),
    S('SH688981', '中芯国际', 'SH', 'CNY', 108.60, { peS: 120.5, peT: 95.3, pb: 5.6, ps: 11.2, roe: 4.2, divY: 0, divLast: 0, divPrev: 0, divTotal: 0, profit: 45, buyback: 0, incentive: 3.2, floatShr: 59.6, totalShr: 79.6, prevShr: 79.4, vol: 0.022 }),
    S('SH600585', '海螺水泥', 'SH', 'CNY', 24.16, { peS: 12.4, peT: 11.9, pb: 0.72, ps: 1.1, roe: 5.8, divY: 3.9, divLast: 0.71, divPrev: 0.96, divTotal: 38, profit: 104, buyback: 0, incentive: 0, floatShr: 40.0, totalShr: 53.0, prevShr: 53.0, vol: 0.011 }),
    S('SH601668', '中国建筑', 'SH', 'CNY', 5.82, { peS: 4.6, peT: 4.5, pb: 0.62, ps: 0.12, roe: 11.8, divY: 4.4, divLast: 0.27, divPrev: 0.26, divTotal: 113, profit: 502, buyback: 0, incentive: 1.2, floatShr: 413, totalShr: 419, prevShr: 419, vol: 0.009 }),
    S('SH600050', '中国联通', 'SH', 'CNY', 5.48, { peS: 18.9, peT: 17.2, pb: 1.05, ps: 0.5, roe: 5.6, divY: 2.8, divLast: 0.095, divPrev: 0.058, divTotal: 30, profit: 106, buyback: 0, incentive: 0.8, floatShr: 309, totalShr: 318, prevShr: 318, vol: 0.010 }),

    /* ===== A股 · 深圳 ===== */
    S('SZ000333', '美的集团', 'SZ', 'CNY', 87.57, { peS: 14.8, peT: 13.6, pb: 3.0, ps: 1.5, roe: 20.5, divY: 3.2, divLast: 2.5, divPrev: 0.5, divTotal: 191, profit: 385, buyback: 65.8, incentive: 2.6, floatShr: 68.85, totalShr: 69.78, prevShr: 70.1, vol: 0.010 }),
    S('SZ300750', '宁德时代', 'SZ', 'CNY', 305.40, { peS: 22.6, peT: 19.4, pb: 5.2, ps: 3.1, roe: 24.8, divY: 1.8, divLast: 4.55, divPrev: 1.16, divTotal: 254, profit: 589, buyback: 0, incentive: 4.5, floatShr: 39.1, totalShr: 44.0, prevShr: 44.0, vol: 0.017 }),
    S('SZ002594', '比亚迪', 'SZ', 'CNY', 104.80, { peS: 21.4, peT: 18.2, pb: 4.6, ps: 0.9, roe: 22.1, divY: 1.2, divLast: 0.96, divPrev: 0.30, divTotal: 35, profit: 402, buyback: 0, incentive: 1.4, floatShr: 22.6, totalShr: 30.4, prevShr: 29.1, vol: 0.018 }),
    S('SZ000858', '五粮液', 'SZ', 'CNY', 124.60, { peS: 15.2, peT: 14.6, pb: 3.4, ps: 5.2, roe: 23.4, divY: 4.6, divLast: 3.76, divPrev: 2.0, divTotal: 223, profit: 332, buyback: 0, incentive: 0, floatShr: 38.8, totalShr: 38.8, prevShr: 38.8, vol: 0.012 }),
    S('SZ002415', '海康威视', 'SZ', 'CNY', 32.24, { peS: 21.8, peT: 19.6, pb: 3.4, ps: 2.9, roe: 16.2, divY: 2.1, divLast: 0.50, divPrev: 0.40, divTotal: 46, profit: 142, buyback: 20.5, incentive: 1.1, floatShr: 91.2, totalShr: 92.3, prevShr: 93.3, vol: 0.014 }),
    S('SZ000651', '格力电器', 'SZ', 'CNY', 46.30, { peS: 8.2, peT: 7.8, pb: 1.8, ps: 1.2, roe: 22.4, divY: 5.2, divLast: 2.0, divPrev: 1.0, divTotal: 112, profit: 321, buyback: 0, incentive: 0, floatShr: 55.9, totalShr: 56.3, prevShr: 56.3, vol: 0.010 }),
    S('SZ002230', '科大讯飞', 'SZ', 'CNY', 52.16, { peS: 68.4, peT: 55.2, pb: 6.2, ps: 5.8, roe: 8.4, divY: 0.3, divLast: 0.1, divPrev: 0.1, divTotal: 2.3, profit: 7.6, buyback: 5.2, incentive: 2.2, floatShr: 22.4, totalShr: 23.1, prevShr: 23.1, vol: 0.021 }),
    S('SZ002352', '顺丰控股', 'SZ', 'CNY', 41.85, { peS: 19.6, peT: 17.4, pb: 2.2, ps: 0.7, roe: 11.2, divY: 1.6, divLast: 0.44, divPrev: 0.24, divTotal: 21.6, profit: 118, buyback: 15.4, incentive: 0.6, floatShr: 48.4, totalShr: 49.9, prevShr: 48.9, vol: 0.013 }),
    S('SZ000001', '平安银行', 'SZ', 'CNY', 12.35, { peS: 5.2, peT: 5.0, pb: 0.52, ps: 1.4, roe: 10.8, divY: 5.6, divLast: 0.719, divPrev: 0.276, divTotal: 140, profit: 445, buyback: 0, incentive: 0, floatShr: 194, totalShr: 194, prevShr: 194, vol: 0.009 }),
    S('SZ300059', '东方财富', 'SZ', 'CNY', 24.72, { peS: 32.5, peT: 26.8, pb: 4.8, ps: 24.6, roe: 14.2, divY: 0.6, divLast: 0.06, divPrev: 0.04, divTotal: 9.5, profit: 110, buyback: 5.0, incentive: 0.9, floatShr: 133.6, totalShr: 157.9, prevShr: 158.6, vol: 0.019 }),

    /* ===== 港股 ===== */
    S('HK00700', '腾讯控股', 'HK', 'HKD', 442.80, { peS: 22.4, peT: 16.19, pb: 3.10, ps: 6.8, roe: 19.2, divY: 0.9, divLast: 4.5, divPrev: 3.4, divTotal: 410, profit: 2227, buyback: 1120, incentive: 18, floatShr: 91.5, totalShr: 91.8, prevShr: 93.2, vol: 0.014 }),
    S('HK09988', '阿里巴巴-W', 'HK', 'HKD', 112.30, { peS: 16.8, peT: 14.2, pb: 2.1, ps: 2.2, roe: 12.4, divY: 1.0, divLast: 0.95, divPrev: 0.66, divTotal: 181, profit: 1301, buyback: 890, incentive: 25, floatShr: 190.8, totalShr: 190.8, prevShr: 202.6, vol: 0.017 }),
    S('HK03690', '美团-W', 'HK', 'HKD', 104.50, { peS: 18.2, peT: 15.6, pb: 3.4, ps: 1.8, roe: 18.6, divY: 0, divLast: 0, divPrev: 0, divTotal: 0, profit: 358, buyback: 281, incentive: 12, floatShr: 55.2, totalShr: 62.4, prevShr: 62.4, vol: 0.020 }),
    S('HK01810', '小米集团-W', 'HK', 'HKD', 55.20, { peS: 28.4, peT: 24.1, pb: 6.2, ps: 3.4, roe: 18.9, divY: 0, divLast: 0, divPrev: 0, divTotal: 0, profit: 237, buyback: 55, incentive: 8, floatShr: 204.6, totalShr: 250.5, prevShr: 249.8, vol: 0.021 }),
    S('HK00981', '中芯国际', 'HK', 'HKD', 64.80, { peS: 85.2, peT: 62.4, pb: 3.1, ps: 7.8, roe: 4.2, divY: 0, divLast: 0, divPrev: 0, divTotal: 0, profit: 45, buyback: 0, incentive: 3.2, floatShr: 59.8, totalShr: 79.6, prevShr: 79.4, vol: 0.023 }),
    S('HK01211', '比亚迪股份', 'HK', 'HKD', 104.20, { peS: 19.8, peT: 16.9, pb: 4.2, ps: 0.8, roe: 22.1, divY: 1.2, divLast: 0.96, divPrev: 0.30, divTotal: 35, profit: 402, buyback: 0, incentive: 1.4, floatShr: 11.0, totalShr: 30.4, prevShr: 29.1, vol: 0.019 }),
    S('HK00939', '建设银行', 'HK', 'HKD', 7.62, { peS: 5.4, peT: 5.3, pb: 0.55, ps: 2.1, roe: 10.6, divY: 5.9, divLast: 0.206, divPrev: 0.197, divTotal: 503, profit: 3356, buyback: 0, incentive: 0, floatShr: 2404, totalShr: 2500, prevShr: 2500, vol: 0.008 }),
    S('HK00883', '中国海洋石油', 'HK', 'HKD', 19.28, { peS: 6.8, peT: 6.5, pb: 1.25, ps: 2.2, roe: 18.4, divY: 6.8, divLast: 0.73, divPrev: 0.59, divTotal: 628, profit: 1379, buyback: 0, incentive: 0, floatShr: 445.7, totalShr: 475.4, prevShr: 475.4, vol: 0.012 }),
    S('HK00005', '汇丰控股', 'HK', 'HKD', 106.40, { peS: 9.8, peT: 9.2, pb: 1.35, ps: 3.4, roe: 13.8, divY: 5.2, divLast: 0.61, divPrev: 0.55, divTotal: 842, profit: 1789, buyback: 680, incentive: 0, floatShr: 176.2, totalShr: 176.2, prevShr: 183.4, vol: 0.010 }),
    S('HK01024', '快手-W', 'HK', 'HKD', 72.15, { peS: 16.4, peT: 14.1, pb: 4.8, ps: 2.4, roe: 26.4, divY: 0, divLast: 0, divPrev: 0, divTotal: 0, profit: 177, buyback: 42, incentive: 5, floatShr: 39.4, totalShr: 43.5, prevShr: 43.5, vol: 0.024 }),
    S('HK02015', '理想汽车-W', 'HK', 'HKD', 94.60, { peS: 14.2, peT: 12.8, pb: 2.8, ps: 1.2, roe: 19.8, divY: 0, divLast: 0, divPrev: 0, divTotal: 0, profit: 80, buyback: 0, incentive: 6.5, floatShr: 17.6, totalShr: 21.2, prevShr: 21.2, vol: 0.026 }),

    /* ===== 美股（基线取自 09-04/05 截图） ===== */
    S('USAAPL', '苹果', 'US', 'USD', 328.93, { peS: 31.2, peT: 28.4, pb: 45.2, ps: 8.4, roe: 152.6, divY: 0.4, divLast: 0.26, divPrev: 0.25, divTotal: 154, profit: 1120, buyback: 1000, incentive: 0, floatShr: 148.4, totalShr: 148.4, prevShr: 151.2, vol: 0.012 }),
    S('USTSLA', '特斯拉', 'US', 'USD', 361.86, { peS: 168.5, peT: 142.3, pb: 14.8, ps: 11.2, roe: 10.4, divY: 0, divLast: 0, divPrev: 0, divTotal: 0, profit: 71, buyback: 0, incentive: 0, floatShr: 31.6, totalShr: 32.1, prevShr: 31.9, vol: 0.030 }),
    S('USNVDA', '英伟达', 'US', 'USD', 182.40, { peS: 42.6, peT: 36.8, pb: 32.4, ps: 21.6, roe: 119.2, divY: 0.03, divLast: 0.01, divPrev: 0.01, divTotal: 8.3, profit: 881, buyback: 620, incentive: 0, floatShr: 243.5, totalShr: 244.9, prevShr: 245.8, vol: 0.026 }),
    S('USMSFT', '微软', 'US', 'USD', 512.60, { peS: 34.8, peT: 31.2, pb: 11.2, ps: 12.4, roe: 34.2, divY: 0.7, divLast: 0.83, divPrev: 0.75, divTotal: 247, profit: 1018, buyback: 220, incentive: 0, floatShr: 74.3, totalShr: 74.3, prevShr: 74.3, vol: 0.011 }),
    S('USGOOG', '谷歌-C', 'US', 'USD', 333.75, { peS: 26.4, peT: 23.8, pb: 7.8, ps: 6.9, roe: 30.8, divY: 0.5, divLast: 0.21, divPrev: 0.20, divTotal: 103, profit: 1243, buyback: 700, incentive: 0, floatShr: 117.6, totalShr: 121.2, prevShr: 122.9, vol: 0.014 }),
    S('USAMZN', '亚马逊', 'US', 'USD', 232.18, { peS: 36.2, peT: 31.4, pb: 7.2, ps: 3.6, roe: 22.6, divY: 0, divLast: 0, divPrev: 0, divTotal: 0, profit: 685, buyback: 60, incentive: 0, floatShr: 104.8, totalShr: 105.6, prevShr: 104.2, vol: 0.016 }),
    S('USMETA', 'Meta', 'US', 'USD', 722.45, { peS: 27.4, peT: 24.6, pb: 8.9, ps: 9.8, roe: 34.8, divY: 0.3, divLast: 0.525, divPrev: 0.50, divTotal: 53, profit: 623, buyback: 480, incentive: 0, floatShr: 21.9, totalShr: 25.4, prevShr: 25.4, vol: 0.018 }),
    S('USBABA', '阿里巴巴', 'US', 'USD', 113.41, { peS: 16.8, peT: 14.2, pb: 2.1, ps: 2.2, roe: 12.4, divY: 1.0, divLast: 0.95, divPrev: 0.66, divTotal: 181, profit: 1301, buyback: 890, incentive: 25, floatShr: 190.8, totalShr: 190.8, prevShr: 202.6, vol: 0.018 }),
    S('USPDD', '拼多多', 'US', 'USD', 82.48, { peS: 9.8, peT: 8.4, pb: 2.8, ps: 2.4, roe: 38.6, divY: 0, divLast: 0, divPrev: 0, divTotal: 0, profit: 1124, buyback: 0, incentive: 0, floatShr: 14.2, totalShr: 14.6, prevShr: 14.0, vol: 0.028 }),
    S('USNFLX', '奈飞', 'US', 'USD', 82.25, { peS: 42.8, peT: 38.2, pb: 12.4, ps: 8.6, roe: 35.2, divY: 0, divLast: 0, divPrev: 0, divTotal: 0, profit: 87, buyback: 96, incentive: 0, floatShr: 42.5, totalShr: 42.8, prevShr: 43.1, vol: 0.020 }),
    S('USJPM', '摩根大通', 'US', 'USD', 302.40, { peS: 13.8, peT: 12.9, pb: 2.2, ps: 4.6, roe: 16.8, divY: 1.9, divLast: 1.40, divPrev: 1.25, divTotal: 162, profit: 585, buyback: 180, incentive: 0, floatShr: 27.6, totalShr: 27.7, prevShr: 28.2, vol: 0.011 }),
    S('USMCD', '麦当劳', 'US', 'USD', 258.50, { peS: 24.6, peT: 23.1, pb: 0, ps: 7.8, roe: 0, divY: 2.3, divLast: 1.77, divPrev: 1.67, divTotal: 51, profit: 82, buyback: 32, incentive: 0, floatShr: 7.15, totalShr: 7.16, prevShr: 7.2, vol: 0.009 }),
    S('USGS', '高盛', 'US', 'USD', 1041.20, { peS: 15.2, peT: 13.6, pb: 2.4, ps: 5.8, roe: 12.4, divY: 1.5, divLast: 4.0, divPrev: 3.0, divTotal: 47, profit: 161, buyback: 240, incentive: 0, floatShr: 3.05, totalShr: 3.08, prevShr: 3.16, vol: 0.015 }),
    S('USNIO', '蔚来', 'US', 'USD', 3.81, { peS: 0, peT: 0, pb: 2.6, ps: 0.9, roe: -42.5, divY: 0, divLast: 0, divPrev: 0, divTotal: 0, profit: -224, buyback: 0, incentive: 3.2, floatShr: 20.6, totalShr: 21.8, prevShr: 20.2, vol: 0.038 }),
    S('USXPEV', '小鹏汽车', 'US', 'USD', 22.64, { peS: 0, peT: 0, pb: 3.8, ps: 2.6, roe: -12.4, divY: 0, divLast: 0, divPrev: 0, divTotal: 0, profit: -58, buyback: 0, incentive: 2.8, floatShr: 9.4, totalShr: 9.5, prevShr: 9.4, vol: 0.034 }),
    S('USLI', '理想汽车', 'US', 'USD', 24.35, { peS: 14.2, peT: 12.8, pb: 2.8, ps: 1.2, roe: 19.8, divY: 0, divLast: 0, divPrev: 0, divTotal: 0, profit: 80, buyback: 0, incentive: 6.5, floatShr: 10.6, totalShr: 10.6, prevShr: 10.6, vol: 0.027 }),
  ];

  /* ---------------- 指数 ---------------- */
  const INDICES = [
    { code: 'IDXSH',  name: '上证指数',   en: 'SSE COMPOSITE',  market: 'CN', price: 3930.12,  prevClose: 3942.09,  chgPct: -0.30, vol: 0.0009 },
    { code: 'IDXSZ',  name: '深证成指',   en: 'SZSE COMPONENT', market: 'CN', price: 13524.18, prevClose: 13524.18, chgPct: 0.85,  vol: 0.0011 },
    { code: 'IDXKC',  name: '科创50',     en: 'STAR 50',        market: 'CN', price: 1421.63,  prevClose: 1421.63,  chgPct: 1.24,  vol: 0.0016 },
    { code: 'IDXHSI', name: '恒生指数',   en: 'HANG SENG',      market: 'HK', price: 25650.87, prevClose: 25213.31, chgPct: 1.74,  vol: 0.0012 },
    { code: 'IDXHST', name: '恒生科技',   en: 'HS TECH',        market: 'HK', price: 6258.74,  prevClose: 6258.74,  chgPct: -0.58, vol: 0.0018 },
    { code: 'IDXSPX', name: '标普500',    en: 'S&P 500',        market: 'US', price: 7718.60,  prevClose: 7718.60,  chgPct: 0.38,  vol: 0.0008 },
    { code: 'IDXIXIC',name: '纳斯达克',   en: 'NASDAQ',         market: 'US', price: 26506.99, prevClose: 26584.06, chgPct: -0.29, vol: 0.0011 },
    { code: 'IDXDJI', name: '道琼斯',     en: 'DOW JONES',      market: 'US', price: 53414.25, prevClose: 53686.11, chgPct: -0.51, vol: 0.0007 },
  ];

  /* 按当地时间决定滚动条展示哪组指数 */
  function sessionIndices(date) {
    const h = date.getHours();
    // 09:00 - 15:00  A股盘中：上证 / 深成 / 科创50
    if (h >= 9 && h < 15) return { label: 'A股交易时段', list: ['IDXSH', 'IDXSZ', 'IDXKC'] };
    // 15:00 - 16:00  港股尾盘：恒生 / 恒生科技
    if (h >= 15 && h < 16) return { label: '港股交易时段', list: ['IDXHSI', 'IDXHST'] };
    // 16:00 - 次日 09:00  晚间：美股三大指数
    return { label: '美股交易时段', list: ['IDXSPX', 'IDXIXIC', 'IDXDJI'] };
  }

  window.MARKET_DATA = { STOCKS, INDICES, sessionIndices };
})();
