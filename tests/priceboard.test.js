// Kiểm thử tính giá trần/sàn và màu giá trong js/priceboard.js.
// Chạy: `node tests/priceboard.test.js`, hoặc mở tests/index.html qua web server tĩnh.
(function () {
  const isNode = typeof window === 'undefined';
  if (isNode) {
    const path = require('path');
    globalThis.window = globalThis;
    require(path.join(__dirname, '../js/priceboard.js'));
  }
  const pb = window.VST.priceboard;
  const results = [];

  function test(name, fn) {
    try { fn(); results.push({ name: name, ok: true }); } catch (e) { results.push({ name: name, ok: false, err: e.message }); }
  }
  function eq(actual, expected, msg) {
    if (actual !== expected) throw new Error((msg ? msg + ': ' : '') + 'mong đợi ' + expected + ', nhận ' + actual);
  }

  // Số liệu đối chiếu từ bảng giá SSI (HOSE, ±7%).
  test('HOSE: trần/sàn khớp bảng giá SSI', function () {
    [[20.6, 22.0, 19.2], [218, 233.2, 202.8], [72.8, 77.8, 67.8], [10.4, 11.1, 9.68],
      [139.8, 149.5, 130.1], [13.8, 14.75, 12.85], [24.45, 26.15, 22.75], [27.65, 29.55, 25.75]].forEach(function (c) {
      const l = pb.priceLimits(c[0], 'hose');
      eq(l.ceil, c[1], 'trần của ' + c[0]);
      eq(l.floor, c[2], 'sàn của ' + c[0]);
    });
  });

  test('HNX ±10%, UPCoM ±15%, bước giá 100 đồng', function () {
    let l = pb.priceLimits(25.3, 'hnx');
    eq(l.ceil, 27.8); eq(l.floor, 22.8);
    l = pb.priceLimits(12.4, 'UPCOM');
    eq(l.ceil, 14.2); eq(l.floor, 10.6);
  });

  test('Không có giá tham chiếu → không có trần/sàn', function () {
    const l = pb.priceLimits(0, 'hose');
    eq(l.ceil, null); eq(l.floor, null);
  });

  test('Màu giá: trần, sàn, tăng, giảm, tham chiếu', function () {
    eq(pb.priceClass(22.0, 20.6, 22.0, 19.2), 'ceil');
    eq(pb.priceClass(19.2, 20.6, 22.0, 19.2), 'floor');
    eq(pb.priceClass(20.65, 20.6, 22.0, 19.2), 'up');
    eq(pb.priceClass(20.55, 20.6, 22.0, 19.2), 'down');
    eq(pb.priceClass(20.6, 20.6, 22.0, 19.2), 'ref');
    eq(pb.priceClass(0, 20.6, 22.0, 19.2), '');
  });

  test('Nhận diện sàn từ chuỗi', function () {
    eq(pb.normExchange('HOSE'), 'hose');
    eq(pb.normExchange('hnx'), 'hnx');
    eq(pb.normExchange('UPCOM'), 'upcom');
    eq(pb.normExchange('xyz'), null);
  });

  const failed = results.filter((r) => !r.ok);
  if (isNode) {
    results.forEach((r) => console.log((r.ok ? '✓ ' : '✗ ') + r.name + (r.ok ? '' : ' — ' + r.err)));
    console.log(results.length - failed.length + '/' + results.length + ' đạt');
    if (failed.length) process.exit(1);
  } else {
    const el = document.getElementById('results-priceboard');
    el.innerHTML = results.map((r) => '<p class="' + (r.ok ? 'up' : 'down') + '">' + (r.ok ? '✓ ' : '✗ ') + r.name +
      (r.ok ? '' : ' — ' + r.err) + '</p>').join('') + '<p>' + (results.length - failed.length) + '/' + results.length + ' đạt</p>';
  }
})();
