// Trang danh mục giả lập: tạo/sửa/xóa danh mục (bảng paper_portfolios, Supabase), tính giao dịch theo chiến lược
// bằng VST.paper (js/paper.js) trên nến ngày VNDirect, cập nhật giá vị thế realtime từ bảng giá SSI.
// Chỉ chạy sau khi xác nhận đã đăng nhập và tài khoản đang hoạt động.
VST.auth.guard().then(function (ctx) {
  const cfg = VST.config;
  const pcfg = cfg.paper;
  const bt = VST.backtest;
  const paper = VST.paper;
  const uni = VST.universe;
  const esc = VST.escapeHtml;
  const client = VST.auth.client;
  const $ = (id) => document.getElementById(id);
  const DAY = 86400;
  const STORE_KEY = 'vst.paper.v1';
  const TABLE = 'paper_portfolios';
  const COLUMNS = 'id, name, config, created_at, updated_at';
  const REASONS = { signal: 'Tín hiệu chiến lược', stop: 'Cắt lỗ', take: 'Chốt lời', open: 'Đang nắm giữ' };

  // Đổi nguồn dữ liệu tại đây (cùng lớp với trang backtest).
  const source = new VST.VndirectSource({ batchSize: cfg.batchSize });
  const feed = new VST.SsiBoardFeed();

  const state = {
    list: null,       // [{ id, name, config (đã chuẩn hóa) | null, invalid }]
    selected: null,   // id đang xem
    sims: {},         // id → kết quả paper.simulate
    computing: {},    // id → Promise
    prices: {},       // giá realtime { mã: giá }
    bars: {},         // mã → { from, at, promise }
    editing: null,    // null | 'new' | id
    dirty: false,
  };

  VST.auth.mountUserBar($('user-bar'), ctx.profile, 'paper');
  buildForm();
  bindEvents();
  loadList();
  setInterval(function () { if (!document.hidden && state.selected) refresh(state.selected, false); }, pcfg.refreshMs);

  // ---------- Cơ sở dữ liệu ----------

  function dbMessage(err) {
    const msg = String((err && err.message) || '');
    if ((err && (err.code === 'PGRST205' || err.code === '42P01')) || /paper_portfolios/.test(msg)) {
      return 'Chưa có bảng lưu danh mục giả lập trong Supabase. Quản trị viên cần chạy lại file supabase/schema.sql ' +
        'trong Supabase → SQL Editor (chạy lại nhiều lần không mất dữ liệu).';
    }
    if (/tối đa 20/.test(msg)) return 'Mỗi tài khoản tối đa ' + pcfg.maxPortfolios + ' danh mục giả lập.';
    return VST.auth.errorMessage(err);
  }

  async function loadList() {
    setStatus('loading', 'Đang tải danh mục…');
    const res = await client.from(TABLE).select(COLUMNS).order('created_at', { ascending: true });
    if (res.error) {
      state.list = [];
      renderList();
      showNotice(dbMessage(res.error));
      setStatus('error', 'Lỗi tải danh mục');
      return;
    }
    state.list = res.data.map(fromRow);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { /* bỏ qua */ }
    const first = state.list.find((p) => p.id === (saved && saved.selected)) || state.list[0];
    renderList();
    if (first) select(first.id);
    else { setStatus('ok', 'Chưa có danh mục'); openForm(null); }
    // Tính số liệu cho thẻ của các danh mục khác (lần lượt, dùng chung dữ liệu giá đã tải).
    for (const p of state.list) {
      if (p.config && !state.sims[p.id]) await compute(p).catch(function () { /* hiện lỗi khi mở danh mục */ });
      renderList();
    }
  }

  function fromRow(r) {
    let c = null, invalid = '';
    try { c = paper.normalize(r.config, { maxSymbols: pcfg.maxSymbols, now: Math.floor(Date.now() / 1000) + 400 * DAY }); }
    catch (e) { invalid = e.message; }
    return { id: r.id, name: r.name, raw: r.config, config: c, invalid: invalid };
  }

  // ---------- Dữ liệu giá & tính toán ----------

  // Nến ngày của một mã từ thời điểm `from`; dùng lại trong refreshMs nếu đã tải đủ xa.
  function barsFor(sym, from, force) {
    const now = Math.floor(Date.now() / 1000);
    const c = state.bars[sym];
    if (c && !force && c.from <= from && Date.now() - c.at < pcfg.refreshMs) return c.promise;
    const start = c && c.from < from ? c.from : from;
    const promise = source.getHistoryRange(sym, start, now);
    state.bars[sym] = { from: start, at: Date.now(), promise: promise };
    promise.catch(function () { if (state.bars[sym] && state.bars[sym].promise === promise) delete state.bars[sym]; });
    return promise;
  }

  function compute(p, force) {
    if (state.computing[p.id] && !force) return state.computing[p.id];
    const c = p.config;
    const job = (async function () {
      const startT = paper.dateToTime(c.start);
      const warm = Math.max(cfg.backtest.warmupDays, Math.ceil(paper.lookback(c) * 1.5) + 30);
      const jobs = c.symbols.map((s) => barsFor(s, startT - warm * DAY, force));
      jobs.push(barsFor(cfg.backtest.indexSymbol, startT - 10 * DAY, force));
      const res = await Promise.allSettled(jobs);
      const bars = {};
      c.symbols.forEach(function (s, i) {
        bars[s] = res[i].status === 'fulfilled' ? res[i].value : messageError(res[i].reason);
      });
      const idx = res[res.length - 1];
      state.sims[p.id] = paper.simulate(c, bars, idx.status === 'fulfilled' ? idx.value : null);
      return state.sims[p.id];
    })();
    state.computing[p.id] = job;
    job.finally(function () { if (state.computing[p.id] === job) delete state.computing[p.id]; }).catch(function () {});
    return job;
  }

  function messageError(err) {
    return new Error(err && err.name === 'DataError' ? err.message : 'Không tải được dữ liệu.');
  }

  async function refresh(id, force) {
    const p = byId(id);
    if (!p || !p.config) return;
    if (!state.sims[id] || force) $('pp-loading').hidden = false;
    setStatus('loading', 'Đang tính…');
    try {
      await compute(p, force);
      if (state.selected !== id) return;
      setStatus('ok', 'Cập nhật ' + fmtClock(Date.now()));
      renderDetail();
      renderList();
      watchPrices();
    } catch (err) {
      if (state.selected !== id) return;
      showMsg(err && (err.name === 'BacktestError' || err.name === 'DataError') ? err.message : 'Không tính được danh mục. Vui lòng thử lại.');
      setStatus('error', 'Lỗi tính toán');
    } finally {
      if (state.selected === id) $('pp-loading').hidden = true;
    }
  }

  // Giá realtime cho các mã đang nắm giữ của danh mục đang xem.
  function watchPrices() {
    const sim = state.sims[state.selected];
    const syms = sim ? sim.slices.filter((s) => s.position).map((s) => s.symbol) : [];
    feed.watch(syms, onQuote, function () {});
  }

  function onQuote(q) {
    if (!(q.price > 0)) return;
    state.prices[q.symbol] = q.price;
    if (!state.dirty) {
      state.dirty = true;
      requestAnimationFrame(function () {
        state.dirty = false;
        renderDetail(true);
        renderList();
      });
    }
  }

  // ---------- Danh sách ----------

  function byId(id) { return (state.list || []).find((p) => p.id === id); }

  function select(id) {
    state.selected = id;
    state.editing = null;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ selected: id })); } catch (e) { /* bỏ qua */ }
    $('pp-form-panel').hidden = true;
    $('pp-detail').hidden = false;
    hideMsg();
    renderList();
    renderDetail();
    const p = byId(id);
    if (p && p.config) refresh(id, false);
    if (window.innerWidth < 1000) $('pp-detail').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function renderList() {
    if (!state.list) return;
    if (!state.list.length) {
      $('pp-list').innerHTML = '<p class="dim">Chưa có danh mục nào. Nhấn "Tạo danh mục" để bắt đầu.</p>';
      return;
    }
    $('pp-list').innerHTML = state.list.map(function (p) {
      const sim = state.sims[p.id];
      const sum = sim ? paper.summarize(sim, state.prices) : null;
      const st = p.config ? bt.STRATEGIES[p.config.strategy].name : 'Cấu hình lỗi';
      const right = sum
        ? '<b>' + fmtMoneyShort(sum.nav) + '</b><span class="' + cls(sum.pnl) + '">' + fmtPct(sum.pnlPct) + '</span>'
        : '<span class="dim">' + (p.config ? '…' : '–') + '</span>';
      return '<button type="button" class="pp-card' + (p.id === state.selected ? ' active' : '') + '" data-id="' + p.id + '"' +
        (p.id === state.selected ? ' aria-current="true"' : '') + '>' +
        '<span class="pp-card-main"><b>' + esc(p.name) + '</b><span class="dim small">' + esc(st) +
          (p.config ? ' · ' + esc(p.config.symbols.join(', ')) : '') + '</span></span>' +
        '<span class="pp-card-num">' + right + '</span></button>';
    }).join('');
  }

  // ---------- Chi tiết ----------

  function renderDetail(pricesOnly) {
    const p = byId(state.selected);
    if (!p) { $('pp-detail').hidden = true; return; }
    $('pp-name').textContent = p.name;
    if (!p.config) {
      $('pp-desc').textContent = '';
      showMsg('Cấu hình danh mục không hợp lệ: ' + p.invalid + ' Nhấn "Sửa" để chỉnh lại.');
      ['pp-stats', 'pp-chart', 'pp-pending', 'pp-positions', 'pp-trades'].forEach((id) => { $(id).innerHTML = ''; });
      return;
    }
    const c = p.config;
    $('pp-desc').textContent = describe(c);
    const sim = state.sims[p.id];
    if (!sim) {
      $('pp-stats').innerHTML = '';
      $('pp-pending').innerHTML = '';
      $('pp-positions').innerHTML = '';
      $('pp-trades').innerHTML = '';
      $('pp-chart').innerHTML = '';
      return;
    }
    const sum = paper.summarize(sim, state.prices);
    renderStats(sum);
    renderPositions(sum);
    if (pricesOnly) return;
    renderMessages(sum, sim);
    renderPending(sum, sim);
    renderTrades(sum);
    drawChart($('pp-chart'), sum);
  }

  function describe(c) {
    const st = bt.STRATEGIES[c.strategy];
    const params = st.params.map(function (d) {
      const v = c.params[d.key];
      const label = d.options ? (d.options.find((o) => o[0] === v) || [v, v])[1].split(' ')[0] : fmtNum(v, 0, 2);
      return d.label + ' ' + label;
    }).join(', ');
    const extra = [];
    if (c.stopLoss) extra.push('cắt lỗ ' + fmtNum(c.stopLoss, 0, 1) + '%');
    if (c.takeProfit) extra.push('chốt lời ' + fmtNum(c.takeProfit, 0, 1) + '%');
    return st.name + ' (' + params + ')' + (extra.length ? ', ' + extra.join(', ') : '') +
      ' · ' + c.symbols.join(', ') + ' · vốn ' + fmtMoney(c.capital) + ' · từ ' + fmtDate(paper.dateToTime(c.start));
  }

  function renderStats(s) {
    const items = [
      ['Giá trị danh mục', fmtMoney(s.nav), ''],
      ['Lãi/lỗ', fmtSigned(s.pnl) + ' (' + fmtPct(s.pnlPct) + ')', cls(s.pnl)],
      ['Đã chốt', fmtSigned(s.realized), cls(s.realized)],
      ['Tạm tính (đang giữ)', fmtSigned(s.unrealized), cls(s.unrealized)],
      ['Tiền mặt', fmtMoney(s.cash), ''],
      ['Giá trị cổ phiếu', fmtMoney(s.marketValue), ''],
      ['VN-Index cùng kỳ', s.benchPct == null ? '–' : fmtPct(s.benchPct), s.benchPct == null ? '' : cls(s.benchPct)],
      ['Lệnh đã đóng', s.trades.length + (s.winRate == null ? '' : ' · thắng ' + fmtNum(s.winRate * 100, 0, 0) + '%'), ''],
    ];
    $('pp-stats').innerHTML = items.map((x) =>
      '<div class="pp-stat"><span>' + esc(x[0]) + '</span><b class="' + x[2] + '">' + esc(x[1]) + '</b></div>').join('');
  }

  function renderMessages(s, sim) {
    const parts = [];
    if (s.waiting.length) {
      parts.push('Chưa có phiên giao dịch nào kể từ ngày bắt đầu cho: ' + s.waiting.join(', ') +
        '. Danh mục sẽ bắt đầu giao dịch từ phiên tới.');
    }
    s.errors.forEach((e) => parts.push(e.symbol + ': ' + e.message));
    if (!sim.bench.length && sim.equity.length) parts.push('Không tải được VN-Index để so sánh.');
    if (parts.length) showMsg(parts.join(' ')); else hideMsg();
  }

  function renderPending(s, sim) {
    const intraday = sim.slices.some((x) => x.lastTime && isToday(x.lastTime)) && vnHour() < 15;
    if (!s.pendings.length) {
      $('pp-pending').innerHTML = '<p class="dim small">Không có lệnh chờ. ' +
        (intraday ? 'Tín hiệu được xét lại khi phiên hôm nay đóng cửa.' : 'Tín hiệu được xét theo giá đóng cửa mỗi phiên.') + '</p>';
      return;
    }
    $('pp-pending').innerHTML = '<ul class="pp-pending">' + s.pendings.map(function (x) {
      const buy = x.side === 'buy';
      const what = buy ? 'MUA' : 'BÁN';
      const note = buy ? 'dùng toàn bộ tiền mặt của mã, khớp ở giá mở cửa phiên tới'
        : x.waiting ? REASONS[x.reason] + ' — chờ cổ phiếu về tài khoản (T+2) mới bán được'
          : REASONS[x.reason] + ' — khớp ở giá mở cửa phiên tới';
      return '<li><b class="' + (buy ? 'up' : 'down') + '">' + what + ' ' + esc(x.symbol) + '</b> <span class="dim">' + esc(note) + '</span></li>';
    }).join('') + '</ul>' +
      (intraday ? '<p class="dim small">Tín hiệu đang tính theo giá trong phiên hôm nay, chỉ chắc chắn khi đóng cửa.</p>' : '');
  }

  function renderPositions(s) {
    if (!s.positions.length) {
      $('pp-positions').innerHTML = '<tbody><tr><td class="dim">Không nắm giữ cổ phiếu nào.</td></tr></tbody>';
      return;
    }
    $('pp-positions').innerHTML = '<thead><tr><th>Mã</th><th class="num">KL</th><th class="num">Giá vốn</th><th class="num">Giá hiện tại</th>' +
      '<th class="num">Giá trị</th><th class="num">Lãi/lỗ</th><th class="num">%</th><th>Ngày mua</th><th>Bán được từ</th></tr></thead><tbody>' +
      s.positions.map(function (p) {
        return '<tr><td class="sym"><a href="dashboard.html?symbol=' + encodeURIComponent(p.symbol) + '">' + esc(p.symbol) + '</a></td>' +
          '<td class="num">' + fmtNum(p.shares, 0, 0) + '</td>' +
          '<td class="num">' + fmtNum(p.entryPrice, 2, 2) + '</td>' +
          '<td class="num ' + cls(p.price - p.entryPrice) + '">' + fmtNum(p.price, 2, 2) + '</td>' +
          '<td class="num">' + fmtMoney(p.value) + '</td>' +
          '<td class="num ' + cls(p.pnl) + '">' + fmtSigned(p.pnl) + '</td>' +
          '<td class="num ' + cls(p.pnl) + '">' + fmtPct(p.pnlPct) + '</td>' +
          '<td>' + fmtDate(p.entryTime) + '</td>' +
          '<td>' + (p.sellableTime ? fmtDate(p.sellableTime) : 'Chưa đủ T+2') + '</td></tr>';
      }).join('') + '</tbody>';
  }

  function renderTrades(s) {
    if (!s.trades.length) {
      $('pp-trades').innerHTML = '<tbody><tr><td class="dim">Chưa có giao dịch nào được đóng.</td></tr></tbody>';
      return;
    }
    $('pp-trades').innerHTML = '<thead><tr><th>Mã</th><th>Ngày mua</th><th class="num">Giá mua</th><th>Ngày bán</th><th class="num">Giá bán</th>' +
      '<th class="num">KL</th><th class="num">Lãi/lỗ</th><th class="num">%</th><th>Lý do bán</th></tr></thead><tbody>' +
      s.trades.map(function (t) {
        return '<tr><td class="sym">' + esc(t.symbol) + '</td><td>' + fmtDate(t.entryTime) + '</td>' +
          '<td class="num">' + fmtNum(t.entryPrice, 2, 2) + '</td><td>' + fmtDate(t.exitTime) + '</td>' +
          '<td class="num">' + fmtNum(t.exitPrice, 2, 2) + '</td><td class="num">' + fmtNum(t.shares, 0, 0) + '</td>' +
          '<td class="num ' + cls(t.pnl) + '">' + fmtSigned(t.pnl) + '</td>' +
          '<td class="num ' + cls(t.pnl) + '">' + fmtPct(t.pnlPct) + '</td>' +
          '<td class="dim">' + esc(REASONS[t.reason] || '') + '</td></tr>';
      }).join('') + '</tbody>';
  }

  // Biểu đồ đường SVG: giá trị danh mục và VN-Index quy về cùng số vốn.
  function drawChart(el, s) {
    const nav = s.equity.slice();
    if (nav.length && s.positions.length) {
      // Điểm cuối theo giá realtime.
      nav[nav.length - 1] = { time: nav[nav.length - 1].time, value: s.nav };
    }
    if (nav.length < 2) {
      el.innerHTML = '<p class="dim center pp-chart-empty">Biểu đồ hiện khi danh mục có từ 2 phiên giao dịch trở lên.</p>';
      return;
    }
    const W = Math.max(280, el.clientWidth), H = Math.max(160, el.clientHeight);
    const padL = 58, padR = 8, padT = 8, padB = 22;
    const series = [{ pts: s.bench, cls: 'pp-bench' }, { pts: nav, cls: 'pp-nav' }].filter((x) => x.pts.length > 1);
    let lo = Infinity, hi = -Infinity;
    series.forEach((x) => x.pts.forEach((p) => { lo = Math.min(lo, p.value); hi = Math.max(hi, p.value); }));
    lo = Math.min(lo, s.capital); hi = Math.max(hi, s.capital);
    const span = hi - lo || hi * 0.01 || 1;
    lo -= span * 0.06; hi += span * 0.06;
    const t0 = nav[0].time, t1 = nav[nav.length - 1].time;
    const X = (t) => padL + ((t - t0) / (t1 - t0 || 1)) * (W - padL - padR);
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const path = (pts) => pts.map((p, i) => (i ? 'L' : 'M') + X(p.time).toFixed(1) + ' ' + Y(p.value).toFixed(1)).join('');
    let svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Giá trị danh mục theo thời gian">';
    for (let k = 0; k <= 3; k++) {
      const v = lo + ((hi - lo) * k) / 3;
      svg += '<line class="pp-grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/>' +
        '<text class="pp-axis" x="' + (padL - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + esc(fmtMoneyShort(v)) + '</text>';
    }
    svg += '<line class="pp-base" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + Y(s.capital) + '" y2="' + Y(s.capital) + '"/>';
    series.forEach((x) => { svg += '<path class="' + x.cls + '" d="' + path(x.pts) + '"/>'; });
    svg += '<text class="pp-axis" x="' + padL + '" y="' + (H - 6) + '">' + fmtDate(t0) + '</text>' +
      '<text class="pp-axis" x="' + (W - padR) + '" y="' + (H - 6) + '" text-anchor="end">' + fmtDate(t1) + '</text></svg>';
    el.innerHTML = svg;
  }

  // ---------- Form tạo / sửa ----------

  function buildForm() {
    $('pp-f-strategy').innerHTML = Object.keys(bt.STRATEGIES).map((id) =>
      '<option value="' + id + '">' + esc(bt.STRATEGIES[id].name) + '</option>').join('');
    $('pp-f-strategy').addEventListener('change', function () { renderParams(this.value, null); });
    $('pp-f-capital').addEventListener('input', capitalHint);
  }

  function renderParams(id, values) {
    const st = bt.STRATEGIES[id];
    $('pp-f-strategy-desc').textContent = st.desc;
    const v = Object.assign(bt.defaultParams(id), values || {});
    $('pp-f-params').innerHTML = st.params.map(function (d) {
      const ctrl = d.options
        ? '<select class="input" data-param="' + d.key + '">' + d.options.map((o) =>
          '<option value="' + esc(o[0]) + '"' + (o[0] === v[d.key] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>'
        : '<input class="input" type="number" inputmode="decimal" data-param="' + d.key + '" min="' + d.min + '" max="' + d.max +
          '" step="' + d.step + '" value="' + esc(v[d.key]) + '">';
      return '<label class="form-field"><span>' + esc(d.label) + '</span>' + ctrl + '</label>';
    }).join('');
  }

  function openForm(id) {
    const p = id != null ? byId(id) : null;
    state.editing = p ? p.id : 'new';
    const raw = p ? (p.config || p.raw || {}) : {};
    const strategy = bt.STRATEGIES[raw.strategy] ? raw.strategy : Object.keys(bt.STRATEGIES)[0];
    $('pp-form-title').textContent = p ? 'Sửa danh mục' : 'Tạo danh mục giả lập';
    $('pp-f-name').value = p ? p.name : '';
    $('pp-f-strategy').value = strategy;
    renderParams(strategy, raw.params);
    $('pp-f-symbols').value = Array.isArray(raw.symbols) ? raw.symbols.join(', ') : '';
    $('pp-f-capital').value = raw.capital || pcfg.defaultCapital;
    const today = paper.timeToDate(Math.floor(Date.now() / 1000));
    $('pp-f-start').value = raw.start || today;
    $('pp-f-start').max = today;
    $('pp-f-sl').value = raw.stopLoss ? raw.stopLoss : '';
    $('pp-f-tp').value = raw.takeProfit ? raw.takeProfit : '';
    $('pp-form-error').hidden = true;
    capitalHint();
    $('pp-detail').hidden = true;
    $('pp-form-panel').hidden = false;
    $('pp-cancel').hidden = !state.list || !state.list.length;
    $('pp-form-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
    $('pp-f-name').focus({ preventScroll: true });
  }

  function closeForm() {
    state.editing = null;
    $('pp-form-panel').hidden = true;
    if (state.selected && byId(state.selected)) { $('pp-detail').hidden = false; renderDetail(); }
  }

  function capitalHint() {
    const v = Number($('pp-f-capital').value);
    $('pp-f-capital-hint').textContent = v > 0 ? '= ' + fmtMoney(v) : '';
  }

  async function save(e) {
    e.preventDefault();
    const name = $('pp-f-name').value.trim();
    const params = {};
    $('pp-f-params').querySelectorAll('[data-param]').forEach(function (el) { params[el.dataset.param] = el.value; });
    let config;
    try {
      if (!name) throw new paper.PaperError('Nhập tên danh mục.');
      config = paper.normalize({
        strategy: $('pp-f-strategy').value,
        params: params,
        symbols: $('pp-f-symbols').value,
        capital: $('pp-f-capital').value,
        start: $('pp-f-start').value,
        stopLoss: $('pp-f-sl').value,
        takeProfit: $('pp-f-tp').value,
      }, { maxSymbols: pcfg.maxSymbols, isSymbol: (s) => !!uni.info[s] });
    } catch (err) {
      formError(err.name === 'PaperError' ? err.message : 'Dữ liệu chưa hợp lệ.');
      return;
    }
    $('pp-save').disabled = true;
    try {
      const editing = state.editing;
      const q = editing === 'new'
        ? client.from(TABLE).insert({ name: name, config: config })
        : client.from(TABLE).update({ name: name, config: config }).eq('id', editing);
      const res = await q.select(COLUMNS).single();
      if (res.error) { formError(dbMessage(res.error)); return; }
      const p = fromRow(res.data);
      if (editing === 'new') state.list.push(p);
      else state.list = state.list.map((x) => (x.id === p.id ? p : x));
      delete state.sims[p.id];
      select(p.id);
    } finally {
      $('pp-save').disabled = false;
    }
  }

  async function remove() {
    const p = byId(state.selected);
    if (!p || !window.confirm('Xóa danh mục "' + p.name + '"? Không thể hoàn tác.')) return;
    const res = await client.from(TABLE).delete().eq('id', p.id);
    if (res.error) { showNotice(dbMessage(res.error)); return; }
    state.list = state.list.filter((x) => x.id !== p.id);
    delete state.sims[p.id];
    state.selected = null;
    feed.watch([], null, null);
    if (state.list.length) select(state.list[0].id);
    else { renderList(); $('pp-detail').hidden = true; openForm(null); }
  }

  function formError(msg) {
    $('pp-form-error').textContent = msg;
    $('pp-form-error').hidden = false;
  }

  function bindEvents() {
    $('pp-new').addEventListener('click', function () { openForm(null); });
    $('pp-list').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-id]');
      if (b) select(Number(b.dataset.id));
    });
    $('pp-edit').addEventListener('click', function () { openForm(state.selected); });
    $('pp-delete').addEventListener('click', remove);
    $('pp-reload').addEventListener('click', function () { if (state.selected) refresh(state.selected, true); });
    $('pp-form').addEventListener('submit', save);
    $('pp-cancel').addEventListener('click', closeForm);
    $('notice-close').addEventListener('click', function () { $('notice').hidden = true; });
    let timer = null;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { if (!$('pp-detail').hidden) renderDetail(); }, 150);
    });
  }

  // ---------- Tiện ích ----------

  function cls(v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'ref'; }
  function fmtNum(v, min, max) { return Number(v).toLocaleString('vi-VN', { minimumFractionDigits: min, maximumFractionDigits: max }); }
  function fmtMoney(v) { return Math.round(v).toLocaleString('vi-VN') + ' đ'; }
  function fmtSigned(v) { return (v > 0 ? '+' : '') + fmtMoney(v); }
  function fmtPct(v) { return (v > 0 ? '+' : '') + fmtNum(v * 100, 2, 2) + '%'; }
  function fmtMoneyShort(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return fmtNum(v / 1e9, 0, 2) + ' tỷ';
    if (a >= 1e6) return fmtNum(v / 1e6, 0, 1) + ' tr';
    return fmtNum(v, 0, 0);
  }
  function fmtDate(t) { return paper.timeToDate(t).split('-').reverse().join('/'); }
  function fmtClock(ms) {
    const d = new Date(ms);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function isToday(t) { return paper.timeToDate(t) === paper.timeToDate(Math.floor(Date.now() / 1000)); }
  function vnHour() { return new Date(Date.now() + 7 * 3600000).getUTCHours(); }

  function setStatus(kind, text) {
    $('status-dot').className = 'dot ' + kind;
    $('status-text').textContent = text;
  }
  function showNotice(msg) { $('notice-text').textContent = msg; $('notice').hidden = false; }
  function showMsg(msg) { $('pp-msg').textContent = msg; $('pp-msg').hidden = false; }
  function hideMsg() { $('pp-msg').hidden = true; }
});
