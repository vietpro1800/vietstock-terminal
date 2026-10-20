// Kiểm thử js/paper.js (danh mục giả lập): node tests/paper.test.js
const path = require('path');
globalThis.window = globalThis;
require(path.join(__dirname, '..', 'js', 'indicators.js'));
require(path.join(__dirname, '..', 'js', 'backtest.js'));
require(path.join(__dirname, '..', 'js', 'paper.js'));
const paper = globalThis.VST.paper;
const bt = globalThis.VST.backtest;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.error('✗ ' + name + '\n  ' + e.message); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg ? msg + ': ' : '') + 'mong đợi ' + b + ', nhận ' + a); }
function throwsMsg(fn, re) {
  try { fn(); } catch (e) { if (e.name === 'PaperError' && re.test(e.message)) return; throw new Error('sai lỗi: ' + e.message); }
  throw new Error('không ném lỗi');
}

const NOW = paper.dateToTime('2026-10-20') + 12 * 3600;
const OPTS = { maxSymbols: 10, isSymbol: (s) => s !== 'XYZ', now: NOW };
const base = { strategy: 'rsi', params: {}, symbols: 'hpg, FPT hpg', capital: 100e6, start: '2026-10-01' };

test('ngày VN ↔ Unix', function () {
  const t = paper.dateToTime('2026-10-20');
  eq(t, Date.UTC(2026, 9, 19, 17) / 1000);
  eq(paper.timeToDate(t), '2026-10-20');
  eq(paper.timeToDate(t + 86399), '2026-10-20');
  eq(paper.dateToTime('2026-02-30'), null);
});

test('normalize: mã viết hoa, bỏ trùng, tham số mặc định', function () {
  const c = paper.normalize(base, OPTS);
  eq(c.symbols.join(','), 'HPG,FPT');
  eq(c.params.period, 14);
  eq(c.stopLoss, 0);
  eq(c.start, '2026-10-01');
});

test('normalize: báo lỗi tiếng Việt', function () {
  throwsMsg(() => paper.normalize(Object.assign({}, base, { strategy: 'abc' }), OPTS), /chiến lược/);
  throwsMsg(() => paper.normalize(Object.assign({}, base, { symbols: '' }), OPTS), /ít nhất một mã/);
  throwsMsg(() => paper.normalize(Object.assign({}, base, { symbols: 'HPG XYZ' }), OPTS), /XYZ/);
  throwsMsg(() => paper.normalize(Object.assign({}, base, { capital: 1e6 }), OPTS), /tối thiểu/);
  throwsMsg(() => paper.normalize(Object.assign({}, base, { start: '2026-12-01' }), OPTS), /sau hôm nay/);
  throwsMsg(() => paper.normalize(Object.assign({}, base, { params: { buyBelow: 80, sellAbove: 70 } }), OPTS), /Ngưỡng mua/);
  throwsMsg(() => paper.normalize(Object.assign({}, base, { params: { period: 999 } }), OPTS), /Chu kỳ RSI/);
  throwsMsg(() => paper.normalize(Object.assign({}, base, { stopLoss: 150 }), OPTS), /Cắt lỗ/);
  const many = Array.from({ length: 11 }, (_, i) => 'A' + String(i).padStart(2, '0')).join(' ');
  throwsMsg(() => paper.normalize(Object.assign({}, base, { symbols: many }), OPTS), /tối đa 10/);
});

// Nến giả theo ngày từ 2026-09-01; giá lên xuống theo hình sin để RSI cắt ngưỡng.
function mkBars(seed) {
  const out = [];
  let t = paper.dateToTime('2026-03-02') + 2 * 3600;
  for (let i = 0; i < 160; i++, t += 86400) {
    const c = 20 + 4 * Math.sin((i + seed) / 6) + i * 0.01;
    out.push({ time: t, open: +(c - 0.1).toFixed(2), high: c + 0.3, low: c - 0.3, close: +c.toFixed(2), volume: 1e5 });
  }
  return out;
}

test('simulate: chia vốn đều, cộng giá trị, khớp với từng mã', function () {
  const cfg = paper.normalize(Object.assign({}, base, { symbols: 'HPG FPT VNM', capital: 100000000, start: '2026-05-01',
    params: { period: 5, buyBelow: 35, sellAbove: 65 } }), OPTS);
  const bars = { HPG: mkBars(0), FPT: mkBars(7), VNM: mkBars(15) };
  const sim = paper.simulate(cfg, bars, mkBars(3));
  const sum = paper.summarize(sim);
  eq(sim.slices[0].capital, 33333333);
  eq(sim.spare, 1);
  // Giá trị cuối = tổng giá trị cuối của từng mã chạy riêng + phần lẻ.
  let expect = 1;
  ['HPG', 'FPT', 'VNM'].forEach(function (s) {
    const b = bars[s];
    const si = b.findIndex((x) => x.time >= paper.dateToTime('2026-05-01'));
    const r = bt.run(b, { strategy: 'rsi', params: cfg.params, capital: 33333333, startIndex: si });
    expect += r.equity[r.equity.length - 1].value;
  });
  eq(Math.round(sim.equity[sim.equity.length - 1].value), Math.round(expect), 'giá trị cuối');
  eq(Math.round(sum.nav), Math.round(expect), 'NAV');
  if (!(sum.trades.length > 0)) throw new Error('phải có giao dịch đã đóng');
  eq(Math.round(sum.pnl), Math.round(sum.realized + sum.unrealized), 'lãi/lỗ = đã chốt + tạm tính');
  if (sum.benchPct == null) throw new Error('thiếu so sánh VN-Index');
});

test('summarize: giá realtime ghi đè giá vị thế', function () {
  const cfg = paper.normalize(Object.assign({}, base, { symbols: 'HPG', start: '2026-05-01', params: { period: 5, buyBelow: 35, sellAbove: 99 } }), OPTS);
  const sim = paper.simulate(cfg, { HPG: mkBars(0) }, null);
  const s0 = paper.summarize(sim);
  eq(s0.positions.length, 1, 'có vị thế mở');
  const p = s0.positions[0];
  const s1 = paper.summarize(sim, { HPG: p.price + 1 });
  eq(s1.nav - s0.nav, p.shares * 1000, 'NAV tăng đúng 1 nghìn × số cp');
  eq(s1.benchPct, null);
});

test('simulate: mã lỗi và mã chưa có phiên', function () {
  const cfg = paper.normalize(Object.assign({}, base, { symbols: 'HPG FPT', start: '2026-10-20' }), OPTS);
  const sim = paper.simulate(cfg, { HPG: mkBars(0), FPT: new Error('x') }, null);
  const s = paper.summarize(sim);
  eq(s.waiting.join(), 'HPG');
  eq(s.errors.length, 1);
  eq(s.nav, cfg.capital, 'chưa giao dịch: NAV = vốn');
  eq(s.pnl, 0);
});

console.log(pass + '/' + (pass + fail) + ' bài kiểm tra đạt.');
if (fail) process.exit(1);
