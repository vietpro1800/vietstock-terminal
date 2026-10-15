// Bộ lọc cổ phiếu (scanner) — hàm thuần, không đụng DOM, không gọi mạng; chạy được cả trong Node.
// 1) metrics(bars): tính một lần các chỉ số của mỗi mã từ nến ngày.
// 2) run(rows, filters): lọc theo các tiêu chí đang bật, tức thì, không cần tải lại dữ liệu.
window.VST = window.VST || {};

VST.scan = (function () {
  const ind = VST.indicators;
  const PERF_PERIODS = [5, 20, 60, 120];
  const BREAKOUT_PERIODS = [20, 50];
  const YEAR_BARS = 250; // ~52 tuần giao dịch

  function last(arr) { return arr.length ? arr[arr.length - 1] : null; }
  function pct(a, b) { return b > 0 ? (a / b - 1) * 100 : null; }

  // bars: nến ngày [{time, open, high, low, close, volume}] tăng dần theo thời gian, giá theo nghìn đồng.
  // Trả về null nếu quá ít dữ liệu. Giá trị nào chưa đủ dữ liệu để tính thì là null.
  function metrics(bars) {
    if (!bars || bars.length < 30) return null;
    const n = bars.length;
    const closes = bars.map((b) => b.close);
    const vols = bars.map((b) => b.volume);
    const price = closes[n - 1];

    const chg = {};
    PERF_PERIODS.forEach(function (p) { chg[p] = n > p ? pct(price, closes[n - 1 - p]) : null; });

    const ma = {};
    [20, 50, 200].forEach(function (p) { ma[p] = last(ind.sma(closes, p)); });

    const m = ind.macd(closes);
    let macdCrossAgo = null;
    for (let i = n - 1; i > 0 && n - 1 - i <= 60; i--) {
      const a = m.hist[i], b = m.hist[i - 1];
      if (a == null || b == null) break;
      if (a > 0 && b <= 0) { macdCrossAgo = n - 1 - i; break; }
    }

    // KL bình quân 20 phiên TRƯỚC phiên gần nhất, để so phiên gần nhất có đột biến hay không.
    let avgVol20 = null;
    if (n > 20) {
      let s = 0;
      for (let i = n - 21; i < n - 1; i++) s += vols[i];
      avgVol20 = s / 20;
    }
    // Giá trị giao dịch bình quân 20 phiên, tỷ đồng (giá nghìn đồng × KL / 1e6).
    let value20 = 0;
    const k20 = Math.min(20, n);
    for (let i = n - k20; i < n; i++) value20 += closes[i] * vols[i];
    value20 = value20 / k20 / 1e6;

    let high52 = -Infinity, low52 = Infinity;
    for (let i = Math.max(0, n - YEAR_BARS); i < n; i++) {
      high52 = Math.max(high52, bars[i].high);
      low52 = Math.min(low52, bars[i].low);
    }

    // Đỉnh cao nhất của N phiên liền trước phiên gần nhất (không tính phiên gần nhất).
    const prevHigh = {};
    BREAKOUT_PERIODS.forEach(function (p) {
      if (n <= p) { prevHigh[p] = null; return; }
      let h = -Infinity;
      for (let i = n - 1 - p; i < n - 1; i++) h = Math.max(h, bars[i].high);
      prevHigh[p] = h;
    });

    return {
      time: bars[n - 1].time,
      price: price,
      chg1: pct(price, closes[n - 2]),
      chg: chg,
      ma: ma,
      rsi: last(ind.rsi(closes, 14)),
      macd: last(m.macd),
      signal: last(m.signal),
      hist: last(m.hist),
      macdCrossAgo: macdCrossAgo,
      vol: vols[n - 1],
      avgVol20: avgVol20,
      volRatio: avgVol20 > 0 ? vols[n - 1] / avgVol20 : null,
      value20: value20,
      high52: high52,
      low52: low52,
      fromHigh52: pct(price, high52),   // ≤ 0: % thấp hơn đỉnh 52 tuần
      prevHigh: prevHigh,
    };
  }

  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const between = (v, lo, hi) => isNum(v) && (!isNum(lo) || v >= lo) && (!isNum(hi) || v <= hi);

  // Định nghĩa tiêu chí. params: các ô nhập trên giao diện; test(m, p) → true nếu mã đạt.
  const CRITERIA = [
    {
      id: 'liquidity', label: 'Thanh khoản',
      hint: 'Giá trị giao dịch bình quân 20 phiên',
      params: [{ key: 'min', label: 'Tối thiểu (tỷ đồng)', type: 'number', def: 10, step: 1 }],
      test: (m, p) => between(m.value20, p.min, null),
    },
    {
      id: 'price', label: 'Vùng giá',
      hint: 'Giá đóng cửa gần nhất (nghìn đồng)',
      params: [
        { key: 'min', label: 'Từ', type: 'number', def: 10, step: 1 },
        { key: 'max', label: 'Đến', type: 'number', def: 200, step: 1 },
      ],
      test: (m, p) => between(m.price, p.min, p.max),
    },
    {
      id: 'aboveMa', label: 'Giá trên đường MA',
      hint: 'Giá đóng cửa nằm trên đường trung bình',
      params: [{ key: 'ma', label: 'Đường MA', type: 'select', def: '50', options: [['20', 'MA20'], ['50', 'MA50'], ['200', 'MA200']] }],
      test: (m, p) => isNum(m.ma[p.ma]) && m.price > m.ma[p.ma],
    },
    {
      id: 'maTrend', label: 'Xu hướng MA',
      hint: 'Các đường MA xếp theo thứ tự tăng',
      params: [{ key: 'mode', label: 'Điều kiện', type: 'select', def: '20>50>200',
        options: [['20>50', 'MA20 > MA50'], ['50>200', 'MA50 > MA200'], ['20>50>200', 'MA20 > MA50 > MA200']] }],
      test: function (m, p) {
        const list = String(p.mode).split('>');
        for (let i = 0; i < list.length - 1; i++) {
          const a = m.ma[list[i]], b = m.ma[list[i + 1]];
          if (!isNum(a) || !isNum(b) || !(a > b)) return false;
        }
        return true;
      },
    },
    {
      id: 'rsi', label: 'RSI (14)',
      hint: 'Dưới 30: quá bán · trên 70: quá mua',
      params: [
        { key: 'min', label: 'Từ', type: 'number', def: 50, step: 1 },
        { key: 'max', label: 'Đến', type: 'number', def: 70, step: 1 },
      ],
      test: (m, p) => between(m.rsi, p.min, p.max),
    },
    {
      id: 'macd', label: 'MACD',
      hint: 'MACD (12, 26, 9) so với đường tín hiệu',
      params: [
        { key: 'mode', label: 'Điều kiện', type: 'select', def: 'cross',
          options: [['cross', 'Cắt lên đường tín hiệu'], ['above', 'Nằm trên đường tín hiệu'], ['positive', 'MACD > 0 và trên tín hiệu']] },
        { key: 'within', label: 'Cắt lên trong (phiên)', type: 'number', def: 5, step: 1, showIf: { mode: 'cross' } },
      ],
      test: function (m, p) {
        if (!isNum(m.macd) || !isNum(m.signal)) return false;
        if (p.mode === 'above') return m.macd > m.signal;
        if (p.mode === 'positive') return m.macd > 0 && m.macd > m.signal;
        return m.macdCrossAgo != null && m.macdCrossAgo <= (isNum(p.within) ? p.within : 5) && m.macd > m.signal;
      },
    },
    {
      id: 'volSpike', label: 'Khối lượng đột biến',
      hint: 'KL phiên gần nhất so với bình quân 20 phiên trước',
      params: [{ key: 'ratio', label: 'Gấp ít nhất (lần)', type: 'number', def: 1.5, step: 0.1 }],
      test: (m, p) => between(m.volRatio, p.ratio, null),
    },
    {
      id: 'perf', label: 'Hiệu suất giá',
      hint: '% thay đổi giá trong N phiên (nhập số âm để tìm mã giảm)',
      params: [
        { key: 'period', label: 'Số phiên', type: 'select', def: '20', options: PERF_PERIODS.map((p) => [String(p), p + ' phiên']) },
        { key: 'min', label: 'Tối thiểu (%)', type: 'number', def: 5, step: 1 },
      ],
      test: (m, p) => between(m.chg[p.period], p.min, null),
    },
    {
      id: 'nearHigh', label: 'Gần đỉnh 52 tuần',
      hint: 'Giá thấp hơn đỉnh cao nhất 52 tuần không quá X%',
      params: [{ key: 'within', label: 'Cách đỉnh tối đa (%)', type: 'number', def: 10, step: 1 }],
      test: (m, p) => isNum(m.fromHigh52) && -m.fromHigh52 <= (isNum(p.within) ? p.within : 0),
    },
    {
      id: 'breakout', label: 'Vượt đỉnh (breakout)',
      hint: 'Giá đóng cửa vượt đỉnh cao nhất của N phiên trước',
      params: [{ key: 'period', label: 'Đỉnh của', type: 'select', def: '20', options: BREAKOUT_PERIODS.map((p) => [String(p), p + ' phiên']) }],
      test: (m, p) => isNum(m.prevHigh[p.period]) && m.price > m.prevHigh[p.period],
    },
  ];

  const BY_ID = {};
  CRITERIA.forEach(function (c) { BY_ID[c.id] = c; });

  // Bộ lọc mẫu: { tiêu chí: tham số } (tham số thiếu thì lấy mặc định).
  const PRESETS = [
    { id: 'trend', label: 'Xu hướng tăng mạnh', filters: {
      liquidity: { min: 10 }, aboveMa: { ma: '50' }, maTrend: { mode: '20>50>200' }, rsi: { min: 50, max: 75 }, nearHigh: { within: 15 } } },
    { id: 'breakout', label: 'Bứt phá có khối lượng', filters: {
      liquidity: { min: 5 }, breakout: { period: '20' }, volSpike: { ratio: 1.5 }, aboveMa: { ma: '20' } } },
    { id: 'rebound', label: 'Quá bán chờ hồi', filters: {
      liquidity: { min: 5 }, rsi: { min: 0, max: 40 }, macd: { mode: 'cross', within: 5 } } },
    { id: 'money', label: 'Dòng tiền vào', filters: {
      liquidity: { min: 20 }, volSpike: { ratio: 2 }, perf: { period: '5', min: 3 } } },
  ];

  function defaults(id) {
    const out = {};
    BY_ID[id].params.forEach(function (p) { out[p.key] = p.def; });
    return out;
  }

  // Ép tham số về đúng kiểu: number → số (ô trống = null, tức bỏ qua cận đó), select → giá trị hợp lệ.
  function normalize(id, params) {
    const c = BY_ID[id];
    const out = {};
    c.params.forEach(function (p) {
      let v = params && Object.prototype.hasOwnProperty.call(params, p.key) ? params[p.key] : p.def;
      if (p.type === 'number') {
        v = v === '' || v == null ? null : Number(v);
        if (!isFinite(v)) v = null;
      } else if (!p.options.some((o) => o[0] === String(v))) {
        v = p.def;
      } else {
        v = String(v);
      }
      out[p.key] = v;
    });
    return out;
  }

  // rows: [{ symbol, m }]; filters: { [id]: params } chỉ gồm tiêu chí đang bật.
  // maxMiss: số tiêu chí được phép trượt (0 = phải đạt tất cả).
  // Trả về các dòng đạt, kèm passed (số tiêu chí đạt) và failed (mảng id trượt).
  function run(rows, filters, maxMiss) {
    const ids = Object.keys(filters || {}).filter((id) => BY_ID[id]);
    const norm = {};
    ids.forEach(function (id) { norm[id] = normalize(id, filters[id]); });
    const out = [];
    rows.forEach(function (r) {
      if (!r.m) return;
      const failed = ids.filter((id) => !BY_ID[id].test(r.m, norm[id]));
      if (failed.length <= (maxMiss || 0)) out.push(Object.assign({}, r, { passed: ids.length - failed.length, failed: failed }));
    });
    return out;
  }

  return {
    CRITERIA: CRITERIA, PRESETS: PRESETS, PERF_PERIODS: PERF_PERIODS,
    metrics: metrics, run: run, defaults: defaults, normalize: normalize,
    criterion: (id) => BY_ID[id] || null,
  };
})();
