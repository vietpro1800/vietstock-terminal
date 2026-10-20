// Khung ứng dụng (index.html): thanh trên cùng cố định + mỗi trang chức năng chạy trong một iframe riêng.
// Trang đã mở được giữ nguyên (ẩn đi) khi chuyển sang trang khác, nên quay lại không phải tải lại dữ liệu.
// Địa chỉ: index.html#<trang>, ví dụ #scan, #rrg; #dashboard?symbol=HPG hoặc index.html?symbol=HPG (link cũ).
// Trang con điều hướng qua VST.nav.open() / link thường (js/auth.js) → VST.shell.open().
(function () {
  const $ = (id) => document.getElementById(id);
  const PAGES = VST.auth.PAGES;
  const DEFAULT_PAGE = 'dashboard';
  const DEFAULT_TITLE = 'ThảoChi Stock';
  const frames = {};  // id → { el, search, obs }
  let allowed = null; // các trang người dùng được mở (sau khi đăng nhập)
  let current = null;

  VST.shell = { open: open };

  VST.auth.guard().then(function (ctx) {
    allowed = PAGES.filter((p) => !p.admin || ctx.profile.role === 'admin');
    $('shell-nav').innerHTML = allowed.map((p) =>
      '<a class="shell-tab" href="#' + p.id + '" data-id="' + p.id + '">' + VST.escapeHtml(p.label) + '</a>').join('');
    $('shell-user').innerHTML =
      '<span class="ub-email" title="' + VST.escapeHtml(ctx.profile.email) + '">' + VST.escapeHtml(ctx.profile.email) + '</span>' +
      '<button type="button" class="ub-btn" data-action="signout">Đăng xuất</button>';
    $('shell-user').querySelector('[data-action="signout"]').addEventListener('click', VST.auth.signOut);

    window.addEventListener('hashchange', openFromUrl);
    openFromUrl();
  });

  function parseUrl() {
    const h = decodeURIComponent(location.hash.slice(1));
    const q = h.indexOf('?');
    let id = q >= 0 ? h.slice(0, q) : h;
    let search = q >= 0 ? h.slice(q) : '';
    if (!id && location.search) { id = DEFAULT_PAGE; search = location.search; }
    return { id: id || DEFAULT_PAGE, search: search };
  }

  function openFromUrl() {
    const r = parseUrl();
    if (!open(r.id, r.search)) open(DEFAULT_PAGE, '');
  }

  // Mở trang id với chuỗi truy vấn search ('?symbol=HPG'). Trả về true nếu là trang của ứng dụng.
  function open(id, search) {
    if (id === 'index') id = DEFAULT_PAGE;
    if (!allowed) return PAGES.some((p) => p.id === id);
    const page = allowed.find((p) => p.id === id);
    if (!page) return PAGES.some((p) => p.id === id); // trang quản trị với người không có quyền: bỏ qua
    search = search || '';

    let f = frames[id];
    if (!f) {
      const el = document.createElement('iframe');
      el.className = 'shell-frame';
      el.title = page.label;
      el.src = id + '.html' + search;
      f = frames[id] = { el: el, search: search, obs: null };
      el.addEventListener('load', function () { watch(id); });
      $('shell-frames').appendChild(el);
    } else if (search) {
      // Dashboard đang mở: đổi mã ngay, không tải lại trang.
      const sym = new URLSearchParams(search).get('symbol');
      let dash = null;
      try { dash = f.el.contentWindow.VST && f.el.contentWindow.VST.dashboard; } catch (e) { /* bỏ qua */ }
      if (id === 'dashboard' && sym && dash) dash.selectSymbol(sym.trim().toUpperCase());
      else if (search !== f.search) f.el.src = id + '.html' + search;
      f.search = search;
    }
    activate(id);

    // Địa chỉ gọn index.html#id; mỗi lần chuyển trang thêm một mục lịch sử để nút Quay lại hoạt động.
    const want = '#' + id;
    if (location.search || location.hash.indexOf('?') >= 0 || !location.hash) {
      history.replaceState(null, '', location.pathname + want);
    } else if (location.hash !== want) {
      location.hash = want;
    }
    return true;
  }

  function activate(id) {
    current = id;
    Object.keys(frames).forEach(function (k) { frames[k].el.classList.toggle('active', k === id); });
    $('shell-nav').querySelectorAll('a[data-id]').forEach(function (a) {
      if (a.dataset.id === id) {
        a.setAttribute('aria-current', 'page');
        if (a.scrollIntoView) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else {
        a.removeAttribute('aria-current');
      }
    });
    renderMeta();
  }

  // Theo dõi tiêu đề và trạng thái (#status-dot, #status-text) của trang con để hiện trên thanh của khung.
  function watch(id) {
    const f = frames[id];
    const doc = docOf(f);
    if (f.obs) f.obs.disconnect();
    if (!doc) return;
    f.obs = new MutationObserver(function () { if (current === id) renderMeta(); });
    [doc.getElementById('status-dot'), doc.getElementById('status-text'), doc.querySelector('title')].forEach(function (n) {
      if (n) f.obs.observe(n, { attributes: true, childList: true, characterData: true, subtree: true });
    });
    if (current === id) renderMeta();
  }

  function renderMeta() {
    const doc = docOf(frames[current]);
    const dot = doc && doc.getElementById('status-dot');
    const text = doc && doc.getElementById('status-text');
    $('shell-status').hidden = !text;
    if (text) {
      $('shell-status-dot').className = dot ? dot.className : 'dot';
      $('shell-status-text').textContent = text.textContent;
    }
    document.title = (doc && doc.title) || DEFAULT_TITLE;
    const theme = doc && doc.querySelector('meta[name="theme-color"]');
    if (theme) document.querySelector('meta[name="theme-color"]').setAttribute('content', theme.getAttribute('content'));
  }

  function docOf(f) {
    try { return f && f.el.contentDocument; } catch (e) { return null; }
  }
})();
