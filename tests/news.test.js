// Kiểm thử js/news.js (hàm lọc tin theo mã): node tests/news.test.js
const path = require('path');
require(path.join(__dirname, '..', 'js', 'news.js'));
const news = globalThis.VST.news;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.error('✗ ' + name + '\n  ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'sai'); }

test('mã đứng riêng thì khớp', function () {
  const m = news.matcher('HPG');
  ok(m('Cổ phiếu HPG tăng mạnh'));
  ok(m('Hòa Phát (HPG) báo lãi'));
  ok(m('HPG, HSG, NKG cùng tăng'));
  ok(!m('HPGX tăng'), 'dính chữ phía sau');
  ok(!m('hpg tăng'), 'chữ thường');
});

test('chữ tiếng Việt là một phần của từ (ĐTCK không chứa TCK)', function () {
  const m = news.matcher('TCK');
  ok(!m('(ĐTCK) Mặc dù áp lực bán'));
  ok(m('Cổ phiếu TCK tăng trần'));
});

test('TP.HCM không phải mã HCM; cần ngữ cảnh chứng khoán', function () {
  const m = news.matcher('HCM');
  ok(!m('Thoát nước đô thị TP.HCM'));
  ok(!m('khu công nghiệp tại TP. HCM'));
  ok(m('Cổ phiếu HCM bứt phá'));
  ok(m('HCM (HOSE) điều chỉnh'));
});

test('CEO là chức danh, không phải mã CEO', function () {
  const m = news.matcher('CEO');
  ok(!m('CEO FLC viết tâm thư'));
  ok(m('mã CEO tăng trần phiên thứ 3'));
});

test('từ khóa tài sản thế giới, không phân biệt hoa thường', function () {
  const m = news.matcher('XAUUSD', ['giá vàng', 'vàng thế giới']);
  ok(m('Giá vàng hôm nay lập đỉnh'));
  ok(m('VÀNG THẾ GIỚI giảm'));
  ok(!m('Lợi nhuận vàng đen'));
  const b = news.matcher('BTCUSD', ['bitcoin', 'BTC']);
  ok(b('Bitcoin vượt 100.000 USD'));
  ok(!b('ĐTCK BTCX'));
});

console.log(pass + '/' + (pass + fail) + ' bài kiểm tra đạt.');
if (fail) process.exit(1);
