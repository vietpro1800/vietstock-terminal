// Trang "Khấn mã" (temple.html): điện thờ vui cho một mã — bảng giá rổ VN30 + mã đang khấn (giá khớp realtime),
// gõ mõ tích công đức (localStorage), thắp nhang và lời khấn chung (bảng temple_prayers, Supabase realtime),
// đếm đạo hữu đang trong điện (Supabase presence), xin quẻ trong ngày. Chỉ để vui, không phải khuyến nghị đầu tư.
// Chỉ chạy sau khi xác nhận đã đăng nhập và tài khoản đang hoạt động.
VST.auth.guard().then(function (ctx) {
  const cfg = VST.config.temple;
  const tp = VST.temple;
  const uni = VST.universe;
  const esc = VST.escapeHtml;
  const client = VST.auth.client;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'vst.temple.v1';
  const LOCAL_KEY = 'vst.temple.local.v1'; // lời khấn khi chưa bật bảng temple_prayers (chỉ máy này)
  const MAX_STICKS = 9;
  const group = (VST.config.priceboard.groups.find((g) => g.id === cfg.boardGroup) || { symbols: [] });

  // Đổi nguồn dữ liệu tại đây (cùng lớp với các trang khác).
  const source = new VST.VndirectSource({ batchSize: cfg.batchSize });
  const feed = new VST.SsiBoardFeed();
  const TF = { label: 'Ngày', resolution: 'D', days: cfg.days };

  const prefs = loadPrefs();
  const me = ctx.user || (ctx.session && ctx.session.user) || { id: ctx.profile.id };
  const dharma = tp.dharmaName(me.id || ctx.profile.id);
  const state = {
    symbol: '',
    quotes: {},        // { [mã]: { price, ref, ex, rt } }
    indices: [],       // [{ name, price, ref }]
    rows: [],          // lời khấn / nén nhang của mã đang xem (mới nhất cuối)
    offline: false,    // chưa có bảng temple_prayers → lưu tạm trên máy
    channel: null,
    channelState: '',
    online: 1,
    token: 0,
    rtStatus: '',
    tiles: {},
    dirty: new Set(),
    omenKey: '',
    sending: false,
  };
  const audio = { ctx: null, music: null };

  $('tp-dharma').textContent = dharma;
  VST.auth.mountUserBar($('user-bar'), ctx.profile, 'temple');
  bindUi();
  renderMonks();
  renderMerit();
  renderToggles();

  const urlSym = (new URLSearchParams(location.search).get('symbol') || '').trim().toUpperCase();
  enter(validSymbol(urlSym) || validSymbol(prefs.symbol) || VST.config.defaultSymbol, !!urlSym && !validSymbol(urlSym));

  setInterval(tick, cfg.refreshMs);
  setInterval(function () { renderIncense(); renderSession(); }, 30000);
  renderSession();

  // ---------- Giao diện ----------

  function bindUi() {
    $('notice-close').addEventListener('click', function () { $('notice').hidden = true; });
    $('tp-mo').addEventListener('click', knock);
    $('tp-sound').addEventListener('click', function () {
      prefs.sound = !soundOn();
      savePrefs();
      renderToggles();
    });
    $('tp-music').addEventListener('click', function () {
      prefs.music = !prefs.music;
      savePrefs();
      renderToggles();
      syncMusic();
    });
    $('tp-chart').addEventListener('click', function () {
      VST.nav.open('dashboard.html?symbol=' + encodeURIComponent(state.symbol));
    });
    $('tp-fortune').addEventListener('click', showFortune);
    $('tp-dialog-close').addEventListener('click', closeDialog);
    $('tp-dialog').addEventListener('click', function (e) { if (e.target === this) closeDialog(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('tp-dialog').hidden) closeDialog(); });

    $('tp-switch').addEventListener('click', function () {
      const f = $('tp-pick');
      f.hidden = !f.hidden;
      this.setAttribute('aria-expanded', String(!f.hidden));
      if (!f.hidden) { $('tp-pick-input').value = ''; $('tp-pick-input').focus(); }
    });
    $('tp-pick-list').innerHTML = group.symbols.concat(VST.config.boardSymbols)
      .filter((s, i, a) => a.indexOf(s) === i).map((s) => '<option value="' + s + '">').join('');
    $('tp-pick').addEventListener('submit', function (e) {
      e.preventDefault();
      const sym = $('tp-pick-input').value.trim().toUpperCase();
      if (!validSymbol(sym)) { showNotice('Không tìm thấy mã "' + sym + '" trên HOSE/HNX/UPCoM.'); return; }
      this.hidden = true;
      $('tp-switch').setAttribute('aria-expanded', 'false');
      enter(sym, false);
    });
    $('tp-grid').addEventListener('click', function (e) {
      const t = e.target.closest('.tp-tile[data-sym]');
      if (t && t.dataset.sym !== state.symbol) enter(t.dataset.sym, false);
    });

    $('tp-presets').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-text]');
      if (b) pray(b.dataset.text);
    });
    $('tp-form').addEventListener('submit', function (e) {
      e.preventDefault();
      pray($('tp-input').value);
    });
    $('tp-light').addEventListener('click', lightIncense);
    $('tp-list').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-del]');
      if (b) removeRow(b.dataset.del);
    });

    document.addEventListener('visibilitychange', syncMusic);
  }

  function validSymbol(s) { return s && uni.info[s] ? s : ''; }

  // Vào điện của một mã: tải giá, lời khấn, theo dõi realtime.
  function enter(sym, badUrl) {
    if (badUrl) showNotice('Không tìm thấy mã trong địa chỉ, đã mở điện ' + sym + '.');
    state.symbol = sym;
    state.omenKey = '';
    prefs.symbol = sym;
    savePrefs();
    const info = uni.info[sym];
    $('tp-sym').textContent = sym;
    $('tp-plaque').textContent = sym;
    document.title = 'Khấn ' + sym + ' · ThảoChi Stock';
    $('tp-input').placeholder = 'Lời khấn cho ' + sym + '…';
    $('tp-presets').innerHTML = tp.presets(sym).map((t) =>
      '<button type="button" class="tp-chip" data-text="' + esc(t) + '">' + esc(t) + '</button>').join('');
    $('tp-chart').title = 'Xem đồ thị kỹ thuật ' + sym + (info ? ' (' + info.exchange.toUpperCase() + ')' : '');
    renderBoard();
    loadPrices();
    openChannel();
  }

  // ---------- Giá ----------

  function boardSymbols() {
    const list = group.symbols.filter((s) => s !== state.symbol);
    return [state.symbol].concat(list);
  }

  async function loadPrices() {
    const token = ++state.token;
    setStatus('loading', 'Đang tải bảng giá…');
    const syms = boardSymbols();
    const need = syms.filter((s) => !state.quotes[s]);
    try {
      const [res, ix] = await Promise.all([
        need.length ? source.getHistoryBatch(need, TF) : Promise.resolve({}),
        loadIndices(),
      ]);
      if (token !== state.token) return;
      let firstError = null;
      need.forEach(function (sym) {
        const r = res[sym] || {};
        const q = r.bars ? tp.fromBars(r.bars) : null;
        if (q) state.quotes[sym] = { price: q.price, ref: q.ref, ex: exchangeOf(sym), rt: false };
        else if (r.error && !firstError) firstError = r.error;
      });
      state.indices = ix;
      if (!state.quotes[state.symbol]) showNotice('Không tải được giá ' + state.symbol + '. ' + messageOf(firstError));
      renderBoard();
      feed.watch(syms, onQuote, onFeedStatus);
      if (state.rtStatus !== 'open') setStatus('ok', 'Giá đóng cửa gần nhất');
    } catch (err) {
      if (token !== state.token) return;
      showNotice(messageOf(err));
      setStatus('error', 'Lỗi tải dữ liệu');
    }
  }

  async function loadIndices() {
    const res = await Promise.all(cfg.indices.map(function (ix) {
      return source.getHistory(ix.symbol, TF).then((bars) => tp.fromBars(bars), () => null);
    }));
    return cfg.indices.map((ix, i) => ({ name: ix.name, q: res[i] }));
  }

  // Trong giờ giao dịch: làm mới chỉ số (giá khớp từng mã là realtime).
  async function tick() {
    if (!pageVisible() || tp.session(Date.now()).id !== 'open') return;
    const ix = await loadIndices();
    if (ix.some((x) => x.q)) { state.indices = ix; renderIndices(); }
  }

  function onQuote(q) {
    const cur = state.quotes[q.symbol];
    if (!(q.price > 0)) return;
    state.quotes[q.symbol] = { price: q.price, ref: q.price - q.change, ex: (cur && cur.ex) || exchangeOf(q.symbol), rt: true };
    if (!state.dirty.size) requestAnimationFrame(flush);
    state.dirty.add(q.symbol);
  }

  function flush() {
    state.dirty.forEach(function (sym) {
      const el = state.tiles[sym];
      if (!el) return;
      paintTile(el, sym);
      el.classList.remove('tp-flash'); void el.offsetWidth; el.classList.add('tp-flash');
    });
    state.dirty.clear();
    renderFoot();
    renderTarget();
  }

  function onFeedStatus(s) {
    state.rtStatus = s;
    if (s === 'open') setStatus('ok', 'Giá khớp realtime');
    else if (s === 'connecting') setStatus('loading', 'Đang kết nối realtime…');
    else setStatus('error', 'Mất kết nối realtime, đang thử lại…');
  }

  function exchangeOf(sym) { return uni.info[sym] ? uni.info[sym].exchange : 'hose'; }

  function stateOf(sym) {
    const q = state.quotes[sym];
    return q ? tp.quoteState(q.price, q.ref, q.ex) : null;
  }

  // ---------- Bảng giá trong điện ----------

  function renderBoard() {
    renderIndices();
    const syms = boardSymbols();
    const info = uni.info[state.symbol];
    $('tp-grid').innerHTML = syms.map(function (sym, i) {
      if (i === 0) {
        return '<div class="tp-tile tp-star" data-sym="' + sym + '">' +
          '<b class="tp-t-sym">★ ' + sym + ' ★</b>' +
          '<span class="tp-t-sub">' + esc(info ? info.industry : '') + '</span>' +
          '<span class="tp-t-price"></span><span class="tp-t-chg"></span></div>';
      }
      return '<button type="button" class="tp-tile" data-sym="' + sym + '" title="Vào điện ' + sym + '">' +
        '<b class="tp-t-sym">' + sym + '</b><span class="tp-t-price"></span><span class="tp-t-chg"></span></button>';
    }).join('');
    state.tiles = {};
    $('tp-grid').querySelectorAll('.tp-tile').forEach(function (el) {
      state.tiles[el.dataset.sym] = el;
      paintTile(el, el.dataset.sym);
    });
    renderFoot();
    renderTarget();
  }

  function paintTile(el, sym) {
    const s = stateOf(sym);
    const star = el.classList.contains('tp-star');
    el.className = 'tp-tile' + (star ? ' tp-star' : '') + (s ? ' c-' + s.cls : '');
    el.querySelector('.tp-t-price').textContent = s ? fmt2(s.price) : '—';
    el.querySelector('.tp-t-chg').textContent = s ? arrow(s.chg) + ' ' + (star ? sign(s.chg) + fmt2(s.chg) + ' (' : '') +
      sign(s.chg) + fmt2(s.pct) + '%' + (star ? ')' : '') : '';
  }

  function renderIndices() {
    $('tp-ix').innerHTML = state.indices.map(function (x) {
      if (!x.q) return '<div class="tp-ix-item"><b>' + esc(x.name) + '</b><span class="dim">—</span></div>';
      const chg = x.q.price - x.q.ref;
      const cls = chg > 0.005 ? 'up' : chg < -0.005 ? 'down' : 'ref';
      return '<div class="tp-ix-item"><b>' + esc(x.name) + '</b>' +
        '<span class="tp-ix-v ' + cls + '">' + fmt2(x.q.price) + '</span>' +
        '<span class="tp-ix-c ' + cls + '">' + arrow(chg) + ' ' + sign(chg) + fmt2(chg) + ' (' + sign(chg) +
        fmt2(x.q.ref ? (chg / x.q.ref) * 100 : 0) + '%)</span></div>';
    }).join('');
  }

  function renderFoot() {
    const now = new Date(Date.now() + 7 * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    const t = p(now.getUTCHours()) + ':' + p(now.getUTCMinutes()) + ':' + p(now.getUTCSeconds());
    $('tp-board-foot').textContent = '🙏 ' + state.rows.filter((r) => r.kind === 'pray').length + ' lời khấn · 🪔 ' +
      tp.burning(state.rows, Date.now(), cfg.incenseMinutes) + ' nén nhang · ' + group.name + ' · cập nhật ' + t +
      ' · Nguồn: ' + (state.rtStatus === 'open' ? 'SSI realtime' : 'VNDirect');
  }

  // Bảng "mục tiêu" trên bàn thờ: trần/sàn và còn bao nhiêu % tới trần; trần → linh nghiệm.
  function renderTarget() {
    const s = stateOf(state.symbol);
    const sym = state.symbol;
    if (!s) { $('tp-target').textContent = ''; $('tp-omen').hidden = true; return; }
    $('tp-target').textContent = s.cls === 'ceil' ? 'Đã tím trần ' + fmt2(s.ceil) + ' 🟣'
      : 'Trần ' + fmt2(s.ceil) + ' · còn +' + fmt2(s.toCeil) + '%';
    const omen = $('tp-omen');
    if (s.cls === 'ceil' || s.cls === 'floor') {
      omen.className = 'tp-omen ' + s.cls;
      omen.textContent = s.cls === 'ceil' ? '🙏 Linh nghiệm! ' + sym + ' đã tím trần ' + fmt2(s.ceil)
        : 'Nam mô… ' + sym + ' nằm sàn ' + fmt2(s.floor) + '. Bình tâm, giữ đạo.';
      omen.hidden = false;
      const key = sym + '|' + s.cls + '|' + tp.dayKey(Date.now());
      if (s.cls === 'ceil' && state.omenKey !== key) { state.omenKey = key; petals(); bell(); }
    } else {
      omen.hidden = true;
    }
  }

  // ---------- Nhà sư trang trí ----------

  function renderMonks() {
    const names = tp.monkNames(10, dharma);
    names.splice(4, 0, dharma); // người xem ngồi hàng đầu, giữa
    $('tp-monks').innerHTML = names.map(function (n, i) {
      const mine = n === dharma;
      return '<div class="tp-monk' + (mine ? ' me' : '') + '" style="--i:' + i + '">' +
        '<span class="tp-monk-name">' + esc(n) + (mine ? ' (bạn)' : '') + '</span>' +
        '<i class="tp-monk-head"></i><i class="tp-monk-robe"></i></div>';
    }).join('');
  }

  // ---------- Gõ mõ ----------

  function knock() {
    prefs.merit = (prefs.merit || 0) + 1;
    savePrefs();
    renderMerit();
    const mo = $('tp-mo');
    mo.classList.remove('hit'); void mo.offsetWidth; mo.classList.add('hit');
    floatText('+1 công đức', mo, 'tp-float-merit');
    woodblock();
  }

  function renderMerit() {
    $('tp-merit').textContent = fmtInt(prefs.merit || 0) + ' công đức';
  }

  function renderSession() {
    const s = tp.session(Date.now());
    $('tp-session').textContent = (s.id === 'open' ? '🟢 ' : '⏸ ') + s.label;
    $('tp-session').className = 'tp-session ' + s.id;
  }

  // ---------- Lời khấn & nhang (Supabase) ----------

  function openChannel() {
    const sym = state.symbol;
    const token = state.token;
    state.rows = [];
    renderRows();
    if (state.channel) { try { client.removeChannel(state.channel); } catch (e) { /* bỏ qua */ } state.channel = null; }
    state.online = 1;
    renderOnline();
    if (!client) { goOffline(sym); return; }

    const since = new Date(Date.now() - cfg.prayerHours * 3600000).toISOString();
    client.from('temple_prayers')
      .select('id, symbol, user_id, author_name, kind, body, created_at')
      .eq('symbol', sym).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(cfg.prayerLimit)
      .then(function (res) {
        if (token !== state.token || sym !== state.symbol) return;
        if (res.error) {
          if (missingTable(res.error)) goOffline(sym);
          else showNotice(messageOf(res.error));
          return;
        }
        state.offline = false;
        state.rows = res.data.reverse();
        renderRows();
      }, function () { if (sym === state.symbol) goOffline(sym); });

    try {
      const ch = client.channel('temple-' + sym, { config: { presence: { key: me.id || dharma } } });
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'temple_prayers', filter: 'symbol=eq.' + sym },
        function (p) { if (sym === state.symbol) addRow(p.new, true); })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'temple_prayers' },
          function (p) { if (sym === state.symbol && p.old) dropRow(p.old.id); })
        .on('presence', { event: 'sync' }, function () {
          state.online = Math.max(1, Object.keys(ch.presenceState()).length);
          renderOnline();
        })
        .subscribe(function (status) {
          state.channelState = status;
          if (status === 'SUBSCRIBED') ch.track({ name: dharma, at: Date.now() });
          renderOnline();
        });
      state.channel = ch;
    } catch (e) { /* không có realtime: vẫn khấn được, chỉ không thấy người khác ngay */ }
  }

  function goOffline(sym) {
    state.offline = true;
    const all = loadLocal();
    const from = Date.now() - cfg.prayerHours * 3600000;
    state.rows = (all[sym] || []).filter((r) => Date.parse(r.created_at) >= from);
    renderRows();
    renderOnline();
  }

  function renderOnline() {
    $('tp-online').textContent = 'Kênh 1 · ' + state.online + ' đạo hữu';
    const b = $('tp-mode');
    if (state.offline) { b.textContent = 'demo offline (chỉ lưu trên máy này)'; b.hidden = false; }
    else if (state.channelState && state.channelState !== 'SUBSCRIBED') { b.textContent = 'mất kết nối'; b.hidden = false; }
    else b.hidden = true;
  }

  async function pray(text) {
    const body = tp.cleanPrayer(text, cfg.maxLen);
    if (!body) { $('tp-input').focus(); return; }
    const ok = await send('pray', body);
    if (!ok) return;
    $('tp-input').value = '';
    floatText(body, $('tp-pray'), 'tp-float-pray');
    bell();
  }

  async function lightIncense() {
    const ok = await send('incense', '');
    if (!ok) return;
    floatText('🪔 +1 nén nhang', $('tp-light'), 'tp-float-pray');
    bell();
  }

  async function send(kind, body) {
    if (state.sending) return false;
    const sym = state.symbol;
    if (state.offline || !client) {
      const row = { id: 'l' + Date.now(), symbol: sym, user_id: me.id, author_name: dharma, kind: kind, body: body,
        created_at: new Date().toISOString() };
      const all = loadLocal();
      all[sym] = (all[sym] || []).concat(row).slice(-cfg.prayerLimit);
      saveLocal(all);
      addRow(row, false);
      return true;
    }
    state.sending = true;
    $('tp-pray').disabled = $('tp-light').disabled = true;
    let res;
    try {
      res = await client.from('temple_prayers').insert({ symbol: sym, kind: kind, body: body })
        .select('id, symbol, user_id, author_name, kind, body, created_at').single();
    } catch (err) {
      res = { error: err };
    }
    state.sending = false;
    $('tp-pray').disabled = $('tp-light').disabled = false;
    if (res.error) {
      if (missingTable(res.error)) { goOffline(sym); return send(kind, body); }
      showNotice(messageOf(res.error));
      return false;
    }
    addRow(res.data, false);
    return true;
  }

  async function removeRow(id) {
    if (!window.confirm('Xóa lời khấn này?')) return;
    if (state.offline) {
      const all = loadLocal();
      all[state.symbol] = (all[state.symbol] || []).filter((r) => String(r.id) !== id);
      saveLocal(all);
      dropRow(id);
      return;
    }
    let res;
    try { res = await client.from('temple_prayers').delete().eq('id', Number(id)); } catch (err) { res = { error: err }; }
    if (res.error) { showNotice(messageOf(res.error)); return; }
    dropRow(id);
  }

  function addRow(row, fromOthers) {
    if (!row || row.symbol !== state.symbol || state.rows.some((r) => String(r.id) === String(row.id))) return;
    state.rows.push(row);
    if (state.rows.length > cfg.prayerLimit * 2) state.rows.shift();
    renderRows();
    if (fromOthers && row.user_id !== me.id) {
      floatText(row.kind === 'incense' ? '🪔 ' + (row.author_name || 'Đạo hữu') + ' thắp nhang'
        : '🙏 ' + row.body, $('tp-board'), 'tp-float-pray');
    }
  }

  function dropRow(id) {
    const n = state.rows.length;
    state.rows = state.rows.filter((r) => String(r.id) !== String(id));
    if (state.rows.length !== n) renderRows();
  }

  function renderRows() {
    const prayers = state.rows.filter((r) => r.kind === 'pray');
    $('tp-count').textContent = prayers.length + ' lời khấn';
    $('tp-log-n').textContent = state.rows.length;
    const admin = ctx.profile.role === 'admin';
    $('tp-list').innerHTML = state.rows.length ? state.rows.slice().reverse().map(function (r) {
      const mine = r.user_id === me.id;
      const del = mine || admin ? '<button type="button" class="tp-del" data-del="' + esc(String(r.id)) + '" aria-label="Xóa" title="Xóa">×</button>' : '';
      const who = mine ? 'Bạn' : esc(r.author_name || 'Đạo hữu');
      return '<li class="tp-row' + (mine ? ' mine' : '') + '"><span class="tp-row-meta"><b>' + who + '</b> · ' +
        fmtTime(r.created_at) + del + '</span><span class="tp-row-body">' +
        (r.kind === 'incense' ? '🪔 Thắp một nén nhang' + (r.body ? ': ' + esc(r.body) : '') : '🙏 ' + esc(r.body)) +
        '</span></li>';
    }).join('') : '<li class="dim">Chưa có lời khấn nào cho ' + esc(state.symbol) + '. Hãy là người đầu tiên!</li>';
    renderIncense();
    renderFoot();
  }

  // Nén nhang trong bát hương = lượt thắp trong N phút gần nhất (nhang tàn dần theo thời gian).
  function renderIncense() {
    const now = Date.now();
    const lit = state.rows.filter(function (r) {
      const t = Date.parse(r.created_at);
      return r.kind === 'incense' && t >= now - cfg.incenseMinutes * 60000;
    });
    const n = lit.length;
    $('tp-incense').textContent = n ? n + ' nén nhang đang cháy' : 'Chưa có nén nhang nào';
    $('tp-sticks').innerHTML = lit.slice(-MAX_STICKS).map(function (r, i, a) {
      const left = 1 - (now - Date.parse(r.created_at)) / (cfg.incenseMinutes * 60000); // phần nhang còn lại
      const x = a.length === 1 ? 0 : (i / (a.length - 1) - 0.5) * 2;
      return '<i style="--x:' + x.toFixed(2) + ';--h:' + Math.max(0.25, Math.min(1, left)).toFixed(2) + '"></i>';
    }).join('');
    $('tp-smoke').classList.toggle('on', n > 0);
  }

  // ---------- Xin quẻ ----------

  function showFortune() {
    const f = tp.fortune(me.id || dharma, state.symbol, tp.dayKey(Date.now()));
    $('tp-dialog-title').textContent = 'Quẻ ' + state.symbol + ' hôm nay';
    $('tp-dialog-body').innerHTML =
      '<p class="tp-fortune-rank ' + f.rank + '">Quẻ ' + esc(f.title) + '</p>' +
      '<p class="tp-fortune-text">' + esc(f.text) + '</p>' +
      '<p class="tp-note">Mỗi ngày một quẻ cho mỗi mã. Quẻ chỉ để vui, không phải khuyến nghị đầu tư.</p>';
    $('tp-dialog').hidden = false;
    $('tp-dialog-close').focus();
    bell();
  }

  function closeDialog() { $('tp-dialog').hidden = true; $('tp-fortune').focus(); }

  // ---------- Hiệu ứng ----------

  // Chữ bay lên từ một phần tử (công đức, lời khấn).
  function floatText(text, from, cls) {
    const fx = $('tp-fx');
    const box = fx.getBoundingClientRect();
    const r = from.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = 'tp-float ' + (cls || '');
    el.textContent = text;
    const x = Math.max(8, Math.min(box.width - 8, r.left - box.left + r.width / 2));
    const y = Math.min(box.height - 10, Math.max(20, r.top - box.top));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    fx.appendChild(el);
    setTimeout(function () { el.remove(); }, 1900);
  }

  // Cánh sen rơi khi mã tím trần.
  function petals() {
    if (reducedMotion()) return;
    const fx = $('tp-fx');
    for (let i = 0; i < 24; i++) {
      const el = document.createElement('span');
      el.className = 'tp-petal';
      el.textContent = i % 3 ? '🌸' : '🪷';
      el.style.left = (Math.random() * 100).toFixed(1) + '%';
      el.style.animationDelay = (Math.random() * 1.2).toFixed(2) + 's';
      el.style.animationDuration = (2.6 + Math.random() * 1.6).toFixed(2) + 's';
      fx.appendChild(el);
      setTimeout(function () { el.remove(); }, 5000);
    }
  }

  // ---------- Âm thanh (Web Audio, tự tổng hợp — không tải file) ----------

  function soundOn() { return prefs.sound !== false; }

  function ac() {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    if (!audio.ctx) audio.ctx = new C();
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return audio.ctx;
  }

  // Tiếng mõ gỗ: sóng sin tắt nhanh + chút nhiễu.
  function woodblock() {
    if (!soundOn()) return;
    const a = ac();
    if (!a) return;
    const t = a.currentTime;
    [[620, 0.5], [1240, 0.18]].forEach(function (p) {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(p[0], t);
      o.frequency.exponentialRampToValueAtTime(p[0] * 0.82, t + 0.12);
      g.gain.setValueAtTime(p[1], t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + 0.18);
    });
  }

  // Tiếng chuông: vài họa âm tắt chậm.
  function bell(vol) {
    if (!soundOn()) return;
    const a = ac();
    if (!a) return;
    const t = a.currentTime;
    const v = vol || 0.12;
    [[392, 1], [784, 0.45], [1047, 0.3], [1568, 0.15]].forEach(function (p) {
      const o = a.createOscillator(), g = a.createGain();
      o.type = 'sine';
      o.frequency.value = p[0];
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v * p[1], t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + 3.3);
    });
  }

  // Nhạc thiền: nốt trầm ngân + chuông nhỏ định kỳ. Dừng khi trang không hiển thị.
  function syncMusic() {
    const want = prefs.music && soundOn() && pageVisible();
    if (want && !audio.music) {
      const a = ac();
      if (!a) return;
      const g = a.createGain();
      g.gain.setValueAtTime(0.0001, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.035, a.currentTime + 2);
      g.connect(a.destination);
      const oscs = [110, 164.8, 220.5].map(function (f) {
        const o = a.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        o.connect(g);
        o.start();
        return o;
      });
      const timer = setInterval(function () { bell(0.05); }, 8000);
      audio.music = { g: g, oscs: oscs, timer: timer };
    } else if (!want && audio.music) {
      const m = audio.music;
      audio.music = null;
      clearInterval(m.timer);
      const t = audio.ctx.currentTime;
      m.g.gain.cancelScheduledValues(t);
      m.g.gain.setValueAtTime(m.g.gain.value || 0.0001, t);
      m.g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      m.oscs.forEach((o) => o.stop(t + 0.7));
    }
  }

  function renderToggles() {
    const s = soundOn();
    $('tp-sound').setAttribute('aria-pressed', String(s));
    $('tp-sound').firstChild.textContent = s ? '🔊' : '🔇';
    $('tp-sound').title = 'Âm thanh: ' + (s ? 'Bật' : 'Tắt');
    $('tp-music').setAttribute('aria-pressed', String(!!prefs.music));
    $('tp-music').title = 'Nhạc thiền: ' + (prefs.music ? 'Bật' : 'Tắt');
    syncMusic();
  }

  // Trang đang được nhìn thấy: tab trình duyệt hiện và (trong khung ứng dụng) iframe của trang đang mở.
  function pageVisible() {
    if (document.hidden) return false;
    try {
      const fe = window.frameElement;
      if (fe && getComputedStyle(fe).visibility === 'hidden') return false;
    } catch (e) { /* khác nguồn gốc */ }
    return true;
  }
  // Khung ứng dụng ẩn/hiện iframe bằng class, không phát visibilitychange → kiểm tra định kỳ khi đang bật nhạc.
  setInterval(function () { if (prefs.music) syncMusic(); }, 1500);

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ---------- Tiện ích ----------

  function fmt2(v) { return v.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtInt(v) { return v.toLocaleString('vi-VN'); }
  function sign(v) { return v > 0.0005 ? '+' : ''; }
  function arrow(v) { return v > 0.0005 ? '▲' : v < -0.0005 ? '▼' : '■'; }

  // Hôm nay: "13:20"; ngày khác: "29/09 13:20" (giờ Việt Nam).
  function fmtTime(iso) {
    const t = Date.parse(iso);
    if (!isFinite(t)) return '';
    const d = new Date(t + 7 * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    const hm = p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    return tp.dayKey(t) === tp.dayKey(Date.now()) ? hm : p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + ' ' + hm;
  }

  function missingTable(err) {
    const msg = String((err && err.message) || '');
    return !!err && (err.code === '42P01' || err.code === 'PGRST205' || (/temple_prayers/.test(msg) && /does not exist|schema cache/.test(msg)));
  }

  function setStatus(kind, text) {
    $('status-dot').className = 'dot ' + kind;
    $('status-text').textContent = text;
  }

  function messageOf(err) {
    if (!err) return 'Vui lòng thử lại sau.';
    if (err.name === 'DataError') return err.message;
    const msg = String(err.message || '');
    if (msg.indexOf('gửi quá nhanh') >= 0) return 'Đạo hữu khấn nhanh quá, xin đợi một lát.';
    if (err.code === '23514') return 'Lời khấn phải có từ 1 đến ' + cfg.maxLen + ' ký tự.';
    if (err.code || err.status) return VST.auth.errorMessage(err);
    return 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.';
  }

  function showNotice(msg) {
    $('notice-text').textContent = msg;
    $('notice').hidden = false;
  }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ symbol: prefs.symbol, merit: prefs.merit || 0, sound: prefs.sound, music: !!prefs.music }));
    } catch (e) { /* bỏ qua: chế độ ẩn danh hoặc bị chặn lưu trữ */ }
  }

  function loadLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {}; } catch (e) { return {}; }
  }

  function saveLocal(all) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(all)); } catch (e) { /* bỏ qua */ }
  }
});
