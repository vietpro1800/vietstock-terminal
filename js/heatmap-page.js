// Trang bản đồ nhiệt: ô theo ngành (VST.universe), diện tích = GTGD bình quân N phiên, màu = % thay đổi giá.
// Nến ngày từ VNDirect (tải một lần, giữ trong phiên trình duyệt), giá khớp realtime từ bảng giá SSI.
// Chỉ chạy sau khi xác nhận đã đăng nhập và tài khoản đang hoạt động.
VST.auth.guard().then(function (ctx) {
  const cfg = VST.config.heatmap;
  const uni = VST.universe;
  const hm = VST.heatmap;
  const pb = VST.priceboard;
  const esc = VST.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'vst.heatmap.v1';
  const CACHE_KEY = 'vst.heatmap.cache.v1';
  const EX_LABEL = { hose: 'HOSE', hnx: 'HNX', upcom: 'UPCoM' };
  const HEADER_H = 16;
  const KEEP = Math.max.apply(null, cfg.periods.map((p) => p.n)) + 2; // số giá đóng cửa cần giữ mỗi mã

  // Đổi nguồn dữ liệu tại đây (cùng lớp với dashboard).
  const source = new VST.VndirectSource({ batchSize: cfg.batchSize });
  const feed = new VST.SsiBoardFeed();
  const LOAD_TF = { label: 'Ngày', resolution: 'D', days: cfg.days };
  const canHover = window.matchMedia && window.matchMedia('(hover: hover)').matches;

  const prefs = loadPrefs();
  const state = {
    scope: cfg.scopes.some((s) => s.id === prefs.scope) ? prefs.scope : cfg.defaultScope,
    period: cfg.periods.some((p) => p.id === prefs.period) ? prefs.period : cfg.periods[0].id,
    rows: {},          // { [mã]: { closes, lastDay, value, rt } }
    failed: new Set(), // mã không có dữ liệu (bỏ qua tới khi Tải lại)
    loadedAt: 0,
    loadToken: 0,
    tiles: {},         // { [mã]: phần tử ô }
    size: '',
    rtStatus: '',
    dirty: new Set(),  // mã có giá realtime mới, chờ vẽ lại
  };

  VST.auth.mountUserBar($('user-bar'), ctx.profile, 'heatmap');
  buildControls();
  restoreCache();
  load();

  // ---------- Điều khiển ----------

  function buildControls() {
    $('hm-scope').innerHTML = cfg.scopes.map(function (s) {
      const n = scopeSymbols(s.id).length;
      return '<option value="' + s.id + '">' + esc(s.label) + ' (' + n + ' mã)</option>';
    }).join('');
    $('hm-scope').value = state.scope;
    $('hm-scope').addEventListener('change', function () {
      state.scope = this.value;
      savePrefs();
      load();
    });

    $('hm-period').innerHTML = cfg.periods.map((p) =>
      '<button type="button" data-v="' + p.id + '">' + esc(p.label) + '</button>').join('');
    $('hm-period').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-v]');
      if (!b || b.dataset.v === state.period) return;
      state.period = b.dataset.v;
      savePrefs();
      paintAll();
    });

    $('hm-reload').addEventListener('click', function () {
      scopeSymbols(state.scope).forEach(function (s) { delete state.rows[s]; state.failed.delete(s); });
      load();
    });
    $('notice-close').addEventListener('click', function () { $('notice').hidden = true; });

    const map = $('hm-map');
    map.addEventListener('click', function (e) {
      const tile = e.target.closest('.hm-tile');
      if (!tile) { hideTip(); return; }
      if (canHover) VST.nav.open(chartUrl(tile.dataset.sym));
      else showTip(tile, null);
    });
    if (canHover) {
      map.addEventListener('mousemove', function (e) {
        const tile = e.target.closest('.hm-tile');
        if (tile) showTip(tile, e); else hideTip();
      });
      map.addEventListener('mouseleave', hideTip);
    }
    document.addEventListener('click', function (e) {
      if (!e.target.closest('#hm-map, #hm-tip')) hideTip();
    });

    if (window.ResizeObserver) {
      let timer = null;
      new ResizeObserver(function () {
        clearTimeout(timer);
        timer = setTimeout(function () { if (sizeKey() !== state.size) render(); }, 120);
      }).observe(map);
    } else {
      window.addEventListener('resize', function () { if (sizeKey() !== state.size) render(); });
    }
  }

  function period() { return cfg.periods.find((p) => p.id === state.period) || cfg.periods[0]; }

  function scopeSymbols(id) {
    if (id === 'featured') return cfg.featured.filter((s) => uni.info[s]);
    if (id === 'all') return uni.all;
    return uni.all.filter((s) => uni.info[s].exchange === id);
  }

  // ---------- Dữ liệu ----------

  async function load() {
    const token = ++state.loadToken;
    const need = scopeSymbols(state.scope).filter((s) => !state.rows[s] && !state.failed.has(s));
    hideTip();
    if (!need.length) {
      $('hm-loading').hidden = true;
      render();
      watchRealtime();
      return;
    }
    $('hm-reload').disabled = true;
    $('hm-loading').hidden = false;
    setStatus('loading', 'Đang tải dữ liệu…');
    progress(0, need.length);
    try {
      const res = await source.getHistoryBatch(need, LOAD_TF, function (done, total) {
        if (token === state.loadToken) progress(done, total);
      });
      if (token !== state.loadToken) return;
      let firstError = null;
      need.forEach(function (sym) {
        const r = res[sym];
        const bars = r.bars ? r.bars.filter((b) => b.close > 0) : [];
        if (bars.length < 2) {
          state.failed.add(sym);
          if (r.error && !firstError) firstError = r.error;
          return;
        }
        state.rows[sym] = {
          closes: bars.slice(-KEEP).map((b) => b.close),
          lastDay: hm.dayKey(bars[bars.length - 1].time),
          value: hm.avgValue(bars, cfg.valueDays),
          rt: null,
        };
      });
      state.loadedAt = Date.now();
      const ok = scopeSymbols(state.scope).filter((s) => state.rows[s]).length;
      if (!ok) showNotice('Không tải được dữ liệu các mã. ' + messageOf(firstError));
      else $('notice').hidden = true;
      saveCache();
      render();
      watchRealtime();
    } catch (err) {
      if (token !== state.loadToken) return;
      showNotice(messageOf(err));
      setStatus('error', 'Lỗi tải dữ liệu');
    } finally {
      if (token === state.loadToken) {
        $('hm-loading').hidden = true;
        $('hm-reload').disabled = false;
      }
    }
  }

  function progress(done, total) {
    $('hm-progress-text').textContent = 'Đang tải dữ liệu ' + done + '/' + total + ' mã…';
    $('hm-progress-bar').style.width = (total ? (100 * done) / total : 0) + '%';
  }

  // Giá khớp realtime cho các mã GTGD lớn nhất trong phạm vi đang xem.
  function watchRealtime() {
    const syms = scopeSymbols(state.scope).filter((s) => state.rows[s])
      .sort((a, b) => state.rows[b].value - state.rows[a].value).slice(0, cfg.realtimeMax);
    feed.watch(syms, onQuote, onFeedStatus);
  }

  function onQuote(q) {
    const row = state.rows[q.symbol];
    if (!row || !(q.price > 0)) return;
    row.rt = { price: q.price, ref: q.price - q.change };
    if (!state.dirty.size) requestAnimationFrame(flush);
    state.dirty.add(q.symbol);
  }

  function flush() {
    state.dirty.forEach(function (sym) {
      const el = state.tiles[sym];
      if (el) { paintTile(el, sym); el.classList.remove('hm-flash'); void el.offsetWidth; el.classList.add('hm-flash'); }
    });
    state.dirty.clear();
    renderSummary();
  }

  function onFeedStatus(s) {
    state.rtStatus = s;
    if (s === 'open') setStatus('ok', 'Giá khớp realtime');
    else if (s === 'connecting') setStatus('loading', 'Đang kết nối realtime…');
    else setStatus('error', 'Mất kết nối realtime, đang thử lại…');
  }

  // Nến ngày (đã rút gọn) giữ trong sessionStorage vài phút: đổi phạm vi / quay lại trang không phải tải lại.
  function restoreCache() {
    try {
      const c = JSON.parse(sessionStorage.getItem(CACHE_KEY));
      if (!c || !c.rows || Date.now() - c.at > cfg.cacheMinutes * 60000) return;
      Object.keys(c.rows).forEach(function (sym) {
        if (!uni.info[sym]) return;
        const r = c.rows[sym];
        state.rows[sym] = { closes: r.c, lastDay: r.d, value: r.v, rt: null };
      });
      (c.failed || []).forEach((s) => state.failed.add(s));
      state.loadedAt = c.at;
    } catch (e) { /* bỏ qua */ }
  }

  function saveCache() {
    const rows = {};
    Object.keys(state.rows).forEach(function (sym) {
      const r = state.rows[sym];
      rows[sym] = { c: r.closes, d: r.lastDay, v: Math.round(r.value * 1000) / 1000 };
    });
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: state.loadedAt, rows: rows, failed: Array.from(state.failed) }));
    } catch (e) { /* bỏ qua: hết dung lượng hoặc bị chặn lưu trữ */ }
  }

  // ---------- Vẽ ----------

  function sizeKey() { return $('hm-map').clientWidth + 'x' + $('hm-map').clientHeight; }

  function render() {
    const map = $('hm-map');
    const W = map.clientWidth, H = map.clientHeight;
    state.size = sizeKey();
    const bySector = {};
    const groups = uni.sectors.map(function (s) {
      const g = { id: s.id, name: s.name, items: [] };
      bySector[s.name] = g;
      return g;
    });
    scopeSymbols(state.scope).forEach(function (sym) {
      const r = state.rows[sym];
      if (r && r.value > 0) bySector[uni.info[sym].sector].items.push({ id: sym, value: r.value });
    });
    const L = hm.layout(groups, W, H, { header: HEADER_H, gap: 3 });
    const px = (v) => Math.round(v * 10) / 10 + 'px';
    const box = (r) => 'left:' + px(r.x) + ';top:' + px(r.y) + ';width:' + px(r.w) + ';height:' + px(r.h);

    let html = L.groups.map(function (g) {
      return '<div class="hm-group" style="' + box(g) + '">' +
        (g.header ? '<span class="hm-group-name" title="' + esc(g.group.name) + '">' + esc(g.group.name) + '</span>' : '') + '</div>';
    }).join('');
    html += L.tiles.map(function (t) {
      const sym = t.item.id;
      // Cỡ chữ theo kích thước ô; ô quá nhỏ chỉ còn màu.
      const fs = Math.max(9, Math.min(26, t.w / (sym.length * 0.72 + 1.2), t.h / 2.6));
      let inner = '';
      if (t.w >= 24 && t.h >= 14) {
        inner = '<b class="hm-sym" style="font-size:' + fs.toFixed(1) + 'px">' + sym + '</b>';
        if (t.h >= fs * 2.3 && t.w >= 40) inner += '<span class="hm-pct" style="font-size:' + Math.max(9, fs * 0.62).toFixed(1) + 'px"></span>';
      }
      return '<div class="hm-tile" data-sym="' + sym + '" style="' + box(t) + '">' + inner + '</div>';
    }).join('');
    map.innerHTML = html;

    state.tiles = {};
    map.querySelectorAll('.hm-tile').forEach(function (el) { state.tiles[el.dataset.sym] = el; });
    paintAll();
  }

  function paintAll() {
    $('hm-period').querySelectorAll('button').forEach(function (b) {
      const on = b.dataset.v === state.period;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    Object.keys(state.tiles).forEach((sym) => paintTile(state.tiles[sym], sym));
    renderSummary();
    renderLegend();
  }

  // Màu: trần/sàn (chỉ kỳ 1 phiên), tăng/giảm theo mức, đứng giá.
  function tileState(sym) {
    const per = period();
    const ch = hm.change(state.rows[sym], per.n, todayKey());
    if (!ch) return { ch: null, cls: 'na' };
    let cls = hm.bucket(ch.pct, cfg.steps, per.scale);
    if (per.n === 1) {
      const lim = pb.priceLimits(ch.base, uni.info[sym].exchange);
      const pc = pb.priceClass(ch.price, ch.base, lim.ceil, lim.floor);
      if (pc === 'ceil' || pc === 'floor') cls = pc;
    }
    return { ch: ch, cls: cls };
  }

  function paintTile(el, sym) {
    const st = tileState(sym);
    el.className = 'hm-tile hm-' + st.cls;
    const pct = el.querySelector('.hm-pct');
    if (pct) pct.textContent = st.ch ? fmtPct(st.ch.pct) : '–';
  }

  function renderSummary() {
    const per = period();
    let up = 0, down = 0, flat = 0, n = 0;
    Object.keys(state.tiles).forEach(function (sym) {
      const ch = hm.change(state.rows[sym], per.n, todayKey());
      if (!ch) return;
      n++;
      if (ch.pct >= 0.005) up++; else if (ch.pct <= -0.005) down++; else flat++;
    });
    const missing = scopeSymbols(state.scope).filter((s) => state.failed.has(s) || (state.rows[s] && !(state.rows[s].value > 0))).length;
    const last = Object.keys(state.tiles).reduce(function (t, sym) {
      const r = state.rows[sym];
      return Math.max(t, r.rt ? todayKey() : r.lastDay);
    }, 0);
    $('hm-summary').innerHTML = [
      esc(per.label),
      n + ' mã',
      '<span class="up">' + up + ' tăng</span> / <span class="down">' + down + ' giảm</span> / <span class="ref">' + flat + ' đứng</span>',
      last ? 'đến ' + fmtDay(last) : '',
      missing ? '<span title="Không có dữ liệu hoặc không giao dịch trong ' + cfg.valueDays + ' phiên gần nhất">' + missing + ' mã không giao dịch</span>' : '',
    ].filter(Boolean).join(' · ');
  }

  function renderLegend() {
    const per = period();
    const th = cfg.steps.map((s) => s * per.scale);
    const lv = cfg.steps.length + 1;
    const range = function (k) { // k = 1…lv
      const lo = k === 1 ? 0 : th[k - 2], hi = th[k - 1];
      return hi == null ? '≥ ' + fmtNum(lo) + '%' : fmtNum(lo) + '–' + fmtNum(hi) + '%';
    };
    let sw = '';
    for (let k = lv; k >= 1; k--) sw += '<i class="hm-d' + k + '" title="Giảm ' + range(k) + '"></i>';
    sw += '<i class="hm-z" title="Đứng giá"></i>';
    for (let k = 1; k <= lv; k++) sw += '<i class="hm-u' + k + '" title="Tăng ' + range(k) + '"></i>';
    $('hm-legend').innerHTML =
      '<span class="hm-scale">Giảm ' + sw + ' Tăng</span>' +
      (per.n === 1 ? '<span class="hm-scale"><i class="hm-ceil"></i> Trần <i class="hm-floor"></i> Sàn</span>' : '') +
      '<span class="dim">Diện tích ô = GTGD bình quân ' + cfg.valueDays + ' phiên · ' +
      (per.n === 1 ? 'so với giá tham chiếu' : 'so với ' + per.n + ' phiên trước') + ' · giá khớp realtime' +
      (canHover ? ' · nhấn vào ô để xem biểu đồ' : ' · chạm vào ô để xem chi tiết') + '</span>';
  }

  // ---------- Chú thích khi rê chuột / chạm ----------

  function showTip(tile, ev) {
    const sym = tile.dataset.sym;
    const row = state.rows[sym];
    const info = uni.info[sym];
    if (!row || !info) return;
    const per = period();
    const st = tileState(sym);
    const ch = st.ch;
    const cls = ch ? (st.cls === 'ceil' || st.cls === 'floor' ? st.cls : ch.pct > 0.005 ? 'up' : ch.pct < -0.005 ? 'down' : 'ref') : '';
    const tip = $('hm-tip');
    tip.innerHTML =
      '<div><b>' + sym + '</b> <span class="dim">· ' + EX_LABEL[info.exchange] + ' · ' + esc(info.industry) + '</span></div>' +
      (ch
        ? '<div>Giá <b class="' + cls + '">' + fmtNum(ch.price) + '</b> <b class="' + cls + '">' + fmtPct(ch.pct) + '</b></div>' +
          '<div class="dim">' + (per.n === 1 ? 'Tham chiếu ' : 'Giá ' + per.n + ' phiên trước ') + fmtNum(ch.base) + (row.rt ? ' · realtime' : '') + '</div>'
        : '<div class="dim">Chưa đủ dữ liệu cho kỳ ' + esc(per.label) + '</div>') +
      '<div class="dim">GTGD TB' + cfg.valueDays + ': ' + fmtNum(row.value) + ' tỷ</div>' +
      (canHover ? '' : '<a class="btn btn-sm hm-tip-open" href="' + chartUrl(sym) + '">Xem biểu đồ ' + sym + '</a>');
    tip.hidden = false;

    const wrap = tip.parentElement.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x, y;
    if (ev) {
      x = ev.clientX - wrap.left + 14;
      y = ev.clientY - wrap.top + 14;
      if (x + tw > wrap.width) x = ev.clientX - wrap.left - tw - 14;
      if (y + th > wrap.height) y = ev.clientY - wrap.top - th - 14;
    } else {
      const r = tile.getBoundingClientRect();
      x = r.left - wrap.left + r.width / 2 - tw / 2;
      y = r.bottom - wrap.top + 6;
      if (y + th > wrap.height) y = r.top - wrap.top - th - 6;
    }
    tip.style.left = Math.max(4, Math.min(x, wrap.width - tw - 4)) + 'px';
    tip.style.top = Math.max(4, Math.min(y, wrap.height - th - 4)) + 'px';
  }

  function hideTip() { $('hm-tip').hidden = true; }

  // ---------- Tiện ích ----------

  function todayKey() { return hm.dayKey(Date.now() / 1000); }
  function chartUrl(sym) { return 'dashboard.html?symbol=' + encodeURIComponent(sym); }
  function fmtNum(v) { return v.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtPct(v) { return (v > 0 ? '+' : '') + fmtNum(v) + '%'; }
  function fmtDay(k) {
    const d = new Date(k * 86400000);
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

  function showNotice(msg) {
    $('notice-text').textContent = msg;
    $('notice').hidden = false;
  }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }

  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ scope: state.scope, period: state.period }));
    } catch (e) { /* bỏ qua: chế độ ẩn danh hoặc bị chặn lưu trữ */ }
  }
});
