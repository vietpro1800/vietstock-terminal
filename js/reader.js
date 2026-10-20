// Đọc báo: hàm thuần xử lý tin từ RSS/Atom, gộp nhiều báo, lọc theo mục/báo/từ khóa. Không DOM, không mạng —
// chạy được trong Node (kiểm thử: node tests/reader.test.js). Lấy dữ liệu: VST.FeedSource trong data.js.
(function (root) {
  const VST = root.VST = root.VST || {};

  const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

  function decode(s) {
    return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (m, e) {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
      }
      const v = ENTITIES[e.toLowerCase()];
      return v === undefined ? m : v;
    });
  }

  function cdata(s) { return String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'); }

  // Nội dung thẻ <name>…</name> đầu tiên (name có thể có tiền tố, vd. content:encoded). '' nếu không có.
  function tagText(block, name) {
    const re = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i');
    const m = block.match(re);
    return m ? cdata(m[1]).trim() : '';
  }

  // Giá trị thuộc tính attr của thẻ <name …> đầu tiên thỏa test (tùy chọn).
  function tagAttr(block, name, attr, test) {
    const re = new RegExp('<' + name + '\\s[^>]*>', 'gi');
    const are = new RegExp('\\s' + attr + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')', 'i');
    let m;
    while ((m = re.exec(block))) {
      if (test && !test(m[0])) continue;
      const a = m[0].match(are);
      if (a) return decode(a[2] !== undefined ? a[2] : a[3]).trim();
    }
    return '';
  }

  // HTML → chữ thuần (bỏ thẻ, giải mã ký tự, gộp khoảng trắng).
  function stripHtml(html) {
    return decode(String(html || '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>|<\/p>/gi, ' ')
      .replace(/<[^>]*>/g, ' '))
      .replace(/<[^>]*>/g, ' ') // mô tả mã hóa hai lần (&lt;img&gt;) sau khi giải mã
      .replace(/\s+/g, ' ')
      .trim();
  }

  function firstImg(html) {
    const m = String(html || '').match(/<img\s[^>]*?src\s*=\s*["']([^"']+)["']/i);
    return m ? decode(m[1]) : '';
  }

  function isHttp(u) { return /^https?:\/\//i.test(u || ''); }

  // Ngày RSS (RFC 822), Atom (ISO 8601). "GMT+7" → "+0700" vì Date.parse không hiểu dạng này.
  // utc: chuỗi "YYYY-MM-DD HH:MM:SS" không múi giờ là giờ UTC (rss2json). Trả về Unix giây hoặc NaN.
  function parseDate(s, utc) {
    s = String(s || '').trim();
    if (!s) return NaN;
    let m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/);
    if (m) s = m[1] + 'T' + m[2] + (utc ? 'Z' : '+07:00');
    s = s.replace(/(?:GMT|UTC)\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i, function (x, sign, h, mm) {
      return sign + String(h).padStart(2, '0') + (mm || '00');
    });
    const t = Date.parse(s);
    return isFinite(t) ? Math.floor(t / 1000) : NaN;
  }

  // Văn bản RSS 2.0 / Atom → [{ title, link, summary, image, time }]. Bỏ tin thiếu tiêu đề, link hoặc ngày.
  function parseFeed(xml) {
    xml = String(xml || '');
    let blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi);
    const atom = !blocks;
    if (atom) blocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    return blocks.map(function (b) {
      const title = stripHtml(tagText(b, 'title'));
      let link = atom
        ? tagAttr(b, 'link', 'href', (t) => !/\srel\s*=\s*["'](?!alternate)/i.test(t)) || tagAttr(b, 'link', 'href')
        : decode(tagText(b, 'link'));
      if (!isHttp(link)) {
        const guid = decode(tagText(b, 'guid'));
        if (isHttp(guid)) link = guid;
      }
      const desc = decode(tagText(b, 'description') || tagText(b, 'summary') || tagText(b, 'content:encoded') || tagText(b, 'content'));
      const image = tagAttr(b, 'enclosure', 'url', (t) => !/type\s*=/i.test(t) || /type\s*=\s*["']image/i.test(t)) ||
        tagAttr(b, 'media:content', 'url', (t) => !/medium\s*=/i.test(t) || /medium\s*=\s*["']image/i.test(t)) ||
        tagAttr(b, 'media:thumbnail', 'url') || firstImg(desc) || firstImg(decode(tagText(b, 'content:encoded')));
      const time = parseDate(tagText(b, 'pubDate') || tagText(b, 'published') || tagText(b, 'updated') || tagText(b, 'dc:date'));
      return { title: title, link: link.trim(), summary: stripHtml(desc), image: isHttp(image) ? image : '', time: time };
    }).filter((it) => it.title && isHttp(it.link) && isFinite(it.time));
  }

  // Kết quả api.rss2json.com → cùng dạng với parseFeed.
  function fromRss2Json(json) {
    if (!json || json.status !== 'ok' || !Array.isArray(json.items)) return null;
    return json.items.map(function (it) {
      const desc = String(it.description || it.content || '');
      const enc = it.enclosure && it.enclosure.link && (!it.enclosure.type || /^image/i.test(it.enclosure.type)) ? it.enclosure.link : '';
      const image = it.thumbnail || enc || firstImg(desc) || firstImg(it.content);
      const link = isHttp(it.link) ? it.link : (isHttp(it.guid) ? it.guid : '');
      return { title: stripHtml(it.title), link: String(link).trim(), summary: stripHtml(desc), image: isHttp(image) ? image : '',
        time: parseDate(it.pubDate, true) };
    }).filter((it) => it.title && isHttp(it.link) && isFinite(it.time));
  }

  // Gắn thông tin báo/mục cho tin của một feed. src: mục trong VST.config.reader.sources; cat: id mục.
  function tag(items, src, cat) {
    return items.map(function (it) {
      let title = it.title;
      if (src.stripTitle && title.endsWith(src.stripTitle)) title = title.slice(0, -src.stripTitle.length).trim();
      let summary = src.noSummary ? '' : it.summary;
      if (summary === title) summary = '';
      return { title: title, link: it.link, summary: summary.slice(0, 400), image: it.image || '', time: it.time,
        source: it.source || src.name, sourceId: src.id, cats: [cat] };
    });
  }

  // Chữ thường, bỏ dấu tiếng Việt (tìm "lai suat" ra "lãi suất").
  function fold(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[đĐ]/g, 'd').toLowerCase();
  }

  // Khóa gộp tin trùng: cùng link, hoặc cùng tiêu đề (một bài nằm ở nhiều mục / được nhiều nguồn đưa lại).
  // Bỏ giao thức, www, #… và tham số theo dõi utm_*; giữ tham số khác (có báo dùng ?id=…).
  function linkKey(u) {
    return String(u).replace(/^https?:\/\/(www\.)?/i, '').replace(/#.*$/, '')
      .replace(/([?&])utm_[^&]*/gi, '$1').replace(/[?&]+$/, '').replace(/\?&+/, '?').replace(/\/$/, '').toLowerCase();
  }
  function titleKey(t) { return fold(t).replace(/[^a-z0-9]+/g, ' ').trim(); }

  // Gộp nhiều danh sách tin: bỏ trùng (giữ bản đầu tiên, hợp mục), mới nhất trước.
  function merge(lists) {
    const byKey = new Map();
    const out = [];
    lists.forEach(function (list) {
      (list || []).forEach(function (it) {
        const k1 = 'l:' + linkKey(it.link), k2 = 't:' + titleKey(it.title);
        const prev = byKey.get(k1) || byKey.get(k2);
        if (prev) {
          it.cats.forEach((c) => { if (prev.cats.indexOf(c) < 0) prev.cats.push(c); });
          if (!prev.image && it.image) prev.image = it.image;
          if (!prev.summary && it.summary) prev.summary = it.summary;
          return;
        }
        const copy = Object.assign({}, it, { cats: it.cats.slice() });
        copy.id = k1;
        byKey.set(k1, copy);
        byKey.set(k2, copy);
        out.push(copy);
      });
    });
    out.sort((a, b) => b.time - a.time);
    return out;
  }

  // Lọc: cat ('all' hoặc id mục), sources (Set id báo đang bật, null = tất cả), q (mọi từ phải có, không phân biệt dấu).
  function filter(items, opts) {
    const cat = opts && opts.cat;
    const sources = opts && opts.sources;
    const terms = fold(opts && opts.q).split(/\s+/).filter(Boolean);
    return items.filter(function (it) {
      if (cat && cat !== 'all' && it.cats.indexOf(cat) < 0) return false;
      if (sources && !sources.has(it.sourceId)) return false;
      if (!terms.length) return true;
      const text = fold(it.title + ' ' + it.summary + ' ' + it.source);
      return terms.every((t) => text.indexOf(t) >= 0);
    });
  }

  VST.reader = {
    decode: decode, stripHtml: stripHtml, parseDate: parseDate, parseFeed: parseFeed, fromRss2Json: fromRss2Json,
    tag: tag, fold: fold, merge: merge, filter: filter,
  };
})(typeof window !== 'undefined' ? window : globalThis);
