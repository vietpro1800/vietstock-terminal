// Trang Backtest: đọc thiết lập, tải dữ liệu, chạy js/backtest.js rồi hiển thị kết quả.
// Chỉ chạy sau khi xác nhận đã đăng nhập và tài khoản đang hoạt động.
VST.auth.guard().then(function (ctx) {
  const cfg = VST.config;
  const bt = VST.backtest;
  const esc = VST.escapeHtml;
  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'vst.backtest.v1';
  const DAY = 86400;
  const VN_OFFSET = 7 * 3600;

  // Đổi nguồn dữ liệu tại đây (cùng lớp với dashboard).
  const source = new VST.VndirectSource({ batchSize: cfg.batchSize });

  const REASON = { signal: 'Tín hiệu bán', stop: 'Cắt lỗ', take: 'Chốt lời', open: 'Đang nắm giữ' };

  const prefs = loadPrefs();
  const state = {
    period: ['1', '3', '5', 'custom'].indexOf(prefs.period) >= 0 ? prefs.period : '3',
    params: prefs.params || {},
    running: false,
  };
  let charts = null;

  VST.auth.mountUserBar($('user-bar'), ctx.profile, 'backtest');
  buildForm();

  // ---------- Form ----------

  function buildForm() {
    $('bt-symbol-list').innerHTML = cfg.boardSymbols.map((s) => '<option value="' + s + '">').join('');
    $('bt-symbol').value = prefs.symbol || cfg.defaultSymbol;
    $('bt-capital').value = prefs.capital || cfg.backtest.defaultCapital;

    const today = isoDate(Date.now() / 1000);
    $('bt-to').value = prefs.to || today;
    $('bt-from').value = prefs.from || isoDate(Date.now() / 1000 - 3 * 365 * DAY);
    $('bt-to').max = today;
    $('bt-from').max = today;
    $('bt-period').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-period]');
      if (!b) return;
      state.period = b.dataset.period;
      renderPeriod();
    });
    renderPeriod();

    const sel = $('bt-strategy');
    sel.innerHTML = Object.keys(bt.STRATEGIES).map((id) =>
      '<option value="' + id + '">' + esc(bt.STRATEGIES[id].name) + '</option>').join('');
    sel.value = bt.STRATEGIES[prefs.strategy] ? prefs.strategy : 'maCross';
    sel.addEventListener('change', function () { renderParams(); });
    renderParams();

    $('bt-sl').value = prefs.sl || '';
    $('bt-tp').value = prefs.tp || '';
    const c = prefs.costs || {};
    const d = bt.DEFAULT_COSTS;
    $('bt-buy-fee').value = c.buyFee != null ? c.buyFee : round(d.buyFee * 100, 4);
    $('bt-sell-fee').value = c.sellFee != null ? c.sellFee : round(d.sellFee * 100, 4);
    $('bt-sell-tax').value = c.sellTax != null ? c.sellTax : round(d.sellTax * 100, 4);

    $('bt-form').addEventListener('submit', function (e) {
      e.preventDefault();
      runBacktest();
    });
    $('notice-close').addEventListener('click', hideNotice);
  }

  function renderPeriod() {
    $('bt-period').querySelectorAll('button').forEach(function (b) {
      const on = b.dataset.period === state.period;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    $('bt-custom').hidden = state.period !== 'custom';
  }

  function renderParams() {
    const id = $('bt-strategy').value;
    const st = bt.STRATEGIES[id];
    const saved = state.params[id] || {};
    $('bt-strategy-desc').textContent = st.desc;
    $('bt-params').innerHTML = st.params.map(function (p) {
      const v = saved[p.key] != null ? saved[p.key] : p.def;
      const input = p.options
        ? '<select class="input" data-param="' + p.key + '">' + p.options.map((o) =>
          '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>'
        : '<input class="input" type="number" inputmode="decimal" data-param="' + p.key + '" min="' + p.min +
          '" max="' + p.max + '" step="' + p.step + '" value="' + esc(v) + '">';
      return '<label class="form-field"><span>' + esc(p.label) + '</span>' + input + '</label>';
    }).join('');
  }

  // Đọc và kiểm tra form. Trả về thiết lập hoặc ném Error với câu tiếng Việt.
  function readForm() {
    const symbol = $('bt-symbol').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new Error('Vui lòng nhập mã chứng khoán hợp lệ, ví dụ HPG.');
    $('bt-symbol').value = symbol;

    const capital = Number($('bt-capital').value);
    if (!(capital >= 1000000)) throw new Error('Vốn ban đầu tối thiểu 1.000.000 đồng.');

    const now = Math.floor(Date.now() / 1000);
    let start, end;
    if (state.period === 'custom') {
      start = parseDate($('bt-from').value);
      end = parseDate($('bt-to').value);
      if (start == null || end == null) throw new Error('Vui lòng chọn đủ ngày bắt đầu và ngày kết thúc.');
      end = Math.min(end + DAY - 1, now);
      if (end - start < 30 * DAY) throw new Error('Khoảng thời gian tùy chọn phải dài ít nhất 30 ngày.');
    } else {
      end = now;
      start = Math.floor(now - Number(state.period) * 365.25 * DAY);
    }

    const strategy = $('bt-strategy').value;
    const st = bt.STRATEGIES[strategy];
    const params = {};
    st.params.forEach(function (p) {
      const el = $('bt-params').querySelector('[data-param="' + p.key + '"]');
      if (p.options) { params[p.key] = el.value; return; }
      const v = Number(el.value);
      if (el.value === '' || !isFinite(v) || v < p.min || v > p.max) {
        throw new Error('Tham số "' + p.label + '" phải trong khoảng ' + fmtNum(p.min) + ' – ' + fmtNum(p.max) + '.');
      }
      params[p.key] = p.step >= 1 ? Math.round(v) : v;
    });
    const bad = st.validate && st.validate(params);
    if (bad) throw new Error(bad);

    const pct = function (id, label, max) {
      const raw = $(id).value.trim();
      if (raw === '') return 0;
      const v = Number(raw);
      if (!isFinite(v) || v < 0 || v > max) throw new Error(label + ' phải từ 0 đến ' + max + '%.');
      return v;
    };
    const sl = pct('bt-sl', 'Cắt lỗ', 99);
    const tp = pct('bt-tp', 'Chốt lời', 1000);
    const costsPct = {
      buyFee: pct('bt-buy-fee', 'Phí mua', 5),
      sellFee: pct('bt-sell-fee', 'Phí bán', 5),
      sellTax: pct('bt-sell-tax', 'Thuế bán', 5),
    };

    state.params[strategy] = params;
    return {
      symbol: symbol, capital: capital, start: start, end: end,
      strategy: strategy, params: params, sl: sl, tp: tp, costsPct: costsPct,
      costs: { buyFee: costsPct.buyFee / 100, sellFee: costsPct.sellFee / 100, sellTax: costsPct.sellTax / 100 },
      lookback: st.lookback(params),
    };
  }

  // ---------- Chạy ----------

  async function runBacktest() {
    if (state.running) return;
    let s;
    try {
      s = readForm();
    } catch (err) {
      showNotice(err.message);
      return;
    }
    hideNotice();
    savePrefs(s);
    state.running = true;
    const btn = $('bt-run');
    btn.disabled = true;
    btn.textContent = 'Đang tải dữ liệu…';

    try {
      // Tải thêm dữ liệu trước ngày bắt đầu để chỉ báo có giá trị ngay từ phiên đầu.
      const warmDays = Math.max(cfg.backtest.warmupDays, Math.ceil(s.lookback * 1.5) + 30);
      const [stockRes, indexRes] = await Promise.allSettled([
        source.getHistoryRange(s.symbol, s.start - warmDays * DAY, s.end),
        source.getHistoryRange(cfg.backtest.indexSymbol, s.start - 10 * DAY, s.end),
      ]);
      if (stockRes.status === 'rejected') throw stockRes.reason;
      const bars = stockRes.value;
      const indexBars = indexRes.status === 'fulfilled' ? indexRes.value : null;

      btn.textContent = 'Đang tính toán…';
      const startIndex = bars.findIndex((b) => b.time >= s.start);
      if (startIndex < 0 || startIndex >= bars.length - 1) {
        throw new bt.BacktestError('Không có đủ phiên giao dịch của mã ' + s.symbol + ' trong khoảng thời gian đã chọn.');
      }

      const res = bt.run(bars, {
        strategy: s.strategy, params: s.params, capital: s.capital, costs: s.costs,
        startIndex: startIndex, stopLoss: s.sl / 100, takeProfit: s.tp / 100,
      });
      const hold = bt.buyAndHold(bars, startIndex, s.capital, s.costs);
      const index = indexBars ? bt.benchmark(indexBars, res.equity.map((e) => e.time), s.capital) : null;

      const warnings = [];
      if (!indexBars) warnings.push('Không tải được dữ liệu VN-Index nên không vẽ được đường so sánh. ' + messageOf(indexRes.reason));
      if (bars[startIndex].time - s.start > 15 * DAY) {
        warnings.push('Dữ liệu mã ' + s.symbol + ' chỉ có từ ngày ' + VST.fmtDate(bars[startIndex].time) + '.');
      }
      const warmBars = startIndex;
      if (warmBars < s.lookback) {
        warnings.push('Không đủ ' + s.lookback + ' phiên trước ngày bắt đầu để tính chỉ báo, nên những phiên đầu có thể chưa có tín hiệu.');
      }
      const gaps = bt.detectGaps(bars.slice(startIndex - (startIndex > 0 ? 1 : 0)));
      if (gaps.length) {
        warnings.push('<b>Dữ liệu có dấu hiệu chưa điều chỉnh:</b> giá giảm hơn 7,5% so với phiên trước (vượt biên độ sàn HOSE) vào ' +
          gaps.slice(0, 6).map((g) => VST.fmtDate(g.time) + ' (−' + VST.fmtPct(g.drop * 100) + '%)').join(', ') +
          (gaps.length > 6 ? ' và ' + (gaps.length - 6) + ' phiên khác' : '') +
          '. Thường là ngày chia cổ tức bằng cổ phiếu, thưởng hoặc tách cổ phiếu (cũng có thể do mã sàn HNX/UPCoM có biên độ rộng hơn). ' +
          'Kết quả chiến lược và "mua và giữ" có thể bị sai lệch quanh các ngày này.');
      }

      render(s, bars.slice(startIndex), res, hold, index, warnings);
    } catch (err) {
      showNotice(messageOf(err));
    } finally {
      state.running = false;
      btn.disabled = false;
      btn.textContent = 'Chạy backtest';
    }
  }

  // ---------- Hiển thị ----------

  function render(s, bars, res, hold, index, warnings) {
    $('bt-result').hidden = false;
    $('bt-title').textContent = s.symbol + ' · ' + bt.STRATEGIES[s.strategy].name;
    $('bt-range').textContent = VST.fmtDate(bars[0].time) + ' – ' + VST.fmtDate(bars[bars.length - 1].time) +
      ' · ' + bars.length + ' phiên';

    const warn = $('bt-data-warn');
    warn.hidden = !warnings.length;
    // Các chuỗi cảnh báo do code tạo ra; phần lấy từ lỗi đã qua messageOf (chuỗi cố định).
    warn.innerHTML = warnings.map((w) => '<p>' + w + '</p>').join('');

    const mS = bt.metrics(res.equity, res.trades);
    const mH = bt.metrics(hold.equity, null);
    const mI = index && index.length > 1 ? bt.metrics(index, null) : null;
    const dash = '<span class="dim">—</span>';
    const cols = [mS, mH, mI];
    const row = function (label, fn) {
      return '<tr><td>' + label + '</td>' + cols.map((m) => '<td class="num">' + (m ? fn(m) : dash) + '</td>').join('') + '</tr>';
    };
    const pctCell = (v) => (v == null ? dash : signedPct(v));
    $('bt-metrics').innerHTML =
      '<thead><tr><th>Chỉ số</th><th class="num">Chiến lược</th><th class="num">Mua và giữ</th><th class="num">VN-Index</th></tr></thead><tbody>' +
      row('Giá trị cuối kỳ (đ)', (m) => (m.finalValue == null ? dash : fmtMoney(m.finalValue))) +
      row('Tổng lợi nhuận', (m) => pctCell(m.totalReturn)) +
      row('Lợi nhuận năm hóa (CAGR)', (m) => pctCell(m.cagr)) +
      row('Sụt giảm tối đa', (m) => (m.maxDrawdown == null ? dash : '<span class="down">−' + VST.fmtPct(m.maxDrawdown * 100) + '%</span>')) +
      row('Sharpe', (m) => (m.sharpe == null ? dash : fmtNum(m.sharpe, 2))) +
      '<tr><td>Số giao dịch đã đóng</td><td class="num">' + mS.trades + '</td><td class="num">' + dash + '</td><td class="num">' + dash + '</td></tr>' +
      '<tr><td>Tỷ lệ thắng</td><td class="num">' + (mS.winRate == null ? dash : VST.fmtPct(mS.winRate * 100) + '%') +
        '</td><td class="num">' + dash + '</td><td class="num">' + dash + '</td></tr>' +
      '<tr><td>Profit factor</td><td class="num">' + (mS.profitFactor == null ? dash : mS.profitFactor === Infinity ? '∞' : fmtNum(mS.profitFactor, 2)) +
        '</td><td class="num">' + dash + '</td><td class="num">' + dash + '</td></tr>' +
      '</tbody>';

    renderTrades(res.trades);

    if (!window.LightweightCharts) {
      showNotice('Không tải được thư viện biểu đồ. Kiểm tra kết nối Internet rồi tải lại trang.');
    } else {
      if (!charts) charts = new VST.BacktestChartView({ candles: $('bt-candles'), equity: $('bt-equity') });
      charts.setData({ bars: bars, trades: res.trades, strategy: res.equity, hold: hold.equity, index: index });
    }
    if (window.innerWidth < 1000) $('bt-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderTrades(trades) {
    const closed = trades.filter((t) => !t.open).length;
    $('bt-trade-count').textContent = closed + ' đã đóng' + (closed < trades.length ? ', 1 đang nắm giữ' : '');
    if (!trades.length) {
      $('bt-trades').innerHTML = '<tr><td colspan="10" class="dim center">Không có giao dịch nào trong khoảng thời gian này.</td></tr>';
      return;
    }
    $('bt-trades').innerHTML = trades.map(function (t, i) {
      const cls = t.pnl > 0 ? 'up' : t.pnl < 0 ? 'down' : 'ref';
      return '<tr' + (t.open ? ' class="bt-open"' : '') + '>' +
        '<td class="dim">' + (i + 1) + '</td>' +
        '<td>' + VST.fmtDate(t.entryTime) + '</td>' +
        '<td class="num">' + VST.fmtPrice(t.entryPrice) + '</td>' +
        '<td>' + (t.open ? '<span class="dim">Chưa bán</span>' : VST.fmtDate(t.exitTime)) + '</td>' +
        '<td class="num">' + VST.fmtPrice(t.exitPrice) + (t.open ? '<span class="dim">*</span>' : '') + '</td>' +
        '<td class="num">' + t.shares.toLocaleString('vi-VN') + '</td>' +
        '<td class="num ' + cls + '">' + (t.pnl > 0 ? '+' : '') + fmtMoney(t.pnl) + '</td>' +
        '<td class="num ' + cls + '">' + signedPct(t.pnlPct, true) + '</td>' +
        '<td class="num">' + t.sessions + '</td>' +
        '<td>' + REASON[t.reason] + '</td>' +
        '</tr>';
    }).join('') + (trades.some((t) => t.open)
      ? '<tr><td colspan="10" class="dim small">* Vị thế đang mở: tạm tính theo giá đóng cửa phiên cuối, chưa trừ phí và thuế bán.</td></tr>'
      : '');
  }

  // ---------- Tiện ích ----------

  function signedPct(v, plain) {
    const s = (v > 0 ? '+' : v < 0 ? '−' : '') + VST.fmtPct(Math.abs(v) * 100) + '%';
    if (plain) return s;
    return '<span class="' + (v > 0 ? 'up' : v < 0 ? 'down' : 'ref') + '">' + s + '</span>';
  }
  function fmtMoney(v) { return Math.round(v).toLocaleString('vi-VN'); }
  function fmtNum(v, d) { return v.toLocaleString('vi-VN', { maximumFractionDigits: d == null ? 2 : d, minimumFractionDigits: d || 0 }); }
  function round(v, d) { const k = Math.pow(10, d); return Math.round(v * k) / k; }

  // "YYYY-MM-DD" (giờ VN) ↔ Unix giây.
  function parseDate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str || '');
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000 - VN_OFFSET;
  }
  function isoDate(t) { return new Date((t + VN_OFFSET) * 1000).toISOString().slice(0, 10); }

  function messageOf(err) {
    if (err && (err.name === 'DataError' || err.name === 'BacktestError')) return err.message;
    return 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.';
  }

  function showNotice(msg) {
    $('notice-text').textContent = msg;
    $('notice').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function hideNotice() { $('notice').hidden = true; }

  // ---------- Lưu thiết lập (chỉ trên trình duyệt này) ----------

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }

  function savePrefs(s) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        symbol: s.symbol, capital: s.capital, period: state.period,
        from: $('bt-from').value, to: $('bt-to').value,
        strategy: s.strategy, params: state.params,
        sl: s.sl || '', tp: s.tp || '', costs: s.costsPct,
      }));
    } catch (e) { /* bỏ qua: chế độ ẩn danh hoặc bị chặn lưu trữ */ }
  }
});
