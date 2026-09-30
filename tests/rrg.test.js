// Kiểm thử phần tính RRG trong js/rrg.js.
// Chạy: `node tests/rrg.test.js`, hoặc mở tests/index.html qua web server tĩnh.
(function () {
  const isNode = typeof window === 'undefined';
  if (isNode) {
    const path = require('path');
    globalThis.window = globalThis;
    require(path.join(__dirname, '../js/indicators.js'));
    require(path.join(__dirname, '../js/rrg.js'));
  }
  const rrg = window.VST.rrg;
  const results = [];

  function test(name, fn) {
    try { fn(); results.push({ name: name, ok: true }); } catch (e) { results.push({ name: name, ok: false, err: e.message }); }
  }
  function eq(actual, expected, msg) {
    if (actual !== expected) throw new Error((msg ? msg + ': ' : '') + 'mong đợi ' + expected + ', nhận ' + actual);
  }
  function near(actual, expected, eps, msg) {
    if (!(Math.abs(actual - expected) <= eps)) throw new Error((msg ? msg + ': ' : '') + 'mong đợi ≈' + expected + ', nhận ' + actual);
  }

  // 02/01/2024 (thứ Ba) 00:00 giờ VN, cách nhau 1 ngày (bỏ qua cuối tuần cho đơn giản).
  const T0 = Date.UTC(2024, 0, 2) / 1000 - 7 * 3600;
  function mkBars(closes) {
    return closes.map(function (c, i) { return { time: T0 + i * 86400, open: c, high: c, low: c, close: c, volume: 1 }; });
  }
  const P = { ratio: 10, momentum: 3, smooth: 2 };

  test('Góc phần tư theo RS-Ratio và RS-Momentum', function () {
    eq(rrg.quadrant(101, 101), 'leading');
    eq(rrg.quadrant(101, 99), 'weakening');
    eq(rrg.quadrant(99, 99), 'lagging');
    eq(rrg.quadrant(99, 101), 'improving');
  });

  test('Khóa tuần bắt đầu từ thứ Hai', function () {
    const mon = Date.UTC(2024, 0, 8) / 1000 - 7 * 3600;  // thứ Hai
    eq(rrg.weekKey(mon), rrg.weekKey(mon + 4 * 86400), 'thứ Hai và thứ Sáu cùng tuần');
    eq(rrg.weekKey(mon) - 1, rrg.weekKey(mon - 86400), 'Chủ nhật thuộc tuần trước');
  });

  test('Gộp khung tuần lấy giá đóng cửa cuối tuần', function () {
    const mon = Date.UTC(2024, 0, 8) / 1000 - 7 * 3600;
    const bars = [0, 1, 2, 3, 4, 7, 8].map(function (d, i) { return { time: mon + d * 86400, close: 10 + i }; });
    const w = rrg.toCloses(bars, 'W');
    eq(w.length, 2);
    eq(w[0].close, 14);
    eq(w[1].close, 16);
  });

  test('Mã đi cùng chỉ số: RS-Ratio = RS-Momentum = 100', function () {
    const closes = [];
    for (let i = 0; i < 60; i++) closes.push(100 + Math.sin(i / 5) * 10);
    const idx = rrg.toCloses(mkBars(closes), 'D');
    const stock = rrg.toCloses(mkBars(closes.map(function (c) { return c / 4; })), 'D');
    const pts = rrg.compute(stock, idx, P);
    eq(pts.length > 0, true, 'có điểm');
    pts.forEach(function (p) { near(p.ratio, 100, 1e-9); near(p.momentum, 100, 1e-9); });
  });

  test('Mã tăng mạnh hơn chỉ số nằm ở vùng Dẫn dắt', function () {
    const idx = [], stock = [];
    for (let i = 0; i < 60; i++) { idx.push(100); stock.push(100 * Math.pow(1.01, i * i / 30)); }
    const s = rrg.summarize(rrg.compute(rrg.toCloses(mkBars(stock), 'D'), rrg.toCloses(mkBars(idx), 'D'), P), 5);
    eq(s.quadrant, 'leading');
    eq(s.points.length, 6, 'đuôi 5 kỳ = 6 điểm');
    eq(s.ratio > 100 && s.momentum > 100, true);
  });

  test('Mã giảm so với chỉ số nằm ở vùng Tụt hậu', function () {
    const idx = [], stock = [];
    for (let i = 0; i < 60; i++) { idx.push(100); stock.push(100 * Math.pow(0.99, i * i / 30)); }
    const s = rrg.summarize(rrg.compute(rrg.toCloses(mkBars(stock), 'D'), rrg.toCloses(mkBars(idx), 'D'), P), 5);
    eq(s.quadrant, 'lagging');
  });

  test('Chỉ số ngành: trung bình đồng tỷ trọng lợi nhuận ngày', function () {
    const bench = mkBars([1, 1, 1]);
    const a = mkBars([10, 11, 11]);   // +10%, 0%
    const b = mkBars([20, 20, 18]);   // 0%, −10%
    const idx = rrg.sectorIndex([a, b], bench);
    near(idx[0].close, 100, 1e-9);
    near(idx[1].close, 105, 1e-9);
    near(idx[2].close, 105 * 0.95, 1e-9);
  });

  test('Chỉ số ngành bỏ qua phiên biến động quá ±15% (chưa điều chỉnh)', function () {
    const bench = mkBars([1, 1, 1]);
    const a = mkBars([10, 7, 7.7]);   // −30% (chia cổ phiếu) rồi +10%
    const b = mkBars([20, 21, 21]);   // +5%, 0%
    const idx = rrg.sectorIndex([a, b], bench);
    near(idx[1].close, 105, 1e-9, 'chỉ tính mã b');
    near(idx[2].close, 105 * 1.05, 1e-9);
  });

  test('Chỉ số ngành: mã niêm yết sau vẫn được tính từ khi có dữ liệu', function () {
    const bench = mkBars([1, 1, 1, 1]);
    const a = mkBars([10, 10, 10, 10]);
    const late = mkBars([0, 0, 20, 22]).map(function (b) { return b.close ? b : Object.assign({}, b, { close: 0 }); });
    const idx = rrg.sectorIndex([a, late], bench);
    near(idx[2].close, 100, 1e-9);
    near(idx[3].close, 105, 1e-9, '(0% + 10%) / 2');
  });

  // ---------- Báo cáo ----------

  const failed = results.filter(function (r) { return !r.ok; });
  if (isNode) {
    results.forEach(function (r) { console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '' : ' — ' + r.err)); });
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' bài kiểm tra đạt.');
    process.exitCode = failed.length ? 1 : 0;
  } else {
    const esc = function (x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    const el = document.getElementById('results-rrg');
    el.innerHTML = '<p class="' + (failed.length ? 'down' : 'up') + '">' + (results.length - failed.length) + '/' +
      results.length + ' bài kiểm tra đạt.</p><ul>' + results.map(function (r) {
      return '<li class="' + (r.ok ? 'up' : 'down') + '">' + (r.ok ? '✓ ' : '✗ ') + esc(r.name) +
        (r.ok ? '' : ' — ' + esc(r.err)) + '</li>';
    }).join('') + '</ul>';
  }
})();
