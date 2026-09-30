// Kiểm thử phần tính phí, lô 100, T+2 và mô phỏng trong js/backtest.js.
// Chạy: `node tests/backtest.test.js`, hoặc mở tests/index.html qua web server tĩnh.
(function () {
  const isNode = typeof window === 'undefined';
  if (isNode) {
    const path = require('path');
    globalThis.window = globalThis;
    require(path.join(__dirname, '../js/indicators.js'));
    require(path.join(__dirname, '../js/backtest.js'));
  }
  const bt = window.VST.backtest;
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

  // Tạo nến giả: mỗi phần tử [open, close], high/low tự suy ra, time cách nhau 1 ngày.
  function mkBars(rows) {
    return rows.map(function (r, i) {
      return { time: 1700000000 + i * 86400, open: r[0], close: r[1], high: Math.max(r[0], r[1]), low: Math.min(r[0], r[1]), volume: 1000 };
    });
  }
  function flags(n, idx) {
    const a = new Array(n).fill(false);
    idx.forEach(function (i) { a[i] = true; });
    return a;
  }

  // ---------- Phí và thuế ----------

  test('Phí mua 0,15% trên giá trị khớp', function () {
    const r = bt.buyCost(25.5, 100);          // 25,5 nghìn × 100 cp = 2.550.000 đ
    eq(r.value, 2550000, 'giá trị');
    eq(r.fee, 3825, 'phí');
    eq(r.total, 2553825, 'tổng tiền trả');
  });

  test('Bán: trừ phí 0,15% và thuế 0,1%', function () {
    const r = bt.sellProceeds(30, 100);       // 3.000.000 đ
    eq(r.fee, 4500, 'phí bán');
    eq(r.tax, 3000, 'thuế bán');
    eq(r.net, 2992500, 'thực nhận');
  });

  test('Phí, thuế chỉnh được', function () {
    const c = { buyFee: 0.001, sellFee: 0.002, sellTax: 0.001 };
    eq(bt.buyCost(10, 1000, c).fee, 10000);
    const s = bt.sellProceeds(10, 1000, c);
    eq(s.fee, 20000);
    eq(s.tax, 10000);
    eq(s.net, 9970000);
  });

  test('Giá lẻ không sinh sai số tiền (làm tròn đến đồng)', function () {
    const r = bt.buyCost(23.45, 300);
    eq(r.value, 7035000);
    eq(Number.isInteger(r.fee), true, 'phí là số nguyên');
  });

  // ---------- Lô 100 ----------

  test('Mua theo lô 100, không vượt quá tiền mặt', function () {
    eq(bt.maxShares(10000000, 25.5), 300); // 10tr / (25.500 × 1,0015) ≈ 391 → 300
    eq(bt.maxShares(10000000, 10), 900);   // ≈ 998 → 900
  });

  test('Đủ tiền đúng 1 lô (tính cả phí) thì mua, thiếu 1 đồng thì không', function () {
    eq(bt.maxShares(2553825, 25.5), 100);
    eq(bt.maxShares(2553824, 25.5), 0);
  });

  // ---------- T+2 ----------

  test('T+2: mua phiên k, chỉ bán được từ phiên k+2', function () {
    eq(bt.canSell(5, 5), false);
    eq(bt.canSell(5, 6), false);
    eq(bt.canSell(5, 7), true);
    eq(bt.canSell(5, 6, 1), true, 'đổi thành T+1');
  });

  test('Vào lệnh ở giá mở cửa phiên sau tín hiệu', function () {
    const bars = mkBars([[10, 10], [10, 10], [11, 11], [12, 12], [13, 13], [14, 14]]);
    const r = bt.run(bars, { capital: 10e6, signals: { entry: flags(6, [1]), exit: flags(6, []) } });
    eq(r.trades[0].entryIndex, 2);
    eq(r.trades[0].entryPrice, 11, 'giá mua = giá mở cửa phiên 2');
  });

  test('Tín hiệu bán ngay phiên mua bị hoãn đến T+2', function () {
    // Tín hiệu mua phiên 1 → mua phiên 2. Tín hiệu bán phiên 2 → nếu không có T+2 sẽ bán phiên 3,
    // nhưng phải chờ tới phiên 4.
    const bars = mkBars([[10, 10], [10, 10], [11, 11], [12, 12], [13, 13], [14, 14], [15, 15]]);
    const r = bt.run(bars, { capital: 10e6, signals: { entry: flags(7, [1]), exit: flags(7, [2]) } });
    eq(r.trades.length, 1);
    eq(r.trades[0].entryIndex, 2);
    eq(r.trades[0].exitIndex, 4, 'bán ở phiên k+2');
    eq(r.trades[0].exitPrice, 13);
    eq(r.trades[0].sessions, 2);
  });

  test('Tín hiệu bán sau khi cổ phiếu đã về thì bán ngay phiên sau', function () {
    const bars = mkBars([[10, 10], [10, 10], [11, 11], [12, 12], [13, 13], [14, 14], [15, 15]]);
    const r = bt.run(bars, { capital: 10e6, signals: { entry: flags(7, [1]), exit: flags(7, [4]) } });
    eq(r.trades[0].exitIndex, 5);
  });

  test('Cắt lỗ trong 2 phiên đầu vẫn phải chờ T+2', function () {
    // Mua phiên 1 ở giá 10, phiên 1 đóng cửa 8 (−20%) → cắt lỗ 10% kích hoạt nhưng bán sớm nhất phiên 3.
    const bars = mkBars([[10, 10], [10, 8], [8, 7], [7, 9], [9, 9]]);
    const r = bt.run(bars, { capital: 10e6, stopLoss: 0.1, signals: { entry: flags(5, [0]), exit: flags(5, []) } });
    eq(r.trades[0].entryIndex, 1);
    eq(r.trades[0].exitIndex, 3);
    eq(r.trades[0].reason, 'stop');
    eq(r.trades[0].exitPrice, 7);
  });

  test('Chốt lời theo %', function () {
    const bars = mkBars([[10, 10], [10, 10], [10, 10], [10, 12], [12, 12], [12, 12]]);
    const r = bt.run(bars, { capital: 10e6, takeProfit: 0.15, signals: { entry: flags(6, [0]), exit: flags(6, []) } });
    eq(r.trades[0].reason, 'take');
    eq(r.trades[0].exitIndex, 4);
  });

  test('Lãi/lỗ và tiền mặt cuối cùng đã trừ đủ phí, thuế', function () {
    const bars = mkBars([[10, 10], [10, 10], [11, 11], [12, 12], [12, 12]]);
    const r = bt.run(bars, { capital: 10e6, signals: { entry: flags(5, [0]), exit: flags(5, [2]) } });
    const t = r.trades[0];
    eq(t.shares, 900);
    eq(t.cost, 9013500, 'mua 900 cp × 10.000 + phí 13.500');
    eq(t.exitPrice, 12);
    eq(t.proceeds, 10773000, 'bán 10.800.000 − phí 16.200 − thuế 10.800');
    eq(t.pnl, 1759500);
    eq(r.cash, 11759500);
    eq(r.equity[r.equity.length - 1].value, 11759500);
  });

  test('Không mở vị thế ở phiên cuối, vị thế đang mở được đánh dấu', function () {
    const bars = mkBars([[10, 10], [10, 10], [11, 11]]);
    const r = bt.run(bars, { capital: 10e6, signals: { entry: flags(3, [0, 2]), exit: flags(3, []) } });
    eq(r.trades.length, 1);
    eq(r.trades[0].open, true);
  });

  // ---------- Chỉ số ----------

  test('Sụt giảm tối đa', function () {
    near(bt.maxDrawdown([100, 120, 90, 130, 65, 80]), 0.5, 1e-12);
    eq(bt.maxDrawdown([1, 2, 3]), 0);
  });

  test('Tỷ lệ thắng và profit factor', function () {
    const eqCurve = [{ time: 0, value: 100 }, { time: 86400 * 365.25, value: 121 }];
    const m = bt.metrics(eqCurve, [{ pnl: 30 }, { pnl: -10 }, { pnl: 20 }, { pnl: -5, open: true }]);
    eq(m.trades, 3);
    near(m.winRate, 2 / 3, 1e-12);
    near(m.profitFactor, 5, 1e-12);
    near(m.totalReturn, 0.21, 1e-12);
    near(m.cagr, 0.21, 1e-9);
  });

  test('Phát hiện giá rơi bất thường (dữ liệu chưa điều chỉnh)', function () {
    const g = bt.detectGaps(mkBars([[10, 10], [10, 10.5], [7.7, 7.8], [7.8, 7.3]]));
    eq(g.length, 1);
    eq(g[0].index, 2);
  });

  test('Chiến lược MA cắt nhau sinh tín hiệu mua rồi bán', function () {
    const closes = [];
    for (let i = 0; i < 30; i++) closes.push(10);
    for (let i = 0; i < 30; i++) closes.push(10 + i * 0.5);
    for (let i = 0; i < 40; i++) closes.push(24.5 - i * 0.6);
    const bars = mkBars(closes.map(function (c) { return [c, c]; }));
    const r = bt.run(bars, { capital: 10e6, strategy: 'maCross', params: { fast: 5, slow: 20 } });
    eq(r.trades.length >= 1, true, 'có giao dịch');
    eq(r.trades[0].open, false, 'đã bán khi MA cắt xuống');
    eq(r.trades[0].pnl > 0, true, 'giao dịch có lãi');
  });

  // ---------- Báo cáo ----------

  const failed = results.filter(function (r) { return !r.ok; });
  if (isNode) {
    results.forEach(function (r) { console.log((r.ok ? '  ✓ ' : '  ✗ ') + r.name + (r.ok ? '' : ' — ' + r.err)); });
    console.log('\n' + (results.length - failed.length) + '/' + results.length + ' bài kiểm tra đạt.');
    process.exitCode = failed.length ? 1 : 0;
  } else {
    const esc = function (x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    const el = document.getElementById('results');
    el.innerHTML = '<p class="' + (failed.length ? 'down' : 'up') + '">' + (results.length - failed.length) + '/' +
      results.length + ' bài kiểm tra đạt.</p><ul>' + results.map(function (r) {
      return '<li class="' + (r.ok ? 'up' : 'down') + '">' + (r.ok ? '✓ ' : '✗ ') + esc(r.name) +
        (r.ok ? '' : ' — ' + esc(r.err)) + '</li>';
    }).join('') + '</ul>';
  }
})();
