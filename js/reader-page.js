// Trang đọc báo: gộp tin từ RSS các báo (VnEconomy, CafeF, Vietstock, Investing, Reuters, Bloomberg…) theo chuyên mục,
// lọc theo báo và từ khóa. Hàm xử lý tin ở js/reader.js, lấy dữ liệu qua VST.FeedSource / VST.NewsSource (data.js).
// Chỉ chạy sau khi xác nhận đã đăng nhập và tài khoản đang hoạt động.
VST.auth.guard().then(function (ctx) {
  const rcfg = VST.config.reader;
  const rd = VST.reader;
  const esc = VST.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'vst.reader.v1';
  const CAT_LABEL = {};
  rcfg.categories.forEach((c) => { CAT_LABEL[c.id] = c.label; });

  const feeds = new VST.FeedSource({ proxies: rcfg.proxies, cacheMs: rcfg.cacheMinutes * 60000 });

  const prefs = loadPrefs();
  const state = {
    cat: CAT_LABEL[prefs.cat] ? prefs.cat : 'all',
    off: new Set(Array.isArray(prefs.off) ? prefs.off : []), // id báo đang tắt
    q: '',
    lists: {},      // khóa feed → tin đã gắn báo/mục
    failed: {},     // id báo → số feed lỗi
    items: [],      // tin đã gộp
    shown: rcfg.pageSize,
    loading: false,
    token: 0,
    lastLoad: 0,
  };

  VST.auth.mountUserBar($('user-bar'), ctx.profile, 'reader');
  buildControls();
  load(false);
  setInterval(function () { if (!state.loading) load(true); }, rcfg.refreshMs);
  setInterval(renderList, 60000); // cập nhật "x phút trước"

  // ---------- Điều khiển ----------

  function buildControls() {
    $('rd-cats').innerHTML = rcfg.categories.map((c) =>
      '<button type="button" data-cat="' + c.id + '">' + esc(c.label) + '</button>').join('');
    $('rd-cats').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-cat]');
      if (!b) return;
      state.cat = b.dataset.cat;
      state.shown = rcfg.pageSize;
      savePrefs();
      render();
      b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });

    $('rd-sources').innerHTML = rcfg.sources.map((s) =>
      '<label class="chip"><input type="checkbox" data-src="' + s.id + '"' + (state.off.has(s.id) ? '' : ' checked') + '>' +
      '<span>' + esc(s.name) + '</span><span class="count" data-count="' + s.id + '"></span></label>').join('');
    $('rd-sources').addEventListener('change', function (e) {
      const id = e.target.dataset.src;
      if (!id) return;
      if (e.target.checked) state.off.delete(id); else state.off.add(id);
      state.shown = rcfg.pageSize;
      savePrefs();
      render();
    });
    $('rd-all').addEventListener('click', function () {
      state.off.clear();
      $('rd-sources').querySelectorAll('input[data-src]').forEach((i) => { i.checked = true; });
      savePrefs();
      render();
    });

    let timer = 0;
    $('rd-search').addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.q = $('rd-search').value;
        state.shown = rcfg.pageSize;
        render();
      }, 200);
    });

    $('rd-reload').addEventListener('click', function () { load(true); });
    $('rd-more').addEventListener('click', function () { state.shown += rcfg.pageSize; renderList(); });
    $('notice-close').addEventListener('click', function () { $('notice').hidden = true; });
    // Ảnh bị báo chặn tải từ trang khác: bỏ ảnh, giữ tin.
    $('rd-list').addEventListener('error', function (e) {
      if (e.target.tagName === 'IMG') e.target.closest('.rd-thumb').remove();
    }, true);
  }

  // ---------- Tải tin ----------

  // Mỗi feed RSS là một tác vụ; tin hiện dần khi từng feed về. force: bỏ qua bộ nhớ đệm.
  async function load(force) {
    const token = ++state.token;
    state.loading = true;
    state.failed = {};
    const tasks = [];
    rcfg.sources.forEach(function (src) {
      if (src.crawler) tasks.push({ key: src.id, src: src, run: loadCrawler });
      else src.feeds.forEach((f) => tasks.push({ key: f.url, src: src, run: () => feeds.getFeed(f.url, force).then((it) => rd.tag(it, src, f.cat)) }));
    });
    let done = 0;
    setStatus('loading', 'Đang tải tin… 0/' + tasks.length);
    render();

    let next = 0;
    async function worker() {
      while (next < tasks.length) {
        const t = tasks[next++];
        try {
          const items = await t.run(t.src);
          if (token !== state.token) return;
          state.lists[t.key] = items;
        } catch (err) {
          if (token !== state.token) return;
          if (!state.lists[t.key]) state.failed[t.src.id] = (state.failed[t.src.id] || 0) + 1;
        }
        done++;
        setStatus('loading', 'Đang tải tin… ' + done + '/' + tasks.length);
        rebuild();
      }
    }
    const n = Math.min(rcfg.batchSize, tasks.length);
    await Promise.all(Array.from({ length: n }, worker));
    if (token !== state.token) return;

    state.loading = false;
    state.lastLoad = Date.now();
    rebuild();
    if (!state.items.length) {
      setStatus('error', 'Không tải được tin');
      showNotice('Không tải được tin từ các báo. Có thể do mạng hoặc máy chủ trung gian đang quá tải — vui lòng thử lại sau.');
    } else {
      $('notice').hidden = true;
      setStatus('ok', 'Cập nhật ' + fmtClock(state.lastLoad));
    }
  }

  // Kho news-crawler: tin Vietstock gắn vào báo Vietstock, các báo khác vào nhóm "Tổng hợp VN".
  async function loadCrawler(src) {
    const items = await new VST.NewsSource().getDays(0, rcfg.crawlerDays);
    const byName = {};
    rcfg.sources.forEach((s) => { byName[rd.fold(s.name)] = s; });
    return items.map(function (it) {
      const own = byName[rd.fold(it.source)];
      return rd.tag([it], own && !own.crawler ? own : src, src.cat)[0];
    });
  }

  function rebuild() {
    // Feed RSS trước để tin trùng giữ chuyên mục của báo; tin news-crawler sau.
    const keys = Object.keys(state.lists).sort((a, b) => (a === 'crawler') - (b === 'crawler'));
    state.items = rd.merge(keys.map((k) => state.lists[k]));
    render();
  }

  // ---------- Hiển thị ----------

  function render() {
    $('rd-cats').querySelectorAll('button').forEach(function (b) {
      const on = b.dataset.cat === state.cat;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });

    const inCat = rd.filter(state.items, { cat: state.cat });
    const counts = {};
    inCat.forEach((it) => { counts[it.sourceId] = (counts[it.sourceId] || 0) + 1; });
    rcfg.sources.forEach(function (s) {
      const el = $('rd-sources').querySelector('[data-count="' + s.id + '"]');
      if (el) el.textContent = counts[s.id] ? counts[s.id] : (state.failed[s.id] && !state.loading ? '!' : '');
    });

    const failed = rcfg.sources.filter((s) => state.failed[s.id] && !counts[s.id] && !state.items.some((it) => it.sourceId === s.id));
    $('rd-failed').hidden = state.loading || !failed.length;
    $('rd-failed').innerHTML = failed.length ? 'Chưa tải được: ' + failed.map((s) =>
      '<a href="' + esc(s.home) + '" target="_blank" rel="noopener noreferrer">' + esc(s.name) + '</a>').join(', ') +
      ' (mở trang báo để xem trực tiếp).' : '';

    renderList();
  }

  function renderList() {
    const sources = new Set(rcfg.sources.filter((s) => !state.off.has(s.id)).map((s) => s.id));
    const hits = rd.filter(state.items, { cat: state.cat, sources: sources, q: state.q });
    const page = hits.slice(0, state.shown);

    if (!state.items.length) {
      $('rd-summary').textContent = state.loading ? 'Đang tải tin…' : 'Chưa có tin.';
    } else {
      $('rd-summary').textContent = hits.length
        ? hits.length + ' tin' + (state.cat !== 'all' ? ' mục ' + CAT_LABEL[state.cat] : '') + (state.q.trim() ? ' khớp “' + state.q.trim() + '”' : '')
        : 'Không có tin phù hợp. Thử chuyên mục khác, bật thêm báo hoặc đổi từ khóa.';
    }

    $('rd-list').innerHTML = page.map(function (it) {
      const cat = state.cat === 'all' ? CAT_LABEL[it.cats[0]] : '';
      return '<article class="rd-item">' +
        '<a class="rd-link" href="' + esc(it.link) + '" target="_blank" rel="noopener noreferrer">' +
          (it.image ? '<span class="rd-thumb"><img src="' + esc(it.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></span>' : '') +
          '<span class="rd-body">' +
            '<span class="rd-title">' + esc(it.title) + '</span>' +
            '<span class="rd-meta"><b>' + esc(it.source) + '</b> · ' + timeAgo(it.time) + (cat ? ' · ' + esc(cat) : '') + '</span>' +
            (it.summary ? '<span class="rd-sum">' + esc(it.summary) + '</span>' : '') +
          '</span>' +
        '</a>' +
      '</article>';
    }).join('');

    $('rd-more').hidden = hits.length <= state.shown;
    $('rd-more').textContent = 'Xem thêm (còn ' + (hits.length - page.length) + ' tin)';
  }

  // ---------- Tiện ích ----------

  function timeAgo(t) {
    const sec = Date.now() / 1000 - t;
    if (sec < 60) return 'vừa xong';
    if (sec < 3600) return Math.floor(sec / 60) + ' phút trước';
    if (sec < 86400) return Math.floor(sec / 3600) + ' giờ trước';
    const d = new Date((t + 7 * 3600) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
  }
  function fmtClock(ms) {
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function setStatus(kind, text) {
    $('status-dot').className = 'dot ' + kind;
    $('status-text').textContent = text;
  }
  function showNotice(msg) { $('notice-text').textContent = msg; $('notice').hidden = false; }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ cat: state.cat, off: Array.from(state.off) }));
    } catch (e) { /* bỏ qua */ }
  }
});
