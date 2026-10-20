// Trang Phân tích mã (analysis.html): hội chẩn 6 vai trò cho một mã, điểm tính bằng VST.consult (js/consult.js)
// từ nến ngày VNDirect. Chỉ chạy sau khi xác nhận đã đăng nhập và tài khoản đang hoạt động.
VST.auth.guard().then(function (ctx) {
  const cfg = VST.config.consult;
  const consult = VST.consult;
  const esc = VST.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'vst.analysis.v1';
  const MAX_RECENT = 8;
  const SYMBOL_RE = /^[A-Z0-9]{2,10}$/;
  const VERDICT_CLASS = { 'MUA': 'buy', 'THEO DÕI': 'watch', 'TRÁNH': 'avoid' };

  // Đổi nguồn dữ liệu tại đây (cùng lớp với dashboard).
  const source = new VST.VndirectSource({ batchSize: VST.config.batchSize });
  const LOAD_TF = { label: 'Ngày', resolution: 'D', days: cfg.days };

  const prefs = loadPrefs();
  const state = {
    symbol: null,
    recent: Array.isArray(prefs.recent) ? prefs.recent.filter((s) => SYMBOL_RE.test(s)).slice(0, MAX_RECENT) : [],
    loadToken: 0,
  };

  VST.auth.mountUserBar($('user-bar'), ctx.profile, 'analysis');
  $('an-list').innerHTML = VST.config.boardSymbols.map((s) => '<option value="' + s + '">').join('');
  $('notice-close').addEventListener('click', function () { $('notice').hidden = true; });
  $('an-form').addEventListener('submit', function (e) {
    e.preventDefault();
    const v = $('an-input').value.trim().toUpperCase();
    if (!SYMBOL_RE.test(v)) { showNotice('Mã không hợp lệ. Nhập 2–10 chữ cái hoặc số, ví dụ KDH.'); return; }
    $('an-input').blur();
    analyze(v);
  });
  $('an-recent').addEventListener('click', function (e) {
    const b = e.target.closest('button[data-symbol]');
    if (b) analyze(b.dataset.symbol);
  });
  $('an-chart').addEventListener('click', function () {
    if (state.symbol) VST.nav.open('dashboard.html?symbol=' + encodeURIComponent(state.symbol));
  });
  renderRecent();

  const urlSymbol = (new URLSearchParams(location.search).get('symbol') || '').trim().toUpperCase();
  const first = SYMBOL_RE.test(urlSymbol) ? urlSymbol : state.recent[0];
  if (first) analyze(first);
  else setStatus('ok', 'Sẵn sàng');

  async function analyze(symbol) {
    const token = ++state.loadToken;
    state.symbol = symbol;
    $('an-input').value = symbol;
    $('notice').hidden = true;
    $('an-symbol').textContent = symbol;
    $('an-price').textContent = '';
    $('an-date').textContent = '';
    $('an-verdict').hidden = true;
    $('an-chart').hidden = false;
    $('an-grid').innerHTML = '<p class="dim">Đang tải dữ liệu…</p>';
    setStatus('loading', 'Đang phân tích ' + symbol + '…');
    try {
      const bars = await source.getHistory(symbol, LOAD_TF);
      if (token !== state.loadToken) return;
      const r = consult.analyze(bars, cfg);
      if (!r) {
        $('an-grid').innerHTML = '<p class="dim">Mã ' + esc(symbol) + ' chưa đủ ' + consult.MIN_BARS +
          ' phiên giao dịch để phân tích.</p>';
        setStatus('error', 'Thiếu dữ liệu');
        return;
      }
      render(symbol, bars, r);
      remember(symbol);
      setStatus('ok', 'Dữ liệu đến ' + fmtDate(r.time));
    } catch (err) {
      if (token !== state.loadToken) return;
      $('an-grid').innerHTML = '';
      showNotice(messageOf(err));
      setStatus('error', 'Lỗi tải dữ liệu');
    }
  }

  function render(symbol, bars, r) {
    const prev = bars[bars.length - 2].close;
    const chg = r.price - prev;
    const cls = chg > 0 ? 'up' : chg < 0 ? 'down' : 'ref';
    $('an-price').innerHTML = '<b class="' + cls + '">' + fmtNum(r.price, 2) + '</b> <span class="' + cls + '">' +
      (chg > 0 ? '+' : '') + fmtNum(chg, 2) + ' (' + (chg > 0 ? '+' : '') + fmtNum(chg / prev * 100, 2) + '%)</span>';
    $('an-date').textContent = 'Phiên ' + fmtDate(r.time);
    const v = $('an-verdict');
    v.textContent = r.verdict;
    v.className = 'an-verdict ' + VERDICT_CLASS[r.verdict];
    v.hidden = false;

    $('an-grid').innerHTML = r.cards.map(function (c) {
      const lv = consult.level(c.score, cfg);
      const summary = c.id === 'summary';
      return '<article class="an-card' + (summary ? ' an-summary' : '') + '">' +
        '<header><h3>' + esc(c.label).replace('/', '/<wbr>') + '</h3><b class="an-score lv-' + lv + '">' + fmtNum(c.score, 2) + '</b></header>' +
        '<div class="an-bar" role="meter" aria-valuemin="0" aria-valuemax="1" aria-valuenow="' + c.score + '" aria-label="Điểm ' +
          esc(c.label) + '"><i class="lv-' + lv + '" style="width:' + Math.round(c.score * 100) + '%"></i></div>' +
        (summary ? '<p class="an-verdict-line ' + VERDICT_CLASS[c.verdict] + '">' + esc(c.verdict) + '</p>' : '') +
        '<p class="an-note">' + esc(c.note) + '</p>' +
        '</article>';
    }).join('');
  }

  function remember(symbol) {
    state.recent = [symbol].concat(state.recent.filter((s) => s !== symbol)).slice(0, MAX_RECENT);
    savePrefs();
    renderRecent();
  }

  function renderRecent() {
    $('an-recent').innerHTML = state.recent.map((s) =>
      '<button type="button" class="an-chip' + (s === state.symbol ? ' active' : '') + '" data-symbol="' + esc(s) + '">' +
      esc(s) + '</button>').join('');
  }

  // ---------- Tiện ích ----------

  function fmtNum(v, d) {
    return v.toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtDate(t) {
    const d = new Date((t + 7 * 3600) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }
  function setStatus(kind, text) {
    $('status-dot').className = 'dot ' + kind;
    $('status-text').textContent = text;
  }
  function messageOf(err) {
    return err && err.name === 'DataError' ? err.message : 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.';
  }
  function showNotice(msg) { $('notice-text').textContent = msg; $('notice').hidden = false; }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ recent: state.recent }));
    } catch (e) { /* bỏ qua: chế độ ẩn danh hoặc bị chặn lưu trữ */ }
  }
});
