// Kiểm thử js/reader.js (đọc RSS/Atom, gộp và lọc tin trang Đọc báo): node tests/reader.test.js
const path = require('path');
require(path.join(__dirname, '..', 'js', 'reader.js'));
const rd = globalThis.VST.reader;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.error('✗ ' + name + '\n  ' + e.message); }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'sai'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'khác') + ': ' + JSON.stringify(a) + ' ≠ ' + JSON.stringify(b)); }

const RSS = '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>CafeF</title>' +
  '<item><title><![CDATA[VN-Index tăng 10 điểm & khối ngoại mua ròng]]></title>' +
  '<link>https://cafef.vn/vn-index-tang-188.chn</link>' +
  '<description><![CDATA[<a href="x"><img src="https://cafef.vn/a.jpg" /></a>Thanh khoản <b>cải thiện</b>&nbsp;mạnh.]]></description>' +
  '<pubDate>Tue, 20 Oct 2026 15:05:00 GMT+7</pubDate></item>' +
  '<item><title>Tin mã hóa &lt;b&gt;HTML&lt;/b&gt;</title><link>https://cafef.vn/b.chn</link>' +
  '<description>&lt;img src="https://cafef.vn/b.jpg"&gt;Tóm tắt &amp;amp; thêm</description>' +
  '<pubDate>Tue, 20 Oct 2026 08:00:00 +0000</pubDate><enclosure url="https://cafef.vn/enc.jpg" type="image/jpeg" length="1"/></item>' +
  '<item><title>Thiếu ngày</title><link>https://cafef.vn/c.chn</link></item>' +
  '<item><title>Link lạ</title><link>javascript:alert(1)</link><pubDate>Tue, 20 Oct 2026 08:00:00 +0000</pubDate></item>' +
  '</channel></rss>';

test('đọc RSS 2.0: CDATA, ảnh trong mô tả, GMT+7', function () {
  const it = rd.parseFeed(RSS);
  eq(it.length, 2, 'bỏ tin thiếu ngày và link không phải http');
  eq(it[0].title, 'VN-Index tăng 10 điểm & khối ngoại mua ròng');
  eq(it[0].link, 'https://cafef.vn/vn-index-tang-188.chn');
  eq(it[0].image, 'https://cafef.vn/a.jpg');
  eq(it[0].summary, 'Thanh khoản cải thiện mạnh.');
  eq(it[0].time, Date.UTC(2026, 9, 20, 8, 5) / 1000, 'GMT+7 → UTC');
});

test('mô tả mã hóa HTML, ảnh enclosure được ưu tiên', function () {
  const it = rd.parseFeed(RSS)[1];
  eq(it.title, 'Tin mã hóa HTML');
  eq(it.summary, 'Tóm tắt &amp; thêm'.replace('&amp;', '&'));
  eq(it.image, 'https://cafef.vn/enc.jpg');
});

test('đọc Atom: link rel=alternate, published', function () {
  const xml = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Fed giữ lãi suất</title>' +
    '<link rel="self" href="https://x.com/self"/><link rel="alternate" href="https://x.com/fed"/>' +
    '<published>2026-10-20T12:00:00Z</published><summary>Tóm tắt</summary>' +
    '<media:thumbnail url="https://x.com/t.jpg"/></entry></feed>';
  const it = rd.parseFeed(xml);
  eq(it.length, 1);
  eq(it[0].link, 'https://x.com/fed');
  eq(it[0].image, 'https://x.com/t.jpg');
  eq(it[0].time, Date.UTC(2026, 9, 20, 12) / 1000);
});

test('rss2json: ngày không múi giờ là UTC', function () {
  const it = rd.fromRss2Json({ status: 'ok', items: [
    { title: 'A', link: 'https://vneconomy.vn/a.htm', pubDate: '2026-10-20 08:00:00', description: '<p>Mô tả</p>', thumbnail: 'https://i/a.jpg' },
    { title: 'B', link: '', guid: 'https://vneconomy.vn/b.htm', pubDate: '2026-10-20 09:00:00', description: '', enclosure: { link: 'https://i/b.mp4', type: 'video/mp4' } },
  ] });
  eq(it.length, 2);
  eq(it[0].time, Date.UTC(2026, 9, 20, 8) / 1000);
  eq(it[0].summary, 'Mô tả');
  eq(it[1].link, 'https://vneconomy.vn/b.htm', 'lấy guid khi thiếu link');
  eq(it[1].image, '', 'enclosure không phải ảnh');
  eq(rd.fromRss2Json({ status: 'error', message: 'x' }), null);
});

test('tag: bỏ đuôi tiêu đề, bỏ mô tả của Google Tin tức', function () {
  const src = { id: 'reuters', name: 'Reuters', stripTitle: ' - Reuters', noSummary: true };
  const t = rd.tag([{ title: 'Oil rises - Reuters', link: 'https://n/1', summary: 'links', image: '', time: 1 }], src, 'world')[0];
  eq(t.title, 'Oil rises');
  eq(t.summary, '');
  eq(t.sourceId, 'reuters');
  eq(t.source, 'Reuters');
  eq(t.cats.join(), 'world');
});

function item(over) {
  return Object.assign({ title: 'T', link: 'https://a/1', summary: '', image: '', time: 1, source: 'S', sourceId: 's', cats: ['market'] }, over);
}

test('merge: bỏ trùng link/tiêu đề, hợp chuyên mục, mới nhất trước', function () {
  const out = rd.merge([
    [item({ title: 'Lãi suất giảm', link: 'https://cafef.vn/x.chn?utm_source=fb&utm_medium=x', time: 10, cats: ['finance'] })],
    [item({ title: 'Lãi suất giảm', link: 'https://www.cafef.vn/x.chn', time: 10, cats: ['macro'], image: 'https://i/x.jpg' })],
    [item({ title: 'LÃI SUẤT GIẢM!', link: 'https://other/y', time: 10, cats: ['market'] })],
    [item({ title: 'Tin mới', link: 'https://a/2', time: 20 })],
  ]);
  eq(out.length, 2);
  eq(out[0].title, 'Tin mới');
  eq(out[1].cats.join(), 'finance,macro,market');
  eq(out[1].image, 'https://i/x.jpg', 'lấy ảnh từ bản trùng');
});

test('merge: link khác tham số ?id= là tin khác', function () {
  const out = rd.merge([[item({ title: 'A', link: 'https://x.vn/news?id=1' }), item({ title: 'B', link: 'https://x.vn/news?id=2' })]]);
  eq(out.length, 2);
});

test('filter: chuyên mục, báo, từ khóa không dấu', function () {
  const items = [
    item({ title: 'Lãi suất huy động giảm', link: 'https://a/1', cats: ['finance'], sourceId: 'cafef' }),
    item({ title: 'Đất nền tăng giá', link: 'https://a/2', cats: ['realestate'], sourceId: 'vneconomy' }),
    item({ title: 'HPG báo lãi quý 3', link: 'https://a/3', cats: ['business', 'market'], sourceId: 'cafef' }),
  ];
  eq(rd.filter(items, { cat: 'all' }).length, 3);
  eq(rd.filter(items, { cat: 'market' }).length, 1);
  eq(rd.filter(items, { cat: 'all', sources: new Set(['vneconomy']) }).length, 1);
  eq(rd.filter(items, { q: 'lai suat' })[0].link, 'https://a/1');
  eq(rd.filter(items, { q: 'dat nen' }).length, 1, 'đ → d');
  eq(rd.filter(items, { q: 'hpg quý' }).length, 1, 'mọi từ đều phải có');
  eq(rd.filter(items, { q: 'hpg vàng' }).length, 0);
});

test('parseDate: các dạng ngày hay gặp', function () {
  eq(rd.parseDate('Tue, 20 Oct 2026 15:05:00 +0700'), Date.UTC(2026, 9, 20, 8, 5) / 1000);
  eq(rd.parseDate('2026-10-20T15:05:00+07:00'), Date.UTC(2026, 9, 20, 8, 5) / 1000);
  eq(rd.parseDate('2026-10-20 15:05:00'), Date.UTC(2026, 9, 20, 8, 5) / 1000, 'không múi giờ = giờ VN');
  ok(isNaN(rd.parseDate('')));
  ok(isNaN(rd.parseDate('abc')));
});

console.log(pass + '/' + (pass + fail) + ' bài kiểm tra đạt.');
if (fail) process.exit(1);
