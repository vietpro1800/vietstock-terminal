// Trang cảnh báo Mua/Bán: quét nến ngày các mã trong phạm vi đã chọn, tìm tín hiệu của các chiến lược (VST.signals),
// theo dõi % lãi/lỗ và số phiên T+ kể từ ngày báo; giá hiện tại cập nhật realtime từ bảng giá SSI.
// Chỉ chạy sau khi xác nhận đã đăng nhập và tài khoản đang hoạt động.
VST.auth.guard().then(function (ctx) {
  const cfg = VST.config;
  const scfg = cfg.signals;
  const bt = VST.backtest;
  const sg = VST.signals;
  const uni = VST.universe;
  const esc = VST.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'vst.signals.v1';
  const SEEN_KEY = 'vst.signals.seen.v1';
  const MAX_SEEN = 3000;
  const SIDE = { buy: 'Mua', sell: 'Bán' };
  const maxWindow = Math.max.apply(null, scfg.windows);

  // Đổi nguồn dữ liệu tại đây (cùng lớp với dashboard).
  const source = new VST.VndirectSource({ batchSize: scfg.batchSize });
  const feed = new VST.SsiBoardFeed();

  const prefs = loadPrefs();
  const state = {
    strategies: {},     // id → { on, params }
    scope: scfg.scopes.some((s) => s.id === prefs.scope) ? prefs.scope : scfg.defaultScope,
    window: scfg.windows.indexOf(prefs.window) >= 0 ? prefs.window : scfg.defaultWindow,
    side: ['all', 'buy', 'sell'].indexOf(prefs.side) >= 0 ? prefs.side : 'all',
    sort: prefs.sort && prefs.sort.key ? prefs.sort : { key: 'time', dir: -1 },
    bars: {},           // mã → nến ngày
    days: {},           // mã → số ngày lịch sử đã tải
    failed: [],
    rows: [],           // [{ symbol, sig }]
    prices: {},
    seen: loadSeen(),
    fresh: new Set(),   // tín hiệu chưa thấy ở lần mở trước
    lastScan: 0,
    loadToken: 0,
    dirty: false,
  };
  Object.keys(bt.STRATEGIES).forEach(function (id) {
    const p = prefs.strategies && prefs.strategies[id];
    state.strategies[id] = {
      on: p ? !!p.on : scfg.defaultStrategies.indexOf(id) >= 0,
      params: Object.assign(bt.defaultParams(id), p && p.params),
    };
  });

  const COLUMNS = [
    { key: 'symbol', label: 'Mã', text: true },
    { key: 'side', label: 'Tín hiệu', text: true },
    { key: 'strategy', label: 'Chiến lược', text: true },
    { key: 'time', label: 'Ngày báo' },
    { key: 'sigPrice', label: 'Giá báo' },
    { key: 'price', label: 'Giá hiện tại' },
    { key: 'pnl', label: 'Lãi/lỗ' },
    { key: 'sessions', label: 'T+' },
  ];

  VST.auth.mountUserBar($('user-bar'), ctx.profile, 'signals');
  buildControls();
  load(false);
  setInterval(autoRefresh, 60000);

  // ---------- Điều khiển ----------

  function buildControls() {
    $('sg-strategies').innerHTML = Object.keys(bt.STRATEGIES).map(function (id) {
      const st = bt.STRATEGIES[id];
      const s = state.strategies[id];
      const fields = st.params.map(function (d) {
        const v = s.params[d.key];
        const ctrl = d.options
          ? '<select class="input" data-sid="' + id + '" data-param="' + d.key + '">' + d.options.map((o) =>
            '<option value="' + esc(o[0]) + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>'
          : '<input class="input" type="number" inputmode="decimal" data-sid="' + id + '" data-param="' + d.key + '" min="' + d.min +
            '" max="' + d.max + '" step="' + d.step + '" value="' + esc(v) + '">';
        return '<label class="form-field"><span>' + esc(d.label) + '</span>' + ctrl + '</label>';
      }).join('');
      return '<div class="sg-strat">' +
        '<label class="sg-strat-head"><input type="checkbox" data-on="' + id + '"' + (s.on ? ' checked' : '') + '>' +
          '<span><b>' + esc(st.name) + '</b><small class="dim">' + esc(st.desc) + '</small></span></label>' +
        '<details class="sg-params"><summary>Tham số</summary><div class="pp-params">' + fields + '</div>' +
          '<p class="sg-param-err auth-msg error" data-err="' + id + '" hidden></p></details></div>';
    }).join('');
    $('sg-strategies').addEventListener('change', onStrategyInput);

    $('sg-scope').innerHTML = scfg.scopes.map((s) =>
      '<option value="' + s.id + '">' + esc(s.label) + ' (' + scopeSymbols(s.id).length + ' mã)</option>').join('');
    $('sg-scope').value = state.scope;
    $('sg-scope').addEventListener('change', function () { state.scope = this.value; savePrefs(); load(false); });

    $('sg-window').innerHTML = scfg.windows.map((n) => '<button type="button" data-v="' + n + '">' + n + ' phiên</button>').join('');
    $('sg-window').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      state.window = Number(b.dataset.v);
      savePrefs();
      compute();
    });
    $('sg-side-filter').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-v]');
      if (!b) return;
      state.side = b.dataset.v;
      savePrefs();
      render();
    });
    $('sg-head').addEventListener('click', function (e) {
      const th = e.target.closest('th[data-sort]');
      if (!th) return;
      const key = th.dataset.sort;
      const col = COLUMNS.find((c) => c.key === key);
      state.sort = state.sort.key === key ? { key: key, dir: -state.sort.dir } : { key: key, dir: col.text ? 1 : -1 };
      savePrefs();
      render();
    });

    $('sg-reload').addEventListener('click', function () { load(true); });
    $('sg-notify').addEventListener('click', enableNotify);
    $('notice-close').addEventListener('click', function () { $('notice').hidden = true; });
    renderNotifyButton();
  }

  function onStrategyInput(e) {
    const t = e.target;
    if (t.dataset.on) {
      state.strategies[t.dataset.on].on = t.checked;
    } else if (t.dataset.sid) {
      const id = t.dataset.sid;
      const d = bt.STRATEGIES[id].params.find((x) => x.key === t.dataset.param);
      const errEl = $('sg-strategies').querySelector('[data-err="' + id + '"]');
      let v = t.value;
      if (!d.options) {
        v = Number(v);
        if (!isFinite(v) || v < d.min || v > d.max) {
          errEl.textContent = d.label + ' phải trong khoảng ' + d.min + '–' + d.max + '.';
          errEl.hidden = false;
          return;
        }
      }
      const params = Object.assign({}, state.strategies[id].params, { [d.key]: v });
      const bad = bt.STRATEGIES[id].validate && bt.STRATEGIES[id].validate(params);
      errEl.textContent = bad || '';
      errEl.hidden = !bad;
      if (bad) return;
      state.strategies[id].params = params;
    } else {
      return;
    }
    savePrefs();
    load(false); // tải thêm lịch sử nếu chiến lược cần dài hơn, rồi tính lại
  }

  function enabled() {
    return Object.keys(state.strategies).filter((id) => state.strategies[id].on)
      .map((id) => ({ id: id, params: state.strategies[id].params }));
  }

  function scopeSymbols(id) {
    const valid = (s) => !!uni.info[s];
    if (id === 'featured') return cfg.heatmap.featured.filter(valid);
    if (id === 'vn30' || id === 'hnx30') {
      const g = cfg.priceboard.groups.find((x) => x.id.toLowerCase() === id);
      return g ? g.symbols.filter(valid) : [];
    }
    if (id === 'watchlist') {
      let w = null;
      try { w = (JSON.parse(localStorage.getItem('vst.priceboard.v1')) || {}).watchlist; } catch (e) { /* bỏ qua */ }
      return (Array.isArray(w) ? w : cfg.priceboard.defaultWatchlist).filter(valid);
    }
    if (id === 'all') return uni.all;
    return uni.all.filter((s) => uni.info[s].exchange === id);
  }

  // Số ngày lịch sử cần: đủ cho chỉ báo dài nhất + cửa sổ tín hiệu lớn nhất.
  function daysNeeded() {
    const look = enabled().reduce(function (m, s) {
      return Math.max(m, bt.STRATEGIES[s.id].lookback(s.params));
    }, 20);
    return Math.ceil((look + maxWindow + 10) * 1.5) + 10;
  }

  // ---------- Dữ liệu ----------

  async function load(force) {
    const token = ++state.loadToken;
    const symbols = scopeSymbols(state.scope);
    const days = daysNeeded();
    if (!enabled().length) {
      state.rows = [];
      render();
      setStatus('ok', 'Chưa chọn chiến lược');
      return;
    }
    const need = symbols.filter((s) => force || !state.bars[s] || state.days[s] < days);
    if (need.length) {
      $('sg-reload').disabled = true;
      $('sg-loading').hidden = false;
      setStatus('loading', 'Đang quét…');
      progress(0, need.length);
      try {
        const res = await source.getHistoryBatch(need, { label: 'Ngày', resolution: 'D', days: days }, function (done, total) {
          if (token === state.loadToken) progress(done, total);
        });
        if (token !== state.loadToken) return;
        need.forEach(function (s) {
          if (res[s].bars && res[s].bars.length) {
            state.bars[s] = res[s].bars;
            state.days[s] = days;
          } else if (!state.bars[s] && state.failed.indexOf(s) < 0) {
            state.failed.push(s);
          }
        });
        const ok = symbols.filter((s) => state.bars[s]).length;
        if (!ok) showNotice('Không tải được dữ liệu các mã. ' + messageOf((res[need[0]] || {}).error));
        else $('notice').hidden = true;
        state.lastScan = Date.now();
      } catch (err) {
        if (token !== state.loadToken) return;
        showNotice(messageOf(err));
      } finally {
        if (token === state.loadToken) {
          $('sg-loading').hidden = true;
          $('sg-reload').disabled = false;
        }
      }
    }
    if (token !== state.loadToken) return;
    compute();
    notifyNew();
    watchRealtime();
    setStatus('ok', 'Quét lúc ' + fmtClock(state.lastScan || Date.now()));
  }

  function progress(done, total) {
    $('sg-progress-text').textContent = 'Đang quét ' + done + '/' + total + ' mã…';
    $('sg-progress-bar').style.width = (total ? (100 * done) / total : 0) + '%';
  }

  // Trong giờ giao dịch: quét lại định kỳ để bắt tín hiệu mới của phiên hôm nay.
  function autoRefresh() {
    const vn = new Date(Date.now() + 7 * 3600000);
    const day = vn.getUTCDay(), min = vn.getUTCHours() * 60 + vn.getUTCMinutes();
    const trading = day >= 1 && day <= 5 && min >= 9 * 60 && min <= 15 * 60 + 5;
    if (trading && !document.hidden && Date.now() - state.lastScan >= scfg.refreshMs) load(true);
  }

  function compute() {
    const strategies = enabled();
    const rows = [];
    scopeSymbols(state.scope).forEach(function (sym) {
      const bars = state.bars[sym];
      if (!bars) return;
      sg.find(bars, strategies, state.window).forEach((sig) => rows.push({ symbol: sym, sig: sig }));
    });
    state.rows = rows;
    render();
  }

  function watchRealtime() {
    const syms = [];
    state.rows.forEach((r) => { if (syms.indexOf(r.symbol) < 0) syms.push(r.symbol); });
    feed.watch(syms.slice(0, scfg.realtimeMax), onQuote, function () {});
  }

  function onQuote(q) {
    if (!(q.price > 0)) return;
    state.prices[q.symbol] = q.price;
    if (!state.dirty) {
      state.dirty = true;
      requestAnimationFrame(function () { state.dirty = false; render(); });
    }
  }

  // ---------- Thông báo trình duyệt ----------

  function canNotify() { return typeof Notification !== 'undefined'; }

  function renderNotifyButton() {
    const b = $('sg-notify');
    if (!canNotify()) { b.textContent = 'Trình duyệt không hỗ trợ thông báo'; b.disabled = true; return; }
    if (Notification.permission === 'granted') { b.textContent = 'Đã bật thông báo'; b.disabled = true; }
    else if (Notification.permission === 'denied') { b.textContent = 'Thông báo đang bị chặn'; b.disabled = true; b.title = 'Cho phép thông báo trong cài đặt trang web của trình duyệt.'; }
    else { b.textContent = 'Bật thông báo'; b.disabled = false; }
  }

  async function enableNotify() {
    if (!canNotify()) return;
    try { await Notification.requestPermission(); } catch (e) { /* trình duyệt cũ */ }
    renderNotifyButton();
  }

  // Tín hiệu mới: chưa thấy ở lần quét trước VÀ thuộc phiên mới nhất lần trước đã quét (hoặc mới hơn) — tín hiệu cũ
  // hiện ra do đổi thiết lập (thêm chiến lược, tăng số phiên) không tính là mới. Lần đầu mở trang không có tín hiệu mới.
  // Đánh dấu "Mới" và (nếu đã bật) hiện thông báo trình duyệt.
  function notifyNew() {
    let latest = 0;
    Object.keys(state.bars).forEach(function (s) {
      const b = state.bars[s];
      if (b.length) latest = Math.max(latest, b[b.length - 1].time);
    });
    const since = state.seen.latest ? Math.min(state.seen.latest, latest) : Infinity;
    const fresh = state.rows.filter((r) => r.sig.time >= since && !state.seen.keys.has(sg.key(r.symbol, r.sig)));
    fresh.forEach((r) => state.fresh.add(sg.key(r.symbol, r.sig)));
    if (fresh.length && canNotify() && Notification.permission === 'granted') {
      fresh.slice(0, 5).forEach(function (r) {
        try {
          new Notification('Cảnh báo ' + SIDE[r.sig.side].toUpperCase() + ' ' + r.symbol, {
            body: bt.STRATEGIES[r.sig.strategy].name + ' · giá ' + fmtNum(r.sig.price, 2),
            tag: sg.key(r.symbol, r.sig),
          });
        } catch (e) { /* một số trình duyệt di động chỉ cho thông báo qua service worker */ }
      });
      if (fresh.length > 5) {
        try { new Notification('Có thêm ' + (fresh.length - 5) + ' tín hiệu mới', { body: 'Mở trang Cảnh báo để xem.' }); } catch (e) { /* bỏ qua */ }
      }
    }
    state.rows.forEach((r) => state.seen.keys.add(sg.key(r.symbol, r.sig)));
    state.seen.latest = Math.max(state.seen.latest || 0, latest);
    saveSeen();
    render();
  }

  // ---------- Hiển thị ----------

  function render() {
    $('sg-window').querySelectorAll('button').forEach(function (b) {
      const on = Number(b.dataset.v) === state.window;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    $('sg-side-filter').querySelectorAll('button').forEach(function (b) {
      const on = b.dataset.v === state.side;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    renderHead();

    const rows = state.rows.filter((r) => state.side === 'all' || r.sig.side === state.side).map(function (r) {
      const ev = sg.evaluate(r.sig, state.bars[r.symbol], state.prices[r.symbol]);
      return Object.assign({ key: sg.key(r.symbol, r.sig) }, r, ev);
    });
    const val = {
      symbol: (r) => r.symbol, side: (r) => r.sig.side, strategy: (r) => bt.STRATEGIES[r.sig.strategy].name,
      time: (r) => r.sig.time, sigPrice: (r) => r.sig.price, price: (r) => r.price, pnl: (r) => r.pnl, sessions: (r) => r.sessions,
    };
    const get = val[state.sort.key] || val.time;
    const text = (COLUMNS.find((c) => c.key === state.sort.key) || {}).text;
    rows.sort(function (a, b) {
      const x = get(a), y = get(b);
      if (x == null || y == null) return (x == null ? 1 : 0) - (y == null ? 1 : 0);
      const d = text ? String(x).localeCompare(String(y), 'vi') : x - y;
      return state.sort.dir * d || b.sig.time - a.sig.time;
    });

    renderSummary(state.rows.map((r) => Object.assign({}, r, sg.evaluate(r.sig, state.bars[r.symbol], state.prices[r.symbol]))));
    if (!rows.length) {
      $('sg-list').innerHTML = '<tr><td colspan="' + (COLUMNS.length + 1) + '" class="dim">' +
        (enabled().length ? 'Không có tín hiệu nào trong ' + state.window + ' phiên gần nhất.' : 'Hãy chọn ít nhất một chiến lược.') + '</td></tr>';
      return;
    }
    const provisional = vnMinutes() < 15 * 60;
    $('sg-list').innerHTML = rows.map(function (r) {
      const buy = r.sig.side === 'buy';
      const isNew = state.fresh.has(r.key);
      const today = r.sessions === 0;
      return '<tr class="' + (isNew ? 'sg-new' : '') + '">' +
        '<td class="sym"><a href="dashboard.html?symbol=' + encodeURIComponent(r.symbol) + '" title="Xem đồ thị ' + esc(r.symbol) + '">' + esc(r.symbol) + '</a>' +
          (isNew ? ' <span class="sg-badge">Mới</span>' : '') + '</td>' +
        '<td><span class="sg-side sg-' + r.sig.side + '">' + SIDE[r.sig.side] + '</span></td>' +
        '<td class="dim">' + esc(bt.STRATEGIES[r.sig.strategy].name) + '</td>' +
        '<td>' + fmtDate(r.sig.time) + (today && provisional && isTodayBar(r.sig.time) ? ' <span class="dim" title="Tín hiệu theo giá trong phiên, chỉ chắc chắn khi đóng cửa">(tạm)</span>' : '') + '</td>' +
        '<td class="num">' + fmtNum(r.sig.price, 2) + '</td>' +
        '<td class="num ' + cls(r.change) + '">' + fmtNum(r.price, 2) + '</td>' +
        '<td class="num ' + cls(r.pnl) + '" title="Giá ' + (r.change >= 0 ? 'tăng ' : 'giảm ') + fmtPct(Math.abs(r.change)) + ' từ ngày báo' +
          (buy ? '' : '; với tín hiệu Bán, giá giảm là có lợi') + '"><b>' + fmtPct(r.pnl, true) + '</b></td>' +
        '<td class="num"><b>T+' + r.sessions + '</b></td></tr>';
    }).join('');
  }

  function renderHead() {
    $('sg-head').innerHTML = '<tr>' + COLUMNS.map(function (c) {
      const on = state.sort.key === c.key;
      const arrow = on ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : '';
      return '<th class="' + (c.text || c.key === 'time' ? '' : 'num') + '" data-sort="' + c.key + '" aria-sort="' +
        (on ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button">' + esc(c.label) + arrow + '</button></th>';
    }).join('') + '</tr>';
  }

  function renderSummary(rows) {
    const buys = rows.filter((r) => r.sig.side === 'buy');
    const sells = rows.filter((r) => r.sig.side === 'sell');
    const stat = function (list, label) {
      const v = list.filter((r) => r.pnl != null);
      if (!v.length) return '';
      const win = v.filter((r) => r.pnl > 0).length;
      const avg = v.reduce((t, r) => t + r.pnl, 0) / v.length;
      return label + ': ' + win + '/' + v.length + ' đang có lợi, TB <b class="' + cls(avg) + '">' + fmtPct(avg, true) + '</b>';
    };
    const scope = scfg.scopes.find((s) => s.id === state.scope);
    const failed = state.failed.filter((s) => scopeSymbols(state.scope).indexOf(s) >= 0).length;
    $('sg-summary').innerHTML = [
      '<b>' + rows.length + '</b> tín hiệu (' + buys.length + ' Mua, ' + sells.length + ' Bán) trong ' + state.window + ' phiên',
      esc(scope.label),
      stat(buys, 'Mua'),
      stat(sells, 'Bán'),
      failed ? failed + ' mã không tải được' : '',
    ].filter(Boolean).join(' · ');
  }

  // ---------- Tiện ích ----------

  function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'ref'; }
  function fmtNum(v, d) { return Number(v).toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  function fmtPct(v, signed) { return (signed && v > 0 ? '+' : '') + fmtNum(v * 100, 2) + '%'; }
  function fmtDate(t) {
    const d = new Date((t + 7 * 3600) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
  }
  function fmtClock(ms) {
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function vnMinutes() { const d = new Date(Date.now() + 7 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
  function isTodayBar(t) { return fmtDate(t) === fmtDate(Math.floor(Date.now() / 1000)); }

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
      localStorage.setItem(STORE_KEY, JSON.stringify({
        strategies: state.strategies, scope: state.scope, window: state.window, side: state.side, sort: state.sort,
      }));
    } catch (e) { /* bỏ qua: chế độ ẩn danh hoặc bị chặn lưu trữ */ }
  }
  // { latest: thời điểm phiên mới nhất đã quét, keys: Set khóa tín hiệu đã thấy }
  function loadSeen() {
    try {
      const v = JSON.parse(localStorage.getItem(SEEN_KEY)) || {};
      return { latest: v.latest || 0, keys: new Set(Array.isArray(v.keys) ? v.keys : []) };
    } catch (e) {
      return { latest: 0, keys: new Set() };
    }
  }
  function saveSeen() {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify({ latest: state.seen.latest, keys: Array.from(state.seen.keys).slice(-MAX_SEEN) }));
    } catch (e) { /* bỏ qua */ }
  }
});
