// Kiểm thử js/heatmap.js: node tests/heatmap.test.js
const path = require('path');
require(path.join(__dirname, '..', 'js', 'heatmap.js'));
const hm = globalThis.VST.heatmap;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.error('✗ ' + name + '\n  ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'sai'); }
function near(a, b, eps, msg) { ok(Math.abs(a - b) <= (eps || 1e-6), (msg || '') + ' ' + a + ' ≠ ' + b); }

test('squarify phủ kín, diện tích tỷ lệ với giá trị', function () {
  const vals = [60, 30, 20, 10, 6, 4, 2, 1];
  const total = vals.reduce((t, v) => t + v, 0);
  const r = hm.squarify(vals, 10, 20, 300, 200);
  let area = 0;
  r.forEach(function (q, i) {
    area += q.w * q.h;
    near(q.w * q.h, (vals[i] / total) * 60000, 1e-6, 'diện tích ô ' + i);
    ok(q.x >= 10 - 1e-9 && q.y >= 20 - 1e-9 && q.x + q.w <= 310 + 1e-6 && q.y + q.h <= 220 + 1e-6, 'ô ' + i + ' tràn khung');
  });
  near(area, 60000, 1e-6, 'tổng diện tích');
});

test('squarify: các ô không chồng nhau', function () {
  const vals = [50, 40, 33, 20, 18, 9, 7, 7, 3, 1];
  const r = hm.squarify(vals, 0, 0, 400, 250);
  for (let i = 0; i < r.length; i++) {
    for (let j = i + 1; j < r.length; j++) {
      const a = r[i], b = r[j];
      const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      ok(!(ox > 1e-6 && oy > 1e-6), 'ô ' + i + ' chồng ô ' + j);
    }
  }
});

test('squarify: tỷ lệ cạnh hợp lý với giá trị đều nhau', function () {
  const r = hm.squarify(new Array(16).fill(1), 0, 0, 400, 400);
  r.forEach(function (q) { ok(Math.max(q.w / q.h, q.h / q.w) < 2.5, 'ô quá dẹt ' + q.w + '×' + q.h); });
});

test('squarify: tổng bằng 0 không lỗi', function () {
  const r = hm.squarify([0, 0], 0, 0, 100, 100);
  ok(r.length === 2 && r[0].w === 0);
});

test('layout: bỏ ô giá trị 0, ngành rỗng; ô nằm trong ngành', function () {
  const groups = [
    { id: 'a', name: 'A', items: [{ id: 'X', value: 10 }, { id: 'Y', value: 5 }, { id: 'Z', value: 0 }] },
    { id: 'b', name: 'B', items: [{ id: 'W', value: 20 }] },
    { id: 'c', name: 'C', items: [{ id: 'V', value: 0 }] },
  ];
  const L = hm.layout(groups, 600, 400, { header: 16, gap: 2 });
  ok(L.groups.length === 2, 'số ngành');
  ok(L.groups[0].group.id === 'b', 'ngành lớn nhất trước');
  ok(L.tiles.length === 3, 'số ô');
  L.tiles.forEach(function (t) {
    const g = L.groups.find((x) => x.group === t.group);
    ok(t.x >= g.x - 1e-6 && t.y >= g.y - 1e-6 && t.x + t.w <= g.x + g.w + 1e-6 && t.y + t.h <= g.y + g.h + 1e-6, 'ô ' + t.item.id + ' ra ngoài ngành');
    if (g.header) ok(t.y >= g.y + 16 - 1e-6, 'ô đè lên tên ngành');
  });
});

test('change: không có realtime → so nến cuối với nến trước', function () {
  const row = { closes: [10, 11, 12, 12.6], lastDay: 100, rt: null };
  const c1 = hm.change(row, 1, 101);
  near(c1.pct, 5, 1e-9);
  const c3 = hm.change(row, 3, 101);
  near(c3.pct, 26, 1e-9);
  ok(hm.change(row, 4, 101) === null, 'thiếu dữ liệu');
});

test('change: realtime hôm nay, nến cuối là hôm qua', function () {
  const row = { closes: [10, 11, 12], lastDay: 100, rt: { price: 12.6, ref: 12 } };
  near(hm.change(row, 1, 101).pct, 5, 1e-9);
  near(hm.change(row, 2, 101).pct, (12.6 / 11 - 1) * 100, 1e-9);
});

test('change: realtime hôm nay, nến cuối cũng là hôm nay', function () {
  const row = { closes: [10, 11, 12, 12.3], lastDay: 101, rt: { price: 12.6, ref: 12 } };
  near(hm.change(row, 1, 101).pct, 5, 1e-9);
  near(hm.change(row, 3, 101).pct, 26, 1e-9);
});

test('bucket: ngưỡng màu', function () {
  const steps = [1, 2, 3, 5];
  ok(hm.bucket(0, steps, 1) === 'z');
  ok(hm.bucket(0.5, steps, 1) === 'u1');
  ok(hm.bucket(1, steps, 1) === 'u2');
  ok(hm.bucket(2.5, steps, 1) === 'u3');
  ok(hm.bucket(4, steps, 1) === 'u4');
  ok(hm.bucket(6.9, steps, 1) === 'u5');
  ok(hm.bucket(-1.5, steps, 1) === 'd2');
  ok(hm.bucket(-7, steps, 1) === 'd5');
  ok(hm.bucket(4, steps, 2) === 'u3', 'giãn ngưỡng theo kỳ');
  ok(hm.bucket(null, steps, 1) === '');
});

test('avgValue: GTGD bình quân (tỷ đồng)', function () {
  const bars = [{ close: 100, volume: 1e6 }, { close: 20, volume: 1e6 }, { close: 30, volume: 2e6 }];
  near(hm.avgValue(bars, 2), (20 + 60) / 2, 1e-9);
  near(hm.avgValue(bars, 5), (100 + 20 + 60) / 3, 1e-9);
  ok(hm.avgValue([], 5) === 0);
});

console.log(pass + '/' + (pass + fail) + ' bài kiểm tra đạt.');
if (fail) process.exit(1);
