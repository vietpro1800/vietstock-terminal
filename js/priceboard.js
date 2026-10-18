// Bảng giá kiểu SSI iBoard: Trần/Sàn/TC, 3 bước giá mua/bán, khớp lệnh, tổng KL, cao/thấp.
// Nến ngày (TC, cao, thấp, KL) do trang đưa vào setDaily(); sổ lệnh/khớp lệnh realtime qua pushQuote()
// (dữ liệu từ VST.SsiBoardFeed trong data.js). File này không gọi mạng.
// Các hàm tính giá trần/sàn ở VST.priceboard là hàm thuần, chạy được cả trong Node (tests/priceboard.test.js).
window.VST = window.VST || {};

(function () {
  // Biên độ dao động và bước giá theo sàn. Giá tính theo nghìn đồng.
  const BANDS = { hose: 0.07, hnx: 0.10, upcom: 0.15 };

  function normExchange(ex) {
    ex = String(ex || '').toLowerCase();
    if (ex.indexOf('upcom') >= 0) return 'upcom';
    if (ex.indexOf('hnx') >= 0) return 'hnx';
    return ex.indexOf('hose') >= 0 || ex.indexOf('hsx') >= 0 ? 'hose' : null;
  }

  // Bước giá (đồng). HOSE: < 10.000 → 10; < 50.000 → 50; còn lại 100. HNX, UPCoM: 100.
  function tickSize(priceDong, exchange) {
    if (exchange !== 'hose') return 100;
    return priceDong < 10000 ? 10 : priceDong < 50000 ? 50 : 100;
  }

  // Giá trần làm tròn xuống, giá sàn làm tròn lên theo bước giá (tính bằng đồng nguyên để tránh sai số).
  function priceLimits(ref, exchange) {
    const ex = normExchange(exchange) || 'hose';
    if (!(ref > 0)) return { ceil: null, floor: null };
    const refDong = Math.round(ref * 1000);
    const band = BANDS[ex];
    const up = refDong * (1 + band), down = refDong * (1 - band);
    const tu = tickSize(up, ex), td = tickSize(down, ex);
    const ceil = Math.floor(Math.round(up * 1000) / 1000 / tu) * tu;
    const floor = Math.ceil(Math.round(down * 1000) / 1000 / td) * td;
    return { ceil: ceil / 1000, floor: Math.max(td, floor) / 1000 };
  }

  // Lớp màu của một mức giá: trần (tím), sàn (xanh lam), tăng, giảm, tham chiếu.
  function priceClass(p, ref, ceil, floor) {
    if (!(p > 0) || !(ref > 0)) return '';
    const d = Math.round(p * 1000), r = Math.round(ref * 1000);
    if (ceil && d >= Math.round(ceil * 1000)) return 'ceil';
    if (floor && d <= Math.round(floor * 1000)) return 'floor';
    return d > r ? 'up' : d < r ? 'down' : 'ref';
  }

  VST.priceboard = { tickSize: tickSize, priceLimits: priceLimits, priceClass: priceClass, normExchange: normExchange };

  // ---------- Bảng (DOM) ----------

  // group: tiêu đề nhóm cột; ext: cột chỉ hiện ở chế độ "Đầy đủ".
  const COLUMNS = [
    { k: 'sym', label: 'CK' },
    { k: 'ceil', label: 'Trần', ext: true },
    { k: 'floor', label: 'Sàn', ext: true },
    { k: 'ref', label: 'TC' },
    { k: 'b3', label: 'Giá 3', group: 'buy', ext: true }, { k: 'bv3', label: 'KL 3', group: 'buy', ext: true },
    { k: 'b2', label: 'Giá 2', group: 'buy', ext: true }, { k: 'bv2', label: 'KL 2', group: 'buy', ext: true },
    { k: 'b1', label: 'Giá 1', group: 'buy' }, { k: 'bv1', label: 'KL 1', group: 'buy' },
    { k: 'price', label: 'Giá', group: 'match' }, { k: 'vol', label: 'KL', group: 'match', ext: true },
    { k: 'chg', label: '+/-', group: 'match' }, { k: 'pct', label: '+/- (%)', group: 'match' },
    { k: 'a1', label: 'Giá 1', group: 'sell' }, { k: 'av1', label: 'KL 1', group: 'sell' },
    { k: 'a2', label: 'Giá 2', group: 'sell', ext: true }, { k: 'av2', label: 'KL 2', group: 'sell', ext: true },
    { k: 'a3', label: 'Giá 3', group: 'sell', ext: true }, { k: 'av3', label: 'KL 3', group: 'sell', ext: true },
    { k: 'total', label: 'Tổng KL' },
    { k: 'high', label: 'Cao', ext: true },
    { k: 'low', label: 'Thấp', ext: true },
  ];
  const GROUPS = { buy: 'Bên mua', match: 'Khớp lệnh', sell: 'Bên bán' };

  class PriceTable {
    // opts: { onOpen(symbol), onPin(symbol), isPinned(symbol) }
    constructor(table, opts) {
      this.table = table;
      this.opts = opts;
      this.thead = table.createTHead();
      this.tbody = table.tBodies[0] || table.createTBody();
      this.models = {};
      this.rows = {};
      this.symbols = [];
      this.compact = false;
      this.dirty = new Set();
      this.frame = 0;
      this.tbody.addEventListener('click', (e) => {
        const pin = e.target.closest('button[data-pin]');
        if (pin) { this.opts.onPin(pin.dataset.pin); return; }
        const tr = e.target.closest('tr[data-symbol]');
        if (tr) this.opts.onOpen(tr.dataset.symbol);
      });
    }

    // Đổi danh sách mã. exchange: sàn mặc định của nhóm (khi chưa có dữ liệu realtime).
    setSymbols(symbols, exchange) {
      this.symbols = symbols.slice();
      const keep = {};
      symbols.forEach((s) => {
        keep[s] = this.models[s] || { symbol: s, exchange: null, daily: null, rt: null, hi: null, lo: null };
        keep[s].defaultExchange = exchange || 'hose';
      });
      this.models = keep;
      this._build();
    }

    setCompact(on) {
      this.compact = !!on;
      this._build();
    }

    hasSymbol(s) { return !!this.models[s]; }

    // bars: nến ngày (cũ → mới). Phiên cuối được coi là phiên hiện tại, phiên trước đó cho giá tham chiếu.
    setDaily(symbol, bars) {
      const m = this.models[symbol];
      if (!m || !bars || !bars.length) return;
      const last = bars[bars.length - 1], prev = bars[bars.length - 2];
      m.daily = {
        ref: prev ? prev.close : last.open, close: last.close,
        high: last.high, low: last.low, volume: last.volume,
      };
      this._mark(symbol);
    }

    pushQuote(q) {
      const m = this.models[q.symbol];
      if (!m) return;
      const ex = normExchange(q.exchange);
      if (ex) m.exchange = ex;
      m.rt = q;
      if (q.price > 0) {
        m.hi = m.hi == null ? q.price : Math.max(m.hi, q.price);
        m.lo = m.lo == null ? q.price : Math.min(m.lo, q.price);
      }
      this._mark(q.symbol);
    }

    // Làm mới biểu tượng ghim (sau khi danh mục thay đổi).
    refreshPins() {
      Object.keys(this.rows).forEach((s) => {
        const on = this.opts.isPinned(s);
        const b = this.rows[s].pin;
        b.classList.toggle('on', on);
        b.textContent = on ? '★' : '☆';
        b.setAttribute('aria-pressed', on);
        b.setAttribute('aria-label', (on ? 'Bỏ ' : 'Thêm ') + s + (on ? ' khỏi' : ' vào') + ' danh mục của tôi');
      });
    }

    // Cuộn tới và tô sáng một dòng (ô tìm kiếm).
    highlight(symbol) {
      const r = this.rows[symbol];
      if (!r) return;
      r.tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
      r.tr.classList.remove('pb-found');
      void r.tr.offsetWidth;
      r.tr.classList.add('pb-found');
    }

    _cols() { return this.compact ? COLUMNS.filter((c) => !c.ext) : COLUMNS; }

    _build() {
      const cols = this._cols();
      // Hàng tiêu đề 1: cột đơn (gộp 2 hàng) và tiêu đề nhóm; hàng 2: cột trong nhóm.
      let top = '', sub = '';
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (!c.group) { top += '<th rowspan="2" class="pb-c-' + c.k + '">' + c.label + '</th>'; continue; }
        let n = 0;
        while (cols[i + n] && cols[i + n].group === c.group) n++;
        top += '<th colspan="' + n + '" class="pb-g pb-g-' + c.group + '">' + GROUPS[c.group] + '</th>';
        for (let j = 0; j < n; j++) sub += '<th class="pb-c-' + cols[i + j].k + (j === 0 ? ' pb-gs' : '') + '">' + cols[i + j].label + '</th>';
        i += n - 1;
      }
      this.thead.innerHTML = '<tr>' + top + '</tr><tr>' + sub + '</tr>';

      this.rows = {};
      if (!this.symbols.length) {
        this.tbody.innerHTML = '<tr><td colspan="' + cols.length + '" class="pb-empty">Chưa có mã nào. ' +
          'Nhập mã vào ô tìm kiếm hoặc bấm ☆ ở nhóm khác để thêm vào danh mục.</td></tr>';
        return;
      }
      const frag = document.createDocumentFragment();
      this.symbols.forEach((s) => {
        const tr = document.createElement('tr');
        tr.dataset.symbol = s;
        const cells = {};
        cols.forEach((c, i) => {
          const td = document.createElement('td');
          td.className = 'pb-c-' + c.k + (c.group && (i === 0 || cols[i - 1].group !== c.group) ? ' pb-gs' : '');
          cells[c.k] = { td: td, text: null, cls: null };
          tr.appendChild(td);
        });
        const pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'pb-pin';
        pin.dataset.pin = s;
        const name = document.createElement('span');
        name.className = 'pb-sym';
        name.textContent = s;
        cells.sym.td.append(pin, name);
        cells.sym.el = name;
        this.rows[s] = { tr: tr, cells: cells, pin: pin };
        frag.appendChild(tr);
        this._update(s, true);
      });
      this.tbody.replaceChildren(frag);
      this.refreshPins();
    }

    _mark(symbol) {
      this.dirty.add(symbol);
      if (!this.frame) this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.dirty.forEach((s) => this._update(s, false));
        this.dirty.clear();
      });
    }

    _update(symbol, initial) {
      const r = this.rows[symbol], m = this.models[symbol];
      if (!r || !m) return;
      const v = viewOf(m);
      Object.keys(r.cells).forEach((k) => {
        const cell = r.cells[k];
        const val = v[k] || ['', ''];
        const el = cell.el || cell.td;
        if (cell.text !== val[0]) {
          el.textContent = val[0];
          // Nháy nền khi giá/khối lượng thay đổi (không nháy lần vẽ đầu).
          if (!initial && cell.text) {
            cell.td.classList.remove('pb-flash');
            void cell.td.offsetWidth;
            cell.td.classList.add('pb-flash');
          }
          cell.text = val[0];
        }
        if (cell.cls !== val[1]) {
          if (cell.cls) el.classList.remove(cell.cls);
          if (val[1]) el.classList.add(val[1]);
          cell.cls = val[1];
        }
      });
    }
  }

  // Giá trị hiển thị và lớp màu của từng ô: { key: [text, class] }.
  function viewOf(m) {
    const d = m.daily, q = m.rt;
    const live = q && q.price > 0;
    // Giá tham chiếu: ưu tiên realtime (giá − thay đổi), nếu chưa khớp lệnh thì lấy từ nến ngày.
    const ref = live ? round2(q.price - q.change) : d ? d.ref : null;
    const ex = m.exchange || m.defaultExchange;
    const lim = priceLimits(ref, ex);
    const color = (p) => priceClass(p, ref, lim.ceil, lim.floor);
    const price = live ? q.price : d ? d.close : null;
    // Nến ngày là phiên trước (sáng sớm, chưa có nến hôm nay) thì bỏ cao/thấp/KL của nến đó.
    const dailyToday = d && !(live && Math.abs(d.close - ref) < 1e-6 && Math.abs(d.ref - ref) > 1e-6);
    const high = maxOf(dailyToday ? d.high : null, m.hi);
    const low = minOf(dailyToday ? d.low : null, m.lo);
    const total = q && q.totalVol ? q.totalVol : dailyToday ? d.volume : null;

    const v = {
      sym: ['', color(price)],
      ceil: [fp(lim.ceil), 'ceil'],
      floor: [fp(lim.floor), 'floor'],
      ref: [fp(ref), 'ref'],
      total: [fv(total), ''],
      high: [fp(high), color(high)],
      low: [fp(low), color(low)],
    };
    v.sym[0] = m.symbol;
    for (let i = 0; i < 3; i++) {
      const b = q && q.bids[i], a = q && q.asks[i];
      const bc = b && b.price > 0 ? color(b.price) : '', ac = a && a.price > 0 ? color(a.price) : '';
      v['b' + (i + 1)] = [b && b.price > 0 ? fp(b.price) : b && b.vol > 0 ? 'ATO/ATC' : '', bc];
      v['bv' + (i + 1)] = [b && b.vol > 0 ? fv(b.vol) : '', bc];
      v['a' + (i + 1)] = [a && a.price > 0 ? fp(a.price) : a && a.vol > 0 ? 'ATO/ATC' : '', ac];
      v['av' + (i + 1)] = [a && a.vol > 0 ? fv(a.vol) : '', ac];
    }
    const pc = color(price);
    const chg = price != null && ref ? price - ref : null;
    v.price = [fp(price), pc];
    v.vol = [live && q.vol > 0 ? fv(q.vol) : '', pc];
    v.chg = [chg == null ? '' : (chg > 0.0005 ? '+' : '') + fp(chg), pc];
    v.pct = [chg == null ? '' : (chg > 0.0005 ? '+' : '') + fpct((chg / ref) * 100) + '%', pc];
    return v;
  }

  function round2(x) { return Math.round(x * 100) / 100; }
  function maxOf(a, b) { return a == null ? b : b == null ? a : Math.max(a, b); }
  function minOf(a, b) { return a == null ? b : b == null ? a : Math.min(a, b); }
  function fp(p) { return p == null || !isFinite(p) ? '' : p.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fpct(p) { return p.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fv(v) { return v == null || !isFinite(v) ? '' : Math.round(v).toLocaleString('vi-VN'); }

  VST.PriceTable = PriceTable;
})();
