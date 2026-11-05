// Kiểm thử js/temple.js (trang Khấn mã): node tests/temple.test.js
const path = require('path');
globalThis.window = globalThis;
require(path.join(__dirname, '..', 'js', 'priceboard.js'));
require(path.join(__dirname, '..', 'js', 'temple.js'));
const tp = globalThis.VST.temple;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.error('✗ ' + name + '\n  ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'sai'); }
function near(a, b, eps, msg) { ok(Math.abs(a - b) <= (eps || 1e-6), (msg || '') + ' ' + a + ' ≠ ' + b); }
// Mốc giờ VN → mili giây UTC.
function vn(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h - 7, mi || 0); }

test('hash ổn định, không âm', function () {
  ok(tp.hash('abc') === tp.hash('abc'));
  ok(tp.hash('abc') !== tp.hash('abd'));
  ok(tp.hash('') >= 0 && tp.hash(null) >= 0);
});

test('pháp danh cố định theo id và nằm trong danh sách', function () {
  const a = tp.dharmaName('user-1');
  ok(a === tp.dharmaName('user-1'));
  ok(tp.NAMES.indexOf(a) >= 0);
  ok(/^Thích /.test(a));
});

test('monkNames không trùng pháp danh của người xem', function () {
  const me = tp.NAMES[3];
  const list = tp.monkNames(8, me);
  ok(list.length === 8);
  ok(list.indexOf(me) < 0);
  ok(new Set(list).size === 8);
});

test('lời khấn mẫu chứa mã', function () {
  const p = tp.presets('HPG');
  ok(p.length >= 3 && p.every((s) => s.length > 0));
  ok(p[0].indexOf('HPG') >= 0 && /trần/.test(p[0]));
});

test('quẻ: cùng người, mã, ngày → cùng quẻ; thay mã vào nội dung', function () {
  const a = tp.fortune('u', 'FPT', 20000), b = tp.fortune('u', 'FPT', 20000);
  ok(a.title === b.title && a.text === b.text);
  ok(a.text.indexOf('{s}') < 0);
  ok(['great', 'good', 'mid', 'bad'].indexOf(a.rank) >= 0);
  const seen = new Set();
  for (let d = 0; d < 60; d++) seen.add(tp.fortune('u', 'FPT', d).title);
  ok(seen.size >= 4, 'quẻ phải đa dạng theo ngày');
});

test('phiên giao dịch theo giờ VN', function () {
  ok(tp.session(vn(2026, 11, 5, 10, 0)).id === 'open', 'thứ Năm 10:00');
  ok(tp.session(vn(2026, 11, 5, 8, 59)).id === 'closed', '8:59');
  ok(tp.session(vn(2026, 11, 5, 11, 30)).id === 'lunch', '11:30');
  ok(tp.session(vn(2026, 11, 5, 13, 0)).id === 'open', '13:00');
  ok(tp.session(vn(2026, 11, 5, 15, 0)).id === 'closed', '15:00');
  ok(tp.session(vn(2026, 11, 7, 10, 0)).id === 'closed', 'thứ Bảy');
  ok(tp.session(vn(2026, 11, 8, 10, 0)).id === 'closed', 'Chủ nhật');
});

test('dayKey theo giờ VN', function () {
  ok(tp.dayKey(vn(2026, 11, 5, 0, 30)) === tp.dayKey(vn(2026, 11, 5, 23, 30)));
  ok(tp.dayKey(vn(2026, 11, 5, 23, 59)) + 1 === tp.dayKey(vn(2026, 11, 6, 0, 1)));
});

test('fromBars: phiên cuối so với phiên trước, bỏ nến lỗi', function () {
  const r = tp.fromBars([{ time: 1, open: 20, close: 20.5 }, { time: 2, open: 21, close: 21.7 }, { time: 3, close: 0 }]);
  ok(r.price === 21.7 && r.ref === 20.5 && r.time === 2);
  ok(tp.fromBars([]) === null);
  const one = tp.fromBars([{ time: 1, open: 10, close: 11 }]);
  ok(one.price === 11 && one.ref === 10);
});

test('quoteState: trần HOSE, % tới trần', function () {
  const ref = 21.25;
  const lim = globalThis.VST.priceboard.priceLimits(ref, 'hose');
  const s = tp.quoteState(lim.ceil, ref, 'hose');
  ok(s.cls === 'ceil', 'phải là trần: ' + s.cls);
  near(s.toCeil, 0);
  const u = tp.quoteState(21.7, ref, 'hose');
  ok(u.cls === 'up');
  near(u.pct, (0.45 / 21.25) * 100, 1e-9);
  near(u.toCeil, ((lim.ceil - 21.7) / 21.7) * 100, 1e-9);
  ok(tp.quoteState(21.25, 21.25, 'hose').cls === 'ref');
  ok(tp.quoteState(lim.floor, ref, 'hose').cls === 'floor');
  ok(tp.quoteState(0, ref, 'hose') === null);
});

test('burning: chỉ đếm nhang trong N phút', function () {
  const now = Date.parse('2026-11-05T13:00:00Z');
  const rows = [
    { kind: 'incense', created_at: '2026-11-05T12:50:00Z' },
    { kind: 'incense', created_at: '2026-11-05T12:20:00Z' },
    { kind: 'pray', created_at: '2026-11-05T12:59:00Z' },
    { kind: 'incense', created_at: '2026-11-05T12:31:00Z' },
  ];
  ok(tp.burning(rows, now, 30) === 2);
  ok(tp.burning([], now, 30) === 0);
});

test('cleanPrayer: gọn khoảng trắng, cắt theo ký tự Unicode', function () {
  ok(tp.cleanPrayer('  Cầu   HPG \n tím trần ') === 'Cầu HPG tím trần');
  ok(tp.cleanPrayer('🟣'.repeat(10), 4) === '🟣🟣🟣🟣');
  ok(tp.cleanPrayer(null) === '');
});

console.log((fail ? '✗' : '✓') + ' temple: ' + pass + ' đạt, ' + fail + ' lỗi');
if (fail) process.exit(1);
