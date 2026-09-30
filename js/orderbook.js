// Khung sổ lệnh: 3 bước giá mua/bán, danh sách khớp lệnh, tổng khối lượng mua/bán chủ động.
// Nhận dữ liệu từ VST.SsiRealtimeFeed (data.js); file này chỉ lo hiển thị.
window.VST = window.VST || {};

(function () {
  const MAX_TRADES = 80;
  const esc = function (s) { return VST.escapeHtml(s); };

  const STATUS = {
    connecting: ['loading', 'Đang kết nối realtime…'],
    open: ['ok', 'Realtime'],
    closed: ['error', 'Mất kết nối realtime, đang thử lại…'],
  };

  class OrderBook {
    constructor(root) {
      this.root = root;
      root.innerHTML =
        '<div class="ob-head">' +
          '<div class="ob-title"><b class="ob-sym">—</b>' +
            '<span class="ob-live"><i class="dot"></i><span class="ob-live-text">Đang kết nối realtime…</span></span></div>' +
          '<div class="ob-price"><b class="ob-last">—</b><span class="ob-chg"></span></div>' +
        '</div>' +
        '<table class="ob-book">' +
          '<thead><tr><th class="num">KL mua</th><th class="num">Giá mua</th><th class="num">Giá bán</th><th class="num">KL bán</th></tr></thead>' +
          '<tbody class="ob-levels"></tbody>' +
        '</table>' +
        '<div class="ob-sub">Khớp lệnh</div>' +
        '<div class="ob-trades-scroll">' +
          '<table class="ob-trades">' +
            '<thead><tr><th>Thời gian</th><th class="num">Giá</th><th class="num">+/-</th><th class="num">KL</th><th class="num">M/B</th></tr></thead>' +
            '<tbody class="ob-trade-rows"></tbody>' +
          '</table>' +
        '</div>' +
        '<dl class="ob-sum">' +
          '<div><dt>Tổng KL khớp</dt><dd class="ob-total">—</dd></div>' +
          '<div><dt>KL mua chủ động<sup>*</sup></dt><dd class="ob-buy up">—</dd></div>' +
          '<div><dt>KL bán chủ động<sup>*</sup></dt><dd class="ob-sell down">—</dd></div>' +
        '</dl>' +
        '<p class="ob-note">* Cộng từ các lệnh khớp nhận được kể từ khi mở trang/đổi mã. ' +
          'Nguồn realtime: bảng giá SSI (không chính thức), có thể gián đoạn.</p>';
      this.q = (sel) => root.querySelector(sel);
      this.frame = 0;
      this.reset(null);
    }

    // Đổi mã: xóa sổ lệnh cũ.
    reset(symbol) {
      this.symbol = symbol;
      this.quote = null;
      this.trades = [];
      this.lastTotal = null;
      this.buy = 0;
      this.sell = 0;
      this.fallback = null;
      this._render();
    }

    // Nến ngày của mã đang xem: hiện giá tham khảo trong lúc chờ (hoặc khi không có) realtime.
    setFallback(symbol, bars) {
      if (symbol !== this.symbol || !bars || bars.length < 2) return;
      const last = bars[bars.length - 1], prev = bars[bars.length - 2];
      this.fallback = { price: last.close, change: last.close - prev.close, totalVol: last.volume };
      this._render();
    }

    setStatus(s) {
      const st = STATUS[s] || STATUS.closed;
      this.q('.ob-live .dot').className = 'dot ' + st[0];
      this.q('.ob-live-text').textContent = st[1];
    }

    push(q) {
      if (q.symbol !== this.symbol) return;
      // Tổng KL tăng = có lệnh khớp mới.
      if (q.vol > 0 && q.price > 0 && (this.lastTotal == null || q.totalVol > this.lastTotal)) {
        this.trades.unshift({ time: q.time, price: q.price, change: q.change, vol: q.vol, side: q.side, ref: q.price - q.change });
        if (this.trades.length > MAX_TRADES) this.trades.length = MAX_TRADES;
        if (q.side === 'M') this.buy += q.vol;
        else if (q.side === 'B') this.sell += q.vol;
      }
      if (q.totalVol) this.lastTotal = q.totalVol;
      this.quote = q;
      if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this._render(); });
    }

    _render() {
      const q = this.quote;
      const fb = this.fallback;
      this.q('.ob-sym').textContent = this.symbol || '—';

      const price = q && q.price > 0 ? q.price : fb ? fb.price : null;
      const change = q && q.price > 0 ? q.change : fb ? fb.change : 0;
      const ref = price != null ? price - change : null;
      const cls = colorOf(price, ref);
      const last = this.q('.ob-last');
      last.textContent = price != null ? VST.fmtPrice(price) : '—';
      last.className = 'ob-last ' + cls;
      const chg = this.q('.ob-chg');
      chg.className = 'ob-chg ' + cls;
      chg.textContent = price != null
        ? sign(change) + VST.fmtPrice(change) + ' / ' + sign(change) + VST.fmtPct(ref ? (change / ref) * 100 : 0) + '%'
        : '';

      // 3 bước giá: thanh nền dài theo khối lượng.
      const levels = [0, 1, 2].map(function (i) {
        return { bid: q ? q.bids[i] : null, ask: q ? q.asks[i] : null };
      });
      const maxVol = Math.max(1, ...levels.map((l) => Math.max(l.bid ? l.bid.vol : 0, l.ask ? l.ask.vol : 0)));
      const cell = function (lv, side) {
        if (!lv || !(lv.price > 0)) return '<td class="num dim">—</td><td class="num"></td>';
        const w = Math.round((lv.vol / maxVol) * 100);
        const c = colorOf(lv.price, ref);
        const volTd = '<td class="num">' + fmtVol(lv.vol) + '</td>';
        const priceTd = '<td class="num ob-lv ' + c + '"><span class="ob-bar ob-bar-' + side + '" style="width:' + w + '%"></span>' +
          '<b>' + VST.fmtPrice(lv.price) + '</b></td>';
        return side === 'bid' ? volTd + priceTd : priceTd + volTd;
      };
      this.q('.ob-levels').innerHTML = levels.map(function (l) {
        return '<tr>' + cell(l.bid, 'bid') + cell(l.ask, 'ask') + '</tr>';
      }).join('');

      this.q('.ob-trade-rows').innerHTML = this.trades.length
        ? this.trades.map(function (t) {
          const c = colorOf(t.price, t.ref);
          return '<tr><td>' + fmtClock(t.time) + '</td>' +
            '<td class="num ' + c + '">' + VST.fmtPrice(t.price) + '</td>' +
            '<td class="num ' + c + '">' + sign(t.change) + VST.fmtPrice(t.change) + '</td>' +
            '<td class="num">' + fmtVol(t.vol) + '</td>' +
            '<td class="num ' + (t.side === 'M' ? 'up' : t.side === 'B' ? 'down' : 'dim') + '">' + (esc(t.side) || '—') + '</td></tr>';
        }).join('')
        : '<tr><td colspan="5" class="dim center">Chưa có lệnh khớp mới (ngoài giờ giao dịch hoặc đang chờ dữ liệu).</td></tr>';

      const total = q && q.totalVol ? q.totalVol : fb ? fb.totalVol : null;
      this.q('.ob-total').textContent = total != null ? fmtVol(total) : '—';
      this.q('.ob-buy').textContent = this.trades.length ? fmtVol(this.buy) : '—';
      this.q('.ob-sell').textContent = this.trades.length ? fmtVol(this.sell) : '—';
    }
  }

  function colorOf(price, ref) {
    if (price == null || ref == null) return '';
    const d = Math.round((price - ref) * 1000);
    return d > 0 ? 'up' : d < 0 ? 'down' : 'ref';
  }
  function sign(v) { return v > 0.0005 ? '+' : ''; }
  function fmtVol(v) { return Math.round(v).toLocaleString('vi-VN'); }
  function fmtClock(t) {
    const d = new Date((t + 7 * 3600) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
  }

  VST.OrderBook = OrderBook;
})();
