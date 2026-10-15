// Kiểm thử bộ lọc cổ phiếu trong js/scan.js.
// Chạy: `node tests/scan.test.js`, hoặc mở tests/index.html qua web server tĩnh.
(function () {
  const isNode = typeof window === 'undefined';
  if (isNode) {
    const path = require('path');
    globalThis.window = globalThis;
    require(path.join(__dirname, '../js/indicators.js'));
    require(path.join(__dirname, '../js/scan.js'));
  }
  const scan = window.VST.scan;
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

  const T0 = Date.UTC(2024, 0, 2) / 1000 - 7 * 3600;
  // closes: giá đóng cửa; vols: KL (mặc định 100.000); high = close + 0,5; low = close − 0,5.
  function mkBars(closes, vols) {
    return closes.map(function (c, i) {
      return { time: T0 + i * 86400, open: c, high: c + 0.5, low: c - 0.5, close: c, volume: vols ? vols[i] : 100000 };
    });
  }
  function range(n, f) { const a = []; for (let i = 0; i < n; i++) a.push(f(i)); return a; }

  // 260 phiên tăng đều từ 20 lên ~46 nghìn đồng.
  const upCloses = range(260, (i) => 20 + i * 0.1);
  const up = scan.metrics(mkBars(upCloses));
  // 260 phiên giảm đều.
  const down = scan.metrics(mkBars(range(260, (i) => 50 - i * 0.1)));

  test('Quá ít dữ liệu thì không tính', function () {
    eq(scan.metrics(mkBars(range(20, () => 10))), null);
    eq(scan.metrics(null), null);
  });

  test('Giá, % thay đổi và MA', function () {
    near(up.price, 45.9, 1e-9);
    near(up.chg1, (45.9 / 45.8 - 1) * 100, 1e-9);
    near(up.chg[20], (45.9 / 43.9 - 1) * 100, 1e-9);
    near(up.ma[20], 45.9 - 0.95, 1e-9, 'MA20 = trung bình 20 phiên cuối');
    eq(up.ma[200] < up.ma[50] && up.ma[50] < up.ma[20], true, 'xu hướng tăng thì MA20 > MA50 > MA200');
  });

  test('Giá trị giao dịch bình quân 20 phiên tính theo tỷ đồng', function () {
    // 20 phiên cuối: giá TB 44,95 nghìn × 100.000 cp = 4,495 tỷ.
    near(up.value20, 4.495, 1e-9);
  });

  test('Đỉnh 52 tuần và đỉnh N phiên trước', function () {
    near(up.high52, 46.4, 1e-9);
    near(up.fromHigh52, (45.9 / 46.4 - 1) * 100, 1e-9);
    near(up.prevHigh[20], 45.8 + 0.5, 1e-9, 'đỉnh 20 phiên trước = high của phiên liền trước');
  });

  test('Khối lượng đột biến so với 20 phiên trước', function () {
    const vols = range(60, () => 100000);
    vols[59] = 300000;
    const m = scan.metrics(mkBars(range(60, () => 10), vols));
    near(m.avgVol20, 100000, 1e-9, 'không tính phiên gần nhất vào bình quân');
    near(m.volRatio, 3, 1e-9);
  });

  test('MACD cắt lên: đếm số phiên từ lúc cắt', function () {
    // Giảm 80 phiên rồi tăng 6 phiên → histogram vừa chuyển dương.
    const closes = range(80, (i) => 50 - i * 0.3).concat(range(6, (i) => 26.3 + (i + 1) * 1.5));
    const m = scan.metrics(mkBars(closes));
    eq(m.macdCrossAgo != null && m.macdCrossAgo <= 5, true, 'có điểm cắt lên trong 5 phiên');
    eq(scan.run([{ symbol: 'X', m: m }], { macd: { mode: 'cross', within: 5 } }).length, 1);
    eq(scan.run([{ symbol: 'X', m: down }], { macd: { mode: 'cross', within: 5 } }).length, 0, 'xu hướng giảm đều: không cắt lên');
  });

  test('Vượt đỉnh N phiên trước', function () {
    const flat = range(60, () => 10);
    const jump = scan.metrics(mkBars(flat.concat([11])));
    const touch = scan.metrics(mkBars(flat.concat([10.5])));
    eq(scan.run([{ symbol: 'J', m: jump }], { breakout: { period: '20' } }).length, 1, 'đóng cửa 11 > đỉnh 10,5');
    eq(scan.run([{ symbol: 'T', m: touch }], { breakout: { period: '20' } }).length, 0, 'chạm đỉnh chưa tính là vượt');
  });

  const rows = [{ symbol: 'UP', m: up }, { symbol: 'DOWN', m: down }, { symbol: 'NODATA', m: null }];

  test('Từng tiêu chí phân biệt mã tăng / mã giảm', function () {
    const only = (f) => scan.run(rows, f).map((r) => r.symbol).join(',');
    eq(only({ aboveMa: { ma: '200' } }), 'UP');
    eq(only({ maTrend: { mode: '20>50>200' } }), 'UP');
    eq(only({ perf: { period: '20', min: 0 } }), 'UP');
    eq(only({ perf: { period: '20', min: -100 } }), 'UP,DOWN', 'nhập số âm để lấy cả mã giảm');
    eq(only({ nearHigh: { within: 5 } }), 'UP');
    eq(only({ breakout: { period: '20' } }), '', 'tăng đều 0,1 không vượt được high (+0,5) phiên trước');
    eq(only({ rsi: { min: 70, max: 100 } }), 'UP', 'tăng liên tục → RSI = 100');
    eq(only({ rsi: { min: 0, max: 30 } }), 'DOWN');
    eq(only({ price: { min: 40, max: 50 } }), 'UP');
    eq(only({ liquidity: { min: 4 } }), 'UP', 'mã giảm giá thấp hơn nên giá trị GD thấp hơn');
  });

  test('Kết hợp nhiều tiêu chí và cho phép trượt', function () {
    const f = { aboveMa: { ma: '50' }, rsi: { min: 0, max: 30 }, liquidity: { min: 0 } };
    eq(scan.run(rows, f).length, 0, 'không mã nào đạt cả 3');
    const loose = scan.run(rows, f, 1);
    eq(loose.length, 2, 'cho trượt 1 thì cả hai mã đều đạt');
    eq(loose[0].passed, 2);
    eq(loose.find((r) => r.symbol === 'UP').failed.join(), 'rsi');
  });

  test('Không bật tiêu chí nào thì giữ mọi mã có dữ liệu', function () {
    eq(scan.run(rows, {}).length, 2);
  });

  test('Chuẩn hóa tham số: ô trống bỏ qua cận, lựa chọn sai về mặc định', function () {
    const p = scan.normalize('rsi', { min: '', max: '60' });
    eq(p.min, null);
    eq(p.max, 60);
    eq(scan.normalize('aboveMa', { ma: '999' }).ma, '50');
    eq(scan.run(rows, { rsi: { min: '', max: '' } }).length, 2, 'không có cận nào → mã nào có RSI đều đạt');
  });

  test('Bộ lọc mẫu chỉ dùng tiêu chí và lựa chọn có thật', function () {
    scan.PRESETS.forEach(function (ps) {
      Object.keys(ps.filters).forEach(function (id) {
        const c = scan.criterion(id);
        if (!c) throw new Error(ps.label + ': không có tiêu chí ' + id);
        const n = scan.normalize(id, ps.filters[id]);
        Object.keys(ps.filters[id]).forEach(function (k) {
          eq(String(n[k]), String(ps.filters[id][k]), ps.label + ' / ' + id + '.' + k);
        });
      });
    });
    eq(scan.CRITERIA.length >= 5, true, 'ít nhất 5 tiêu chí');
  });

  // ---------- Báo cáo ----------
  const fail = results.filter((r) => !r.ok);
  if (isNode) {
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : ' — ' + r.err)); });
    console.log('\n' + (results.length - fail.length) + '/' + results.length + ' bài kiểm thử đạt.');
    if (fail.length) process.exitCode = 1;
  } else {
    const esc = function (x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    const el = document.getElementById('results-scan');
    el.innerHTML = '<p class="' + (fail.length ? 'down' : 'up') + '">' + (results.length - fail.length) + '/' +
      results.length + ' bài kiểm thử đạt.</p><ul>' + results.map(function (r) {
      return '<li class="' + (r.ok ? 'up' : 'down') + '">' + (r.ok ? '✓ ' : '✗ ') + esc(r.name) +
        (r.ok ? '' : ' — ' + esc(r.err)) + '</li>';
    }).join('') + '</ul>';
  }
})();
