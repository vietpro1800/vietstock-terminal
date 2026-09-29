// Bảng giá các mã lớn, dựa trên nến ngày gần nhất.
window.VST = window.VST || {};

(function () {
  // Chỉ cần vài phiên gần nhất để tính giá, thay đổi và khối lượng.
  const BOARD_TF = { label: 'Ngày', resolution: 'D', days: 15 };

  class PriceBoard {
    constructor(tbody, source, onSelect) {
      this.tbody = tbody;
      this.source = source;
      this.onSelect = onSelect;
      this.active = null;
      tbody.addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-symbol]');
        if (tr) this.onSelect(tr.dataset.symbol);
      });
    }

    // Trả về danh sách lỗi (nếu có) để app hiển thị thông báo.
    async refresh(symbols) {
      const res = await this.source.getHistoryBatch(symbols, BOARD_TF);
      const rows = [];
      const errors = [];
      symbols.forEach((sym) => {
        const r = res[sym];
        if (r.error) { errors.push(r.error); rows.push(errorRow(sym, r.error)); return; }
        rows.push(dataRow(sym, r.bars));
      });
      this.tbody.innerHTML = rows.join('');
      this.setActive(this.active);
      return errors;
    }

    setActive(symbol) {
      this.active = symbol;
      this.tbody.querySelectorAll('tr').forEach((tr) => {
        tr.classList.toggle('active', tr.dataset.symbol === symbol);
      });
    }
  }

  function dataRow(sym, bars) {
    const last = bars[bars.length - 1];
    const prev = bars[bars.length - 2];
    const chg = prev ? last.close - prev.close : 0;
    const pct = prev && prev.close ? (chg / prev.close) * 100 : 0;
    const cls = chg > 0 ? 'up' : chg < 0 ? 'down' : 'ref';
    const sign = chg > 0 ? '+' : '';
    return '<tr data-symbol="' + sym + '">' +
      '<td class="sym ' + cls + '">' + sym + '</td>' +
      '<td class="num ' + cls + '">' + VST.fmtPrice(last.close) + '</td>' +
      '<td class="num ' + cls + '">' + sign + VST.fmtPrice(chg) + '</td>' +
      '<td class="num ' + cls + '">' + sign + VST.fmtPct(pct) + '%</td>' +
      '<td class="num vol">' + VST.fmtVolume(last.volume) + '</td>' +
      '</tr>';
  }

  function errorRow(sym, err) {
    return '<tr data-symbol="' + sym + '" title="' + escapeAttr(err.message) + '">' +
      '<td class="sym">' + sym + '</td>' +
      '<td class="num dim" colspan="4">Lỗi tải dữ liệu</td>' +
      '</tr>';
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  VST.PriceBoard = PriceBoard;
})();
