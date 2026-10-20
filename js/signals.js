// Cảnh báo Mua/Bán theo chiến lược (trang signals.html). Hàm thuần: không đụng DOM, không gọi mạng; chạy được trong Node.
// Dùng chung chiến lược với trang Backtest (VST.backtest.STRATEGIES): tín hiệu tính theo giá đóng cửa phiên báo.
//   find(bars, strategies, window) — tín hiệu trong `window` phiên gần nhất (mỗi đợt tín hiệu liên tiếp chỉ tính phiên đầu).
//   evaluate(sig, bars, price)     — % giá từ ngày báo, % lãi/lỗ nếu làm theo tín hiệu, số phiên T+ kể từ ngày báo.
(function (root) {
  const VST = root.VST = root.VST || {};
  const bt = VST.backtest;

  // strategies: [{ id, params }]. Trả về [{ strategy, side: 'buy'|'sell', index, time, price }], mới nhất trước.
  function find(bars, strategies, window) {
    const out = [];
    if (!bars || bars.length < 2) return out;
    const from = Math.max(1, bars.length - window);
    strategies.forEach(function (s) {
      const st = bt.STRATEGIES[s.id];
      if (!st) return;
      const params = Object.assign(bt.defaultParams(s.id), s.params || {});
      if (st.validate && st.validate(params)) return;
      const sig = st.signals(bars, params);
      [['buy', sig.entry], ['sell', sig.exit]].forEach(function (pair) {
        const arr = pair[1];
        for (let i = from; i < bars.length; i++) {
          // Chỉ phiên đầu của một đợt tín hiệu liên tiếp (RSI dưới ngưỡng nhiều phiên liền chỉ báo một lần).
          if (arr[i] && !arr[i - 1]) {
            out.push({ strategy: s.id, side: pair[0], index: i, time: bars[i].time, price: bars[i].close });
          }
        }
      });
    });
    out.sort((a, b) => b.time - a.time || (a.side === b.side ? 0 : a.side === 'buy' ? -1 : 1));
    return out;
  }

  // price: giá hiện tại (realtime) — mặc định giá đóng cửa phiên cuối.
  // change: % giá thay đổi từ ngày báo. pnl: lãi/lỗ nếu làm theo — Mua: = change; Bán: = −change (bán rồi giá giảm là có lợi).
  // sessions: số phiên kể từ phiên báo (T+0 = báo trong phiên gần nhất).
  function evaluate(sig, bars, price) {
    const last = bars.length - 1;
    const now = price > 0 ? price : bars[last].close;
    const change = sig.price > 0 ? now / sig.price - 1 : null;
    return {
      price: now,
      change: change,
      pnl: change == null ? null : sig.side === 'buy' ? change : -change,
      sessions: last - sig.index,
    };
  }

  // Khóa duy nhất của một tín hiệu (để nhận biết tín hiệu mới giữa các lần làm mới).
  function key(symbol, sig) { return symbol + ':' + sig.strategy + ':' + sig.side + ':' + sig.time; }

  VST.signals = { find: find, evaluate: evaluate, key: key };
})(typeof window !== 'undefined' ? window : globalThis);
