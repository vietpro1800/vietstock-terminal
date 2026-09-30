// Tính RRG (Relative Rotation Graph): sức mạnh tương đối của ngành / cổ phiếu so với chỉ số chuẩn.
// Hàm thuần: không đụng DOM, không gọi mạng. Chạy được cả trên trình duyệt lẫn Node (để kiểm thử).
//
// Công thức RS-Ratio / RS-Momentum gốc của JdK là độc quyền; ở đây dùng cách xấp xỉ phổ biến:
//   RS         = 100 × giá / chỉ số chuẩn
//   RS-Ratio   = 100 × EMA(RS, smooth) / SMA(EMA(RS, smooth), ratio)   → >100: mạnh hơn thị trường
//   RS-Momentum = 100 × RS-Ratio / RS-Ratio (momentum kỳ trước)         → >100: sức mạnh đang tăng
(function (root) {
  const VST = root.VST = root.VST || {};
  const ind = VST.indicators;

  const VN_OFFSET = 7 * 3600;
  // Biến động ngày vượt ±15% (lớn hơn biên độ mọi sàn) coi là do chia tách/cổ tức chưa điều chỉnh,
  // bỏ qua khi tính chỉ số ngành để không kéo lệch cả ngành.
  const MAX_DAILY_MOVE = 0.15;

  const QUADRANTS = {
    leading: 'Dẫn dắt',
    weakening: 'Suy yếu',
    lagging: 'Tụt hậu',
    improving: 'Cải thiện',
  };

  function quadrant(ratio, momentum) {
    if (ratio >= 100) return momentum >= 100 ? 'leading' : 'weakening';
    return momentum >= 100 ? 'improving' : 'lagging';
  }

  // Khóa ngày theo giờ VN, và khóa tuần (bắt đầu thứ Hai). Ngày 0 (01/01/1970) là thứ Năm.
  function dayKey(t) { return Math.floor((t + VN_OFFSET) / 86400); }
  function weekKey(t) { return Math.floor((dayKey(t) + 3) / 7); }

  // Nến → [{key, time, close}] theo khung 'D' hoặc 'W' (lấy giá đóng cửa cuối cùng của kỳ).
  function toCloses(bars, tf) {
    const keyOf = tf === 'W' ? weekKey : dayKey;
    const out = [];
    for (const b of bars) {
      if (!(b.close > 0)) continue;
      const k = keyOf(b.time);
      const last = out[out.length - 1];
      if (last && last.key === k) { last.close = b.close; last.time = b.time; } else out.push({ key: k, time: b.time, close: b.close });
    }
    return out;
  }

  // Chỉ số ngành đồng tỷ trọng, nối chuỗi theo lợi nhuận ngày: mỗi phiên lấy trung bình lợi nhuận
  // của các mã có dữ liệu cả phiên này lẫn phiên trước. Trả về nến giả { time, close } theo lịch
  // phiên của chỉ số chuẩn (benchBars) để dùng chung toCloses().
  function sectorIndex(memberBars, benchBars) {
    const maps = memberBars.map(function (bars) {
      const m = new Map();
      bars.forEach(function (b) { if (b.close > 0) m.set(dayKey(b.time), b.close); });
      return m;
    });
    const out = [];
    let value = 100;
    let prevKey = null;
    for (const b of benchBars) {
      const k = dayKey(b.time);
      if (prevKey != null) {
        let sum = 0, n = 0;
        for (const m of maps) {
          const c = m.get(k), p = m.get(prevKey);
          if (c == null || p == null) continue;
          const r = c / p - 1;
          if (Math.abs(r) > MAX_DAILY_MOVE) continue;
          sum += r;
          n++;
        }
        if (n) value *= 1 + sum / n;
      }
      // Chỉ bắt đầu ghi khi đã có ít nhất một mã có dữ liệu.
      if (out.length || maps.some(function (m) { return m.has(k); })) out.push({ time: b.time, close: value });
      prevKey = k;
    }
    return out;
  }

  // series, bench: [{key, time, close}] cùng khung. Trả về [{time, ratio, momentum, close}]
  // chỉ gồm các kỳ đã đủ dữ liệu.
  function compute(series, bench, params) {
    const bmap = new Map(bench.map(function (b) { return [b.key, b.close]; }));
    const rows = [];
    for (const s of series) {
      const b = bmap.get(s.key);
      if (b > 0) rows.push({ time: s.time, close: s.close, rs: 100 * s.close / b });
    }
    const smooth = ind.ema(rows.map(function (r) { return r.rs; }), params.smooth);
    const first = smooth.findIndex(function (v) { return v != null; });
    if (first < 0) return [];
    const base = ind.sma(smooth.slice(first), params.ratio);
    const ratio = rows.map(function (_, i) {
      const avg = i >= first ? base[i - first] : null;
      return avg ? 100 * smooth[i] / avg : null;
    });
    const out = [];
    for (let i = params.momentum; i < rows.length; i++) {
      const r = ratio[i], p = ratio[i - params.momentum];
      if (r == null || p == null) continue;
      out.push({ time: rows[i].time, close: rows[i].close, ratio: r, momentum: 100 * r / p });
    }
    return out;
  }

  // Gói kết quả cho một nhóm: n kỳ cuối (đuôi) + góc phần tư + % thay đổi giá trong đuôi.
  function summarize(points, tail) {
    if (!points.length) return null;
    const pts = points.slice(-(tail + 1));
    const head = pts[pts.length - 1];
    return {
      points: pts,
      ratio: head.ratio,
      momentum: head.momentum,
      quadrant: quadrant(head.ratio, head.momentum),
      change: pts.length > 1 ? head.close / pts[0].close - 1 : 0,
      time: head.time,
    };
  }

  // Số kỳ tối thiểu cần có để ra được đuôi dài `tail`.
  function minPeriods(params, tail) { return params.smooth + params.ratio + params.momentum + tail; }

  VST.rrg = {
    QUADRANTS: QUADRANTS,
    MAX_DAILY_MOVE: MAX_DAILY_MOVE,
    quadrant: quadrant,
    dayKey: dayKey,
    weekKey: weekKey,
    toCloses: toCloses,
    sectorIndex: sectorIndex,
    compute: compute,
    summarize: summarize,
    minPeriods: minPeriods,
  };
})(typeof window !== 'undefined' ? window : globalThis);
