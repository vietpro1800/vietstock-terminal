// Biểu đồ trang backtest (Lightweight Charts v4): nến có điểm mua/bán và biểu đồ đường vốn.
// Dashboard dùng KLineChart (js/chart.js); trang này giữ Lightweight Charts. Cần nạp sau chart.js.
window.VST = window.VST || {};

(function () {
  const LWC = window.LightweightCharts;
  const VN_OFFSET = 7 * 3600; // hiển thị theo giờ Việt Nam

  const css = getComputedStyle(document.documentElement);
  const color = function (name) { return css.getPropertyValue(name).trim(); };
  const C = {
    bg: color('--bg-panel'), text: color('--text-dim'), grid: color('--grid'),
    up: color('--up'), down: color('--down'),
    btStrategy: color('--bt-strategy'), btHold: color('--bt-hold'), btIndex: color('--bt-index'),
  };

  function baseOptions(extra) {
    return Object.assign({
      autoSize: true,
      layout: { background: { type: 'solid', color: C.bg }, textColor: C.text, fontSize: 11 },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.grid, minimumWidth: 56 },
      timeScale: { borderColor: C.grid, rightOffset: 3 },
      crosshair: { mode: LWC.CrosshairMode.Normal },
      localization: { locale: 'vi-VN', priceFormatter: (p) => VST.fmtPrice(p) },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    }, extra || {});
  }

  class BacktestChartView {
    constructor(els) {
      this.els = els; // { candles, equity }
      this.main = LWC.createChart(els.candles, baseOptions());
      this.candles = this.main.addCandlestickSeries({
        upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down,
        wickUpColor: C.up, wickDownColor: C.down,
      });

      const eqOpts = baseOptions({ localization: { locale: 'vi-VN' } });
      eqOpts.layout = Object.assign({}, eqOpts.layout, { attributionLogo: false });
      this.eqChart = LWC.createChart(els.equity, eqOpts);
      const money = { type: 'custom', minMove: 1, formatter: fmtMoneyShort };
      const line = (c, w) => this.eqChart.addLineSeries({ color: c, lineWidth: w, priceFormat: money, priceLineVisible: false });
      this.eqIndex = line(C.btIndex, 1);
      this.eqHold = line(C.btHold, 1);
      this.eqStrategy = line(C.btStrategy, 2);
    }

    // data: { bars, trades, strategy, hold, index } — bars và các đường vốn chỉ trong khoảng backtest.
    setData(data) {
      const t = (x) => x + VN_OFFSET;
      this.candles.setData(data.bars.map((b) => ({ time: t(b.time), open: b.open, high: b.high, low: b.low, close: b.close })));
      const markers = [];
      const label = data.trades.length <= 15; // nhiều giao dịch thì chỉ vẽ mũi tên cho đỡ rối
      data.trades.forEach(function (tr) {
        markers.push({ time: t(tr.entryTime), position: 'belowBar', color: C.up, shape: 'arrowUp', text: label ? 'Mua' : '' });
        if (!tr.open) markers.push({ time: t(tr.exitTime), position: 'aboveBar', color: C.down, shape: 'arrowDown', text: label ? 'Bán' : '' });
      });
      markers.sort((a, b) => a.time - b.time);
      this.candles.setMarkers(markers);
      this.main.timeScale().fitContent();

      const toLine = (arr) => (arr || []).map((e) => ({ time: t(e.time), value: e.value }));
      this.eqStrategy.setData(toLine(data.strategy));
      this.eqHold.setData(toLine(data.hold));
      this.eqIndex.setData(toLine(data.index));
      this.eqChart.timeScale().fitContent();
    }
  }

  // 125000000 → "125 tr", 1,2 tỷ → "1,2 tỷ".
  function fmtMoneyShort(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tỷ';
    if (a >= 1e6) return (v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' tr';
    return Math.round(v).toLocaleString('vi-VN');
  }

  VST.BacktestChartView = BacktestChartView;
})();
