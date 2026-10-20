// Tin tức liên quan đến mã đang xem (tab "Tin tức" của đồ thị kỹ thuật).
//   VST.news.matcher(symbol, keywords) — hàm thuần: trả về hàm (chuỗi) → có nhắc tới mã không. Chạy được trong Node.
//   VST.StockNews — khung hiển thị (DOM); dữ liệu lấy qua VST.NewsSource trong data.js.
(function (root) {
  const VST = root.VST = root.VST || {};

  // Mã trùng với từ viết tắt hay gặp trong tin (TP.HCM, CEO, tiền USD/VND): chỉ tính khi có ngữ cảnh chứng khoán.
  const AMBIGUOUS = { CEO: true, HCM: true, USD: true, VND: true };
  const DAYS_STEP = 7;
  const MAX_DAYS = 28;

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Ranh giới từ theo Unicode: chữ tiếng Việt (Đ, ơ…) cũng là chữ, nên "ĐTCK" không chứa mã TCK.
  // keywords (tài sản thế giới): danh sách từ khóa, không phân biệt hoa thường. Cổ phiếu: mã viết hoa đứng riêng.
  function matcher(symbol, keywords) {
    if (keywords && keywords.length) {
      const re = new RegExp('(?<![\\p{L}\\p{N}])(?:' + keywords.map(escapeRe).join('|') + ')(?![\\p{L}\\p{N}])', 'iu');
      return (t) => re.test(t);
    }
    const sym = escapeRe(String(symbol || '').toUpperCase());
    if (!sym) return () => false;
    if (AMBIGUOUS[symbol]) {
      const ctx = new RegExp('(?:[Cc]ổ phiếu|[Mm]ã|CP|[Cc]hứng khoán)\\s+' + sym + '(?![\\p{L}\\p{N}])|' +
        '(?<![\\p{L}\\p{N}.])' + sym + '\\s*\\((?:HOSE|HSX|HNX|UPCoM|UPCOM)', 'u');
      return (t) => ctx.test(t);
    }
    const re = new RegExp('(?<![\\p{L}\\p{N}.])' + sym + '(?![\\p{L}\\p{N}])', 'u');
    return (t) => re.test(t);
  }

  VST.news = { matcher: matcher, AMBIGUOUS: AMBIGUOUS };

  if (typeof document === 'undefined') return;

  const esc = (s) => VST.escapeHtml(s);

  class StockNews {
    // source: VST.NewsSource.
    constructor(rootEl, source) {
      this.root = rootEl;
      this.source = source;
      this.symbol = null;
      this.keywords = null;
      this.match = () => false;
      this.items = [];   // tin của mọi ngày đã tải
      this.days = 0;     // số ngày đã tải
      this.loading = false;
      this.error = '';
      this.visible = false;
      this.token = 0;

      rootEl.innerHTML =
        '<p class="news-head dim"></p>' +
        '<div class="news-list" aria-live="polite"></div>' +
        '<button type="button" class="btn btn-sm news-more" hidden></button>' +
        '<p class="news-links"></p>';
      this.head = rootEl.querySelector('.news-head');
      this.list = rootEl.querySelector('.news-list');
      this.more = rootEl.querySelector('.news-more');
      this.links = rootEl.querySelector('.news-links');
      this.more.addEventListener('click', () => this.load());
    }

    // Chỉ tải tin khi khung được mở lần đầu (mỗi ngày ~100–200 KB).
    setVisible(v) {
      this.visible = v;
      if (v && !this.days && !this.loading) this.load();
    }

    // keywords: từ khóa cho tài sản thế giới (VST.config.globalAssets[].news), null với cổ phiếu.
    // label: tên hiển thị (mặc định là mã).
    setSymbol(symbol, keywords, label) {
      this.symbol = symbol;
      this.label = label || symbol;
      this.keywords = keywords || null;
      this.match = matcher(symbol, this.keywords);
      this.render();
    }

    async load() {
      if (this.loading || this.days >= MAX_DAYS) return;
      const token = ++this.token;
      this.loading = true;
      this.error = '';
      this.render();
      try {
        const items = await this.source.getDays(this.days, DAYS_STEP);
        if (token !== this.token) return;
        const seen = new Set(this.items.map((it) => it.id));
        this.items = this.items.concat(items.filter((it) => !seen.has(it.id)));
        this.days += DAYS_STEP;
      } catch (err) {
        if (token !== this.token) return;
        this.error = err && err.name === 'DataError' ? err.message : 'Không tải được tin tức. Vui lòng thử lại.';
      } finally {
        if (token === this.token) {
          this.loading = false;
          this.render();
        }
      }
    }

    render() {
      const sym = this.symbol || '';
      const name = this.label || sym;
      const hits = this.items.filter((it) => this.match(it.title + ' ' + it.summary));
      if (this.days) {
        this.head.textContent = hits.length
          ? hits.length + ' tin nhắc tới ' + name + ' trong ' + this.days + ' ngày qua'
          : 'Chưa có tin nào nhắc tới ' + name + ' trong ' + this.days + ' ngày qua.';
      } else {
        this.head.textContent = this.loading ? 'Đang tải tin tức…' : '';
      }
      this.list.innerHTML = hits.map(function (it) {
        return '<article class="news-item">' +
          '<a class="news-title" href="' + esc(it.link) + '" target="_blank" rel="noopener noreferrer">' + esc(it.title) + '</a>' +
          '<div class="news-meta">' + esc(it.source) + ' · ' + timeAgo(it.time) + '</div>' +
          (it.summary ? '<p class="news-sum">' + esc(it.summary) + '</p>' : '') +
        '</article>';
      }).join('') + (this.error ? '<p class="chat-error">' + esc(this.error) + '</p>' : '');

      const canMore = !this.loading && this.days > 0 && this.days < MAX_DAYS;
      this.more.hidden = !(canMore || (this.loading && this.days));
      this.more.disabled = this.loading;
      this.more.textContent = this.loading ? 'Đang tải…' : 'Xem tin cũ hơn (thêm ' + DAYS_STEP + ' ngày)';
      if (this.error && !this.days) { this.more.hidden = false; this.more.disabled = false; this.more.textContent = 'Thử lại'; }

      this.links.innerHTML = sym ? 'Tìm thêm: ' + externalLinks(sym, this.keywords).map((l) =>
        '<a href="' + esc(l[1]) + '" target="_blank" rel="noopener noreferrer">' + esc(l[0]) + '</a>').join(' · ') : '';
    }
  }

  function externalLinks(sym, keywords) {
    const q = keywords && keywords.length ? keywords[0] : sym + ' cổ phiếu';
    const google = ['Google Tin tức', 'https://news.google.com/search?q=' + encodeURIComponent(q) + '&hl=vi&gl=VN&ceid=VN:vi'];
    if (keywords && keywords.length) return [google];
    const s = encodeURIComponent(sym);
    return [
      google,
      ['Vietstock', 'https://finance.vietstock.vn/' + s + '/tin-tuc-su-kien.htm'],
      ['FireAnt', 'https://fireant.vn/ma-chung-khoan/' + s],
    ];
  }

  function timeAgo(t) {
    const sec = Date.now() / 1000 - t;
    if (sec < 3600) return Math.max(1, Math.floor(sec / 60)) + ' phút trước';
    if (sec < 86400) return Math.floor(sec / 3600) + ' giờ trước';
    const d = new Date((t + 7 * 3600) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }

  VST.StockNews = StockNews;
})(typeof window !== 'undefined' ? window : globalThis);
