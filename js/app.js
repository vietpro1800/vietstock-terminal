// Khởi tạo ứng dụng, gắn sự kiện giao diện và tự làm mới.
// Chỉ chạy sau khi xác nhận đã đăng nhập và tài khoản đang hoạt động.
VST.auth.guard().then(function (ctx) {
  const cfg = VST.config;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'vst.prefs.v1';

  // Đổi nguồn dữ liệu tại đây.
  const source = new VST.VndirectSource({ batchSize: cfg.batchSize });

  const prefs = loadPrefs();
  // Cho phép mở thẳng một mã: index.html?symbol=HPG (ví dụ từ trang RRG).
  const urlSymbol = (new URLSearchParams(location.search).get('symbol') || '').trim().toUpperCase();
  const state = {
    symbol: /^[A-Z0-9]{2,10}$/.test(urlSymbol) ? urlSymbol : (prefs.symbol || cfg.defaultSymbol),
    tfKey: cfg.timeframes[prefs.tfKey] ? prefs.tfKey : cfg.defaultTimeframe,
    indicators: Object.assign({}, cfg.defaultIndicators, prefs.indicators),
    sideTab: prefs.sideTab === 'board' ? 'board' : 'chat',
    loadToken: 0,
    refreshing: false,
    lastRefresh: 0,
  };

  let chart = null;
  if (window.LightweightCharts) {
    chart = new VST.ChartView({ main: $('chart-main'), rsi: $('chart-rsi'), macd: $('chart-macd'), legend: $('legend') });
  } else {
    showNotice('Không tải được thư viện biểu đồ. Kiểm tra kết nối Internet rồi tải lại trang.');
  }

  const board = new VST.PriceBoard($('board-body'), source, selectSymbol);
  // Sổ lệnh realtime (nguồn WebSocket trong data.js) và thảo luận theo mã.
  const feed = new VST.SsiRealtimeFeed();
  const book = new VST.OrderBook($('orderbook'));
  const chat = new VST.StockChat($('chat'), {
    user: ctx.user,
    profile: ctx.profile,
    onUnread: function (n) {
      $('chat-badge').textContent = n > 99 ? '99+' : n;
      $('chat-badge').hidden = !n;
    },
  });
  VST.auth.mountUserBar($('user-bar'), ctx.profile, 'dashboard');

  buildControls();
  selectSymbol(state.symbol);
  setInterval(tick, cfg.refreshMs);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && Date.now() - state.lastRefresh >= cfg.refreshMs) refreshAll();
  });
  window.addEventListener('online', refreshAll);

  // ---------- Giao diện ----------

  function buildControls() {
    $('symbol-list').innerHTML = cfg.boardSymbols.map((s) => '<option value="' + s + '">').join('');

    $('symbol-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const v = $('symbol-input').value.trim().toUpperCase();
      if (!v) return;
      $('symbol-input').blur();
      selectSymbol(v);
    });

    const tfGroup = $('tf-group');
    tfGroup.innerHTML = Object.keys(cfg.timeframes).map((k) =>
      '<button type="button" data-tf="' + k + '">' + cfg.timeframes[k].label + '</button>').join('');
    tfGroup.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-tf]');
      if (!btn || btn.dataset.tf === state.tfKey) return;
      state.tfKey = btn.dataset.tf;
      savePrefs();
      renderTf();
      loadChart(false);
    });
    renderTf();

    document.querySelectorAll('#ind-group input[data-ind]').forEach(function (cb) {
      cb.checked = !!state.indicators[cb.dataset.ind];
      cb.addEventListener('change', function () {
        state.indicators[cb.dataset.ind] = cb.checked;
        savePrefs();
        if (chart) chart.setIndicators(state.indicators);
      });
    });
    if (chart) chart.setIndicators(state.indicators);

    $('notice-close').addEventListener('click', hideNotice);

    $('side-tabs').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      state.sideTab = b.dataset.tab;
      savePrefs();
      renderSideTab();
    });
    renderSideTab();
  }

  function renderSideTab() {
    $('side-tabs').querySelectorAll('button[data-tab]').forEach(function (b) {
      const on = b.dataset.tab === state.sideTab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    $('pane-chat').hidden = state.sideTab !== 'chat';
    $('pane-board').hidden = state.sideTab !== 'board';
    chat.setVisible(state.sideTab === 'chat');
  }

  function renderTf() {
    $('tf-group').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tf === state.tfKey);
      b.setAttribute('aria-pressed', b.dataset.tf === state.tfKey);
    });
  }

  function selectSymbol(symbol) {
    state.symbol = symbol;
    $('symbol-input').value = symbol;
    $('chart-title').textContent = symbol;
    document.title = symbol + ' · ThảoChi Stock';
    board.setActive(symbol);
    book.reset(symbol);
    feed.watch(symbol, (q) => book.push(q), (s) => book.setStatus(s));
    chat.setSymbol(symbol);
    savePrefs();
    if (state.lastRefresh === 0) refreshAll();
    else loadChart(false);
    if (window.innerWidth < 900) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- Dữ liệu ----------

  // keepView = true khi tự làm mới, để không mất vị trí người dùng đang xem.
  async function loadChart(keepView) {
    if (!chart) return;
    const token = ++state.loadToken;
    const symbol = state.symbol;
    const tf = cfg.timeframes[state.tfKey];
    if (!keepView) $('chart-loading').hidden = false;
    try {
      const bars = await source.getHistory(symbol, tf);
      if (token !== state.loadToken) return; // đã có yêu cầu mới hơn
      chart.setData(bars, tf, keepView);
      // Nến ngày cho sổ lệnh hiện giá tham khảo khi chưa có dữ liệu realtime.
      if (tf.resolution === 'D' && !tf.aggregate) book.setFallback(symbol, bars);
      return true;
    } catch (err) {
      if (token !== state.loadToken) return;
      showNotice(messageOf(err));
      return false;
    } finally {
      if (token === state.loadToken) $('chart-loading').hidden = true;
    }
  }

  async function refreshBoard() {
    try {
      const errors = await board.refresh(cfg.boardSymbols);
      if (errors.length === cfg.boardSymbols.length) {
        showNotice('Không tải được bảng giá. ' + messageOf(errors[0]));
        return false;
      }
      if (errors.length) {
        showNotice('Không tải được ' + errors.length + ' mã trong bảng giá: ' +
          errors.map((e) => e.symbol).join(', ') + '.');
        return 'partial';
      }
      return true;
    } catch (err) {
      showNotice(messageOf(err));
      return false;
    }
  }

  async function refreshAll() {
    if (state.refreshing) return;
    state.refreshing = true;
    setStatus('loading', 'Đang cập nhật…');
    const first = state.lastRefresh === 0;
    const results = await Promise.all([loadChart(!first), refreshBoard()]);
    state.lastRefresh = Date.now();
    state.refreshing = false;
    const ok = results.every((r) => r !== false);
    if (results.every((r) => r === true)) hideNotice();
    const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    setStatus(ok ? 'ok' : 'error', (ok ? 'Cập nhật ' : 'Lỗi lúc ') + time);
  }

  function tick() {
    if (document.hidden) return; // không gọi API khi tab bị ẩn
    refreshAll();
  }

  // ---------- Thông báo ----------

  function messageOf(err) {
    return err && err.name === 'DataError' ? err.message : 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.';
  }

  function showNotice(msg) {
    $('notice-text').textContent = msg;
    $('notice').hidden = false;
  }

  function hideNotice() { $('notice').hidden = true; }

  function setStatus(kind, text) {
    $('status-dot').className = 'dot ' + kind;
    $('status-text').textContent = text;
  }

  // ---------- Lưu tùy chọn (chỉ trên trình duyệt này) ----------

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        symbol: state.symbol, tfKey: state.tfKey, indicators: state.indicators, sideTab: state.sideTab,
      }));
    } catch (e) { /* bỏ qua: chế độ ẩn danh hoặc bị chặn lưu trữ */ }
  }
});
