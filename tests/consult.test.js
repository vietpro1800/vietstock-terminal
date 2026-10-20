// Kiểm thử phân tích hội chẩn trong js/consult.js (dữ liệu tự tạo).
// Chạy: `node tests/consult.test.js`, hoặc mở tests/index.html qua web server tĩnh.
(function () {
  const isNode = typeof window === 'undefined';
  if (isNode) {
    const path = require('path');
    globalThis.window = globalThis;
    require(path.join(__dirname, '../js/config.js'));
    require(path.join(__dirname, '../js/indicators.js'));
    require(path.join(__dirname, '../js/consult.js'));
  }
  const consult = window.VST.consult;
  const CFG = window.VST.config.consult;
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
  function card(r, id) { return r.cards.find((c) => c.id === id); }
  // Cấu hình sửa một phần (không đổi VST.config).
  function withCfg(patch) { return Object.assign(JSON.parse(JSON.stringify(CFG)), patch); }

  const T0 = Date.UTC(2024, 0, 2) / 1000 - 7 * 3600;
  // closes: giá đóng cửa; vols: KL (mặc định 1.000.000); high/low = close ± spread.
  function mkBars(closes, vols, spread) {
    spread = spread == null ? 0.3 : spread;
    return closes.map(function (c, i) {
      return { time: T0 + i * 86400, open: c, high: c + spread, low: c - spread, close: c, volume: vols ? vols[i] : 1000000 };
    });
  }
  function range(n, f) { const a = []; for (let i = 0; i < n; i++) a.push(f(i)); return a; }

  // Tăng 110 phiên, điều chỉnh 8 phiên rồi bật lên (RSI ~60), phiên cuối KL tăng mạnh.
  function uptrend() {
    const closes = range(120, (i) => (i < 110 ? 30 + i * 0.15 + (i % 4 === 3 ? -0.3 : 0)
      : i < 118 ? 46.2 - (i - 110) * 0.25 : 44.5 + (i - 117) * 0.5));
    const vols = range(120, (i) => (i === 119 ? 2500000 : 1500000));
    return mkBars(closes, vols);
  }
  // Giảm đều 40% từ đỉnh, biến động thấp, thanh khoản tốt.
  function downtrend() {
    return mkBars(range(120, (i) => 50 - i * 0.17 + (i % 4 === 3 ? 0.3 : 0)));
  }
  // Giảm mạnh, dao động ±3–4%/phiên, thanh khoản < 1 tỷ/phiên.
  function crash() {
    return mkBars(range(120, (i) => 50 * Math.pow(0.992, i) * (i % 2 ? 1.04 : 0.97)), range(120, () => 20000), 0.8);
  }

  test('Ít hơn 60 phiên → null', function () {
    eq(consult.analyze(mkBars(range(59, () => 10)), CFG), null);
    eq(consult.analyze(null, CFG), null);
  });

  test('Trả đủ 6 thẻ theo thứ tự, điểm trong [0, 1]', function () {
    const r = consult.analyze(uptrend(), CFG);
    eq(r.cards.map((c) => c.id).join(), 'scan,tech,sr,vol,risk,summary');
    r.cards.forEach(function (c) {
      if (!(c.score >= 0 && c.score <= 1)) throw new Error(c.id + ' điểm ngoài [0,1]: ' + c.score);
      if (!c.note) throw new Error(c.id + ' thiếu nhận xét');
    });
  });

  test('Xu hướng tăng rõ, thanh khoản tốt → MUA', function () {
    const r = consult.analyze(uptrend(), CFG);
    eq(r.verdict, 'MUA', JSON.stringify(r.cards.map((c) => [c.id, c.score])));
    eq(card(r, 'tech').detail.trend, 1, 'đủ 3 điều kiện MA');
    if (card(r, 'tech').score < CFG.gate.tech) throw new Error('kỹ thuật phải qua ngưỡng');
  });

  test('Xu hướng giảm, kỹ thuật yếu, giá dưới MA50 → BÁN dù các thẻ khác cao', function () {
    const r = consult.analyze(downtrend(), CFG);
    eq(r.verdict, 'BÁN');
    if (card(r, 'sr').score < 0.6 || card(r, 'vol').score < 0.6) throw new Error('mẫu này phải có HT/KC và Biến động cao');
    eq(card(r, 'tech').detail.trend, 0);
    if (card(r, 'tech').score > 0.3) throw new Error('kỹ thuật phải thấp: ' + card(r, 'tech').score);
    if (card(r, 'summary').detail.gateFailed.indexOf('tech') < 0) throw new Error('phải trượt ngưỡng kỹ thuật');
    if (card(r, 'risk').detail.drawdown < 30) throw new Error('mức giảm từ đỉnh phải lớn');
  });

  test('Giảm mạnh, biến động lớn, thanh khoản thấp → BÁN vì rủi ro cao', function () {
    const r = consult.analyze(crash(), CFG);
    eq(r.verdict, 'BÁN');
    const reasons = card(r, 'summary').detail.sellReasons;
    eq(reasons.length, 1);
    eq(reasons[0].indexOf('rủi ro') === 0, true, reasons[0]);
    eq(card(r, 'vol').score, 0);
    eq(card(r, 'summary').detail.gateFailed.slice().sort().join(), 'risk,tech');
  });

  test('Ngưỡng lọc: đủ điểm tổng nhưng kỹ thuật < ngưỡng → THEO DÕI, nêu rõ ngưỡng trượt', function () {
    const r = consult.analyze(uptrend(), withCfg({ gate: { risk: 0.5, tech: 0.99 } }));
    eq(r.verdict, 'THEO DÕI');
    eq(card(r, 'summary').detail.gateFailed.join(), 'tech');
    if (card(r, 'summary').note.indexOf('KỸ THUẬT') < 0) throw new Error('nhận xét phải nêu thẻ KỸ THUẬT');
  });

  test('Ngưỡng lọc rủi ro chặn MUA', function () {
    const r = consult.analyze(uptrend(), withCfg({ gate: { risk: 1.01, tech: 0.6 } })); // ngưỡng rủi ro không thể đạt
    eq(r.verdict === 'MUA', false);
    eq(card(r, 'summary').detail.gateFailed.join(), 'risk');
  });

  test('Rủi ro < ngưỡng bán → BÁN dù kỹ thuật tốt', function () {
    const r = consult.analyze(uptrend(), withCfg({ sell: { tech: 0.35, risk: 1.01 } }));
    eq(r.verdict, 'BÁN');
    eq(card(r, 'summary').detail.sellReasons.length, 1);
  });

  test('MUA khi điểm tổng ≥ 0,55; nâng ngưỡng điểm tổng lên 0,99 → THEO DÕI', function () {
    eq(consult.analyze(uptrend(), CFG).verdict, 'MUA');
    const r = consult.analyze(uptrend(), withCfg({ verdict: { buy: 0.99 } }));
    eq(r.verdict, 'THEO DÕI');
    eq(card(r, 'summary').detail.gateFailed.length, 0);
  });

  test('Tổng hợp = trung bình có trọng số các thẻ', function () {
    const r = consult.analyze(uptrend(), CFG);
    const w = CFG.weights;
    let s = 0;
    Object.keys(w).forEach((k) => { s += w[k] * card(r, k).score; });
    near(card(r, 'summary').score, s, 0.006);
  });

  test('QUÉT: KL phiên cuối gấp 2 TB20 và toàn phiên tăng → điểm 1', function () {
    const closes = range(80, (i) => 20 + i * 0.1);
    const vols = range(80, (i) => (i === 79 ? 2000000 : 1000000));
    const c = card(consult.analyze(mkBars(closes, vols), CFG), 'scan');
    near(c.detail.volRatio, 2, 1e-9);
    near(c.detail.flow, 1, 1e-9);
    eq(c.score, 1);
  });

  test('QUÉT: KL bằng TB20, dòng tiền cân bằng → ≈ 0,5·lin(1) + 0,25', function () {
    const closes = range(80, (i) => 20 + (i % 2 ? 0.5 : 0));
    const c = card(consult.analyze(mkBars(closes), CFG), 'scan');
    near(c.detail.volRatio, 1, 1e-9);
    near(c.detail.flow, 0, 0.03);
    near(c.score, 0.5 * (0.5 / 1.5) + 0.25, 0.02);
  });

  test('HỖ TRỢ/KHÁNG CỰ: giá tại đáy vùng → gần 1; vượt đỉnh 20 phiên → 0,75', function () {
    const flat = range(79, (i) => 20 + (i % 2 ? 1 : 0));
    let c = card(consult.analyze(mkBars(flat.concat([19.8]), null, 0.1), CFG), 'sr');
    if (c.score < 0.9) throw new Error('gần hỗ trợ phải cao: ' + c.score);
    c = card(consult.analyze(mkBars(flat.concat([22]), null, 0.1), CFG), 'sr');
    eq(c.detail.breakout, true);
    eq(c.score, CFG.sr.breakout);
  });

  test('HỖ TRỢ/KHÁNG CỰ: tăng đều sát đỉnh nhưng trên MA50 → không thấp hơn 0,5', function () {
    const closes = range(80, (i) => 20 + i * 0.1 + (i % 3 === 2 ? -0.2 : 0)).concat([27.6]);
    const c = card(consult.analyze(mkBars(closes, null, 0.5), CFG), 'sr');
    eq(c.detail.uptrend, true);
    eq(c.detail.breakout, false, 'phiên cuối không vượt đỉnh');
    if (c.detail.position < 0.7) throw new Error('mẫu phải sát kháng cự: ' + c.detail.position);
    eq(c.score, CFG.sr.uptrendFloor);
  });

  test('HỖ TRỢ/KHÁNG CỰ: bứt phá cách đây 2 phiên, giá vẫn giữ trên đỉnh cũ → 0,75', function () {
    const flat = range(77, (i) => 20 + (i % 2 ? 1 : 0)); // đỉnh cũ 21,1
    let c = card(consult.analyze(mkBars(flat.concat([22.5, 22, 21.5]), null, 0.1), CFG), 'sr');
    eq(c.detail.breakout, true);
    near(c.detail.breakoutLevel, 21.1, 1e-9);
    eq(c.score, CFG.sr.breakout);
    c = card(consult.analyze(mkBars(flat.concat([22.5, 22, 20.5]), null, 0.1), CFG), 'sr');
    eq(c.detail.breakout, false, 'giá rơi lại dưới đỉnh cũ thì không tính bứt phá');
  });

  test('Ước tính KL cả phiên theo giờ khớp lệnh (giờ VN)', function () {
    const day = T0 + 79 * 86400; // 0:00 giờ VN của phiên cuối trong mẫu 80 nến
    const at = (h, m) => day + h * 3600 + m * 60;
    const c = CFG.scan;
    near(consult.sessionFraction(day, at(10, 15), c), 75 / 255, 1e-9);
    near(consult.sessionFraction(day, at(12, 0), c), 150 / 255, 1e-9);
    eq(consult.sessionFraction(day, at(9, 5), c), c.minFraction, 'mới mở cửa → tối thiểu');
    eq(consult.sessionFraction(day, at(15, 0), c), 1);
    eq(consult.sessionFraction(day, at(10, 0) + 86400, c), 1, 'nến cuối của ngày trước');
    eq(consult.sessionFraction(day, undefined, c), 1);
    const bars = mkBars(range(80, (i) => 20 + (i % 2 ? 0.5 : 0)));
    const full = card(consult.analyze(bars, CFG), 'scan').detail.volRatio;
    const mid = card(consult.analyze(bars, CFG, { now: at(12, 0) }), 'scan');
    near(mid.detail.volRatio, full * 255 / 150, 1e-9);
    if (mid.note.indexOf('ước tính cả phiên') < 0) throw new Error('nhận xét phải ghi ước tính');
  });

  test('BIẾN ĐỘNG: giá phẳng + GTGD 50 tỷ → 1; GTGD 1 tỷ → 0,5', function () {
    // 25 nghìn đồng × 2.000.000 cp = 50 tỷ; × 40.000 cp = 1 tỷ.
    const closes = range(80, () => 25);
    eq(card(consult.analyze(mkBars(closes, range(80, () => 2000000)), CFG), 'vol').score, 1);
    eq(card(consult.analyze(mkBars(closes, range(80, () => 40000)), CFG), 'vol').score, 0.5);
  });

  test('RỦI RO: cắt lỗ = max(giá − 2·ATR, hỗ trợ), không vượt giá', function () {
    const r = consult.analyze(uptrend(), CFG);
    const d = card(r, 'risk').detail;
    const sup = card(r, 'sr').detail.support;
    near(d.stop, Math.min(r.price, Math.max(r.price - 2 * d.atr, sup)), 1e-9);
    if (d.stop > r.price) throw new Error('cắt lỗ cao hơn giá');
  });

  test('lin: hai chiều và kẹp trong [0, 1]', function () {
    eq(consult.lin(5, [0, 10]), 0.5);
    eq(consult.lin(-1, [0, 10]), 0);
    eq(consult.lin(99, [0, 10]), 1);
    eq(consult.lin(10, [10, 0]), 0);
  });

  test('Trọng số tổng hợp cộng lại bằng 1', function () {
    near(Object.keys(CFG.weights).reduce((a, k) => a + CFG.weights[k], 0), 1, 1e-9);
  });

  // ---------- Báo cáo ----------
  const fail = results.filter((r) => !r.ok);
  if (isNode) {
    results.forEach(function (r) { console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : ' — ' + r.err)); });
    console.log('\n' + (results.length - fail.length) + '/' + results.length + ' bài kiểm thử đạt.');
    if (fail.length) process.exitCode = 1;
  } else {
    const esc = function (x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    const el = document.getElementById('results-consult');
    el.innerHTML = '<p class="' + (fail.length ? 'down' : 'up') + '">' + (results.length - fail.length) + '/' +
      results.length + ' bài kiểm thử đạt.</p><ul>' + results.map(function (r) {
      return '<li class="' + (r.ok ? 'up' : 'down') + '">' + (r.ok ? '✓ ' : '✗ ') + esc(r.name) +
        (r.ok ? '' : ' — ' + esc(r.err)) + '</li>';
    }).join('') + '</ul>';
  }
})();
