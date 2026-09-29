// Vẽ biểu đồ nến + chỉ báo bằng Lightweight Charts v4.
// Biểu đồ chính: nến, khối lượng, MA, Bollinger. RSI và MACD là hai khung riêng đồng bộ cuộn.
window.VST = window.VST || {};

(function () {
  const LWC = window.LightweightCharts;
  const VN_OFFSET = 7 * 3600; // hiển thị theo giờ Việt Nam

  const css = getComputedStyle(document.documentElement);
  const color = function (name) { return css.getPropertyValue(name).trim(); };
  const C = {
    bg: color('--bg-panel'), text: color('--text-dim'), grid: color('--grid'),
    up: color('--up'), down: color('--down'),
    ma20: color('--ma20'), ma50: color('--ma50'), ma200: color('--ma200'),
    bb: color('--bb'), rsi: color('--rsi'), macd: color('--macd'), signal: color('--signal'),
  };

  function baseOptions(extra) {
    return Object.assign({
      autoSize: true,
      layout: { background: { type: 'solid', color: C.bg }, textColor: C.text, fontSize: 11 },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.grid, minimumWidth: 56 },
      timeScale: { borderColor: C.grid, rightOffset: 3 },
      crosshair: { mode: LWC.CrosshairMode.Normal },
      localization: { locale: 'vi-VN', priceFormatter: fmtPrice },
      handleScale: { axisPressedMouseMove: { time: true, price: false } },
    }, extra || {});
  }

  function fmtPrice(p) {
    return p.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  class ChartView {
    constructor(els) {
      this.els = els; // { main, rsi, macd, legend }
      this.bars = [];

      this.main = LWC.createChart(els.main, baseOptions());
      this.candles = this.main.addCandlestickSeries({
        upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down,
        wickUpColor: C.up, wickDownColor: C.down,
      });
      this.volume = this.main.addHistogramSeries({
        priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false,
      });
      this.main.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      const line = (c, w) => this.main.addLineSeries({
        color: c, lineWidth: w || 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
      });
      this.ma20 = line(C.ma20);
      this.ma50 = line(C.ma50);
      this.ma200 = line(C.ma200, 2);
      this.bbUpper = line(C.bb);
      this.bbMid = line(C.bb);
      this.bbLower = line(C.bb);
      this.bbMid.applyOptions({ lineStyle: LWC.LineStyle.Dashed });

      // Logo TradingView (ghi công theo giấy phép) chỉ hiện ở biểu đồ chính.
      const sub = baseOptions({ timeScale: { visible: false, borderColor: C.grid, rightOffset: 3 } });
      sub.layout = Object.assign({}, sub.layout, { attributionLogo: false });

      this.rsiChart = LWC.createChart(els.rsi, sub);
      this.rsi = this.rsiChart.addLineSeries({ color: C.rsi, lineWidth: 1, priceLineVisible: false });
      [70, 30].forEach((v) => this.rsi.createPriceLine({
        price: v, color: C.text, lineWidth: 1, lineStyle: LWC.LineStyle.Dotted, axisLabelVisible: false,
      }));

      this.macdChart = LWC.createChart(els.macd, sub);
      this.macdHist = this.macdChart.addHistogramSeries({ lastValueVisible: false, priceLineVisible: false });
      this.macdLine = this.macdChart.addLineSeries({ color: C.macd, lineWidth: 1, priceLineVisible: false });
      this.macdSignal = this.macdChart.addLineSeries({ color: C.signal, lineWidth: 1, priceLineVisible: false });

      this._syncTimeScales([this.main, this.rsiChart, this.macdChart]);
      this.main.subscribeCrosshairMove((p) => this._updateLegend(p));
    }

    _syncTimeScales(charts) {
      let busy = false;
      charts.forEach((src) => {
        src.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (busy || !range) return;
          busy = true;
          charts.forEach((dst) => { if (dst !== src) dst.timeScale().setVisibleLogicalRange(range); });
          busy = false;
        });
      });
    }

    // bars: dữ liệu từ data.js; tf: khung thời gian; keepView: giữ vị trí cuộn khi làm mới.
    setData(bars, tf, keepView) {
      const prevLen = this.bars.length;
      const prevRange = keepView ? this.main.timeScale().getVisibleLogicalRange() : null;
      this.bars = bars;
      this.tf = tf;

      const times = bars.map((b) => b.time + VN_OFFSET);
      const closes = bars.map((b) => b.close);
      const toLine = (arr) => arr.map((v, i) => (v == null ? { time: times[i] } : { time: times[i], value: v }));

      this.candles.setData(bars.map((b, i) => ({ time: times[i], open: b.open, high: b.high, low: b.low, close: b.close })));
      this.volume.setData(bars.map((b, i) => ({
        time: times[i], value: b.volume,
        color: (b.close >= b.open ? C.up : C.down) + '66',
      })));

      const ind = VST.indicators;
      this.ma20.setData(toLine(ind.sma(closes, 20)));
      this.ma50.setData(toLine(ind.sma(closes, 50)));
      this.ma200.setData(toLine(ind.sma(closes, 200)));
      const bb = ind.bollinger(closes, 20, 2);
      this.bbUpper.setData(toLine(bb.upper));
      this.bbMid.setData(toLine(bb.mid));
      this.bbLower.setData(toLine(bb.lower));

      this.rsi.setData(toLine(ind.rsi(closes, 14)));
      const m = ind.macd(closes, 12, 26, 9);
      this.macdLine.setData(toLine(m.macd));
      this.macdSignal.setData(toLine(m.signal));
      this.macdHist.setData(m.hist.map((v, i) => (v == null ? { time: times[i] } : {
        time: times[i], value: v, color: (v >= 0 ? C.up : C.down) + 'aa',
      })));

      const opts = { timeScale: { timeVisible: !!tf.intraday, secondsVisible: false } };
      this.main.applyOptions(opts);

      if (prevRange && prevLen) {
        const shift = bars.length - prevLen;
        this.main.timeScale().setVisibleLogicalRange({ from: prevRange.from + shift, to: prevRange.to + shift });
      } else {
        // Mặc định hiển thị ~120 nến gần nhất (ít hơn trên màn hình hẹp).
        const n = window.innerWidth < 600 ? 60 : 120;
        this.main.timeScale().setVisibleLogicalRange({ from: bars.length - n, to: bars.length + 2 });
      }
      this._updateLegend(null);
    }

    setIndicators(on) {
      this.ma20.applyOptions({ visible: !!on.ma20 });
      this.ma50.applyOptions({ visible: !!on.ma50 });
      this.ma200.applyOptions({ visible: !!on.ma200 });
      [this.bbUpper, this.bbMid, this.bbLower].forEach((s) => s.applyOptions({ visible: !!on.bb }));
      this.els.rsi.parentElement.hidden = !on.rsi;
      this.els.macd.parentElement.hidden = !on.macd;
      // Đồng bộ lại vùng nhìn cho khung vừa hiện ra.
      const r = this.main.timeScale().getVisibleLogicalRange();
      if (r) {
        this.rsiChart.timeScale().setVisibleLogicalRange(r);
        this.macdChart.timeScale().setVisibleLogicalRange(r);
      }
    }

    _updateLegend(param) {
      const el = this.els.legend;
      if (!this.bars.length) { el.textContent = ''; return; }
      let idx = this.bars.length - 1;
      if (param && param.logical != null && param.logical >= 0 && param.logical < this.bars.length) {
        idx = Math.round(param.logical);
      }
      const b = this.bars[idx];
      const prev = this.bars[idx - 1];
      const chg = prev ? b.close - prev.close : 0;
      const pct = prev && prev.close ? (chg / prev.close) * 100 : 0;
      const cls = chg > 0 ? 'up' : chg < 0 ? 'down' : 'ref';
      el.innerHTML =
        '<span class="lg-time">' + fmtTime(b.time, this.tf) + '</span>' +
        '<span>M <b>' + fmtPrice(b.open) + '</b></span>' +
        '<span>C <b>' + fmtPrice(b.high) + '</b></span>' +
        '<span>T <b>' + fmtPrice(b.low) + '</b></span>' +
        '<span>Đ <b class="' + cls + '">' + fmtPrice(b.close) + '</b></span>' +
        '<span class="' + cls + '">' + (chg > 0 ? '+' : '') + fmtPrice(chg) + ' (' + (chg > 0 ? '+' : '') + VST.fmtPct(pct) + '%)</span>' +
        '<span>KL <b>' + VST.fmtVolume(b.volume) + '</b></span>';
    }
  }

  function fmtTime(t, tf) {
    const d = new Date((t + VN_OFFSET) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    const date = p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
    return tf && tf.intraday ? date + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) : date;
  }

  VST.fmtPrice = fmtPrice;
  VST.fmtPct = function (v) { return v.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  VST.fmtVolume = function (v) {
    if (v >= 1e9) return (v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tỷ';
    if (v >= 1e6) return (v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tr';
    if (v >= 1e3) return (v / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' N';
    return v.toLocaleString('vi-VN');
  };
  VST.ChartView = ChartView;
})();
