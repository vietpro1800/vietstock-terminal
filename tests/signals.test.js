// Kiểm thử js/signals.js (cảnh báo Mua/Bán): node tests/signals.test.js
const path = require('path');
globalThis.window = globalThis;
require(path.join(__dirname, '..', 'js', 'indicators.js'));
require(path.join(__dirname, '..', 'js', 'backtest.js'));
require(path.join(__dirname, '..', 'js', 'signals.js'));
const sg = globalThis.VST.signals;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.error('✗ ' + name + '\n  ' + e.message); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'mong đợi ' + b + ', nhận ' + a); }
function near(a, b, msg) { if (Math.abs(a - b) > 1e-9) throw new Error((msg ? msg + ': ' : '') + 'mong đợi ' + b + ', nhận ' + a); }

function mk(closes) {
  return closes.map((c, i) => ({ time: 1700000000 + i * 86400, open: c, high: c, low: c, close: c, volume: 1000 }));
}

// Giá giảm đều rồi tăng đều: MA2 cắt lên MA3 khi đảo chiều, cắt xuống khi giảm lại.
const closes = [10, 9, 8, 7, 6, 7, 8, 9, 10, 9, 8, 7];
const bars = mk(closes);
const MA = [{ id: 'maCross', params: { fast: 2, slow: 3 } }];

test('find: có cả tín hiệu mua và bán, mới nhất trước', function () {
  const s = sg.find(bars, MA, bars.length);
  eq(s.length >= 2, true, 'số tín hiệu');
  eq(s[0].side, 'sell');
  const buy = s.find((x) => x.side === 'buy');
  eq(buy.price, bars[buy.index].close, 'giá báo = giá đóng cửa phiên báo');
  for (let i = 1; i < s.length; i++) eq(s[i - 1].time >= s[i].time, true, 'thứ tự');
});

test('find: chỉ trong cửa sổ N phiên gần nhất', function () {
  const all = sg.find(bars, MA, bars.length);
  const recent = sg.find(bars, MA, 3);
  eq(recent.every((x) => x.index >= bars.length - 3), true);
  eq(recent.length < all.length, true);
});

test('find: đợt tín hiệu liên tiếp chỉ báo phiên đầu (RSI)', function () {
  const down = mk([20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7]);
  const s = sg.find(down, [{ id: 'rsi', params: { period: 3, buyBelow: 30, sellAbove: 70 } }], 20);
  eq(s.filter((x) => x.side === 'buy').length, 1);
});

test('find: tham số sai thì bỏ qua chiến lược', function () {
  eq(sg.find(bars, [{ id: 'maCross', params: { fast: 5, slow: 3 } }], 20).length, 0);
  eq(sg.find(bars, [{ id: 'khong-co', params: {} }], 20).length, 0);
});

test('evaluate: % lãi/lỗ và T+', function () {
  const b = mk([10, 10, 10, 10, 11]);
  const buy = { side: 'buy', index: 1, price: 10 };
  let e = sg.evaluate(buy, b);
  near(e.change, 0.1); near(e.pnl, 0.1); eq(e.sessions, 3);
  e = sg.evaluate({ side: 'sell', index: 4, price: 11 }, b, 9.9);
  near(e.change, -0.1); near(e.pnl, 0.1, 'bán rồi giá giảm là có lợi'); eq(e.sessions, 0);
});

test('key ổn định', function () {
  eq(sg.key('HPG', { strategy: 'rsi', side: 'buy', time: 5 }), 'HPG:rsi:buy:5');
});

console.log(pass + '/' + (pass + fail) + ' bài kiểm tra đạt.');
if (fail) process.exit(1);
