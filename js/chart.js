// Biểu đồ kỹ thuật của dashboard bằng KLineChart v10 (Apache-2.0).
// Một biểu đồ nhiều khung: nến + MA + Bollinger ở khung chính; khối lượng, RSI, MACD ở các khung phụ bên dưới.
// Chỉ báo tính bằng VST.indicators (cùng công thức với trang backtest). Có công cụ vẽ, hình vẽ lưu theo mã.
// Thư viện không tự gọi mạng: nến do app.js tải qua data.js rồi đưa vào setData().
// Cũng chứa các hàm định dạng dùng chung (VST.fmtPrice, fmtPct, fmtVolume, fmtDate).
window.VST = window.VST || {};

(function () {
  const KC = window.klinecharts;
  const TIMEZONE = 'Asia/Ho_Chi_Minh';
  const VN_OFFSET = 7 * 3600; // Việt Nam UTC+7, không đổi giờ theo mùa
  const CANDLE_PANE = 'candle_pane';
  const DRAW_GROUP = 'drawings';
  const DRAW_KEY = 'vst.drawings.v1';

  const css = getComputedStyle(document.documentElement);
  const color = function (name) { return css.getPropertyValue(name).trim(); };
  // Trang có thể đặt màu riêng cho vùng biểu đồ (--chart-*), ví dụ biểu đồ nền trắng của dashboard.
  const chartColor = (name, fallback) => color(name) || color(fallback);
  const C = {
    text: chartColor('--chart-text', '--text'), dim: chartColor('--chart-dim', '--text-dim'),
    grid: chartColor('--chart-grid', '--grid'), border: chartColor('--chart-border', '--border'),
    active: chartColor('--chart-active', '--bg-active'), accent: color('--accent'),
    up: color('--up'), down: color('--down'), ref: color('--ref'),
    ma20: color('--ma20'), ma50: color('--ma50'), ma200: color('--ma200'),
    bb: color('--bb'), rsi: color('--rsi'), macd: color('--macd'), signal: color('--signal'),
    rsiBand: color('--chart-rsi-band'), // nền vùng RSI 30–70 (bỏ trống = không tô)
    markText: chartColor('--chart-mark-text', '--text'), // chữ trên nhãn giá trị chỉ báo
  };

  // Khung phụ: thứ tự từ trên xuống và chiều cao (px).
  const SUB_PANES = {
    vol: { id: 'pane_vol', indicator: 'VST_VOL', order: 1, height: 64 },
    rsi: { id: 'pane_rsi', indicator: 'VST_RSI', order: 2, height: 90 },
    macd: { id: 'pane_macd', indicator: 'VST_MACD', order: 3, height: 100 },
  };

  // Công cụ vẽ (tên overlay có sẵn của KLineChart). full: chỉ hiện ở bộ công cụ đầy đủ (trang Biểu đồ).
  // icon: nét vẽ SVG 20×20 cho thanh công cụ dọc.
  const TOOLS = [
    { name: 'segment', label: 'Xu hướng', title: 'Đường xu hướng: chạm 2 điểm', icon: 'M4 16L16 4M4 16h0M16 4h0' },
    { name: 'rayLine', label: 'Tia', title: 'Tia: chạm điểm gốc rồi điểm hướng', icon: 'M4 16L17 3M13 3h4v4' },
    { name: 'straightLine', label: 'Đường thẳng', title: 'Đường thẳng kéo dài hai phía: chạm 2 điểm', icon: 'M2 18L18 2', full: true },
    { name: 'horizontalStraightLine', label: 'Ngang', title: 'Đường ngang (hỗ trợ / kháng cự): chạm 1 điểm', icon: 'M2 10h16' },
    { name: 'priceLine', label: 'Mốc giá', title: 'Mốc giá có nhãn: chạm 1 điểm', icon: 'M2 13h9M11 10h7v6h-7z', full: true },
    { name: 'verticalStraightLine', label: 'Dọc', title: 'Đường dọc đánh dấu thời điểm: chạm 1 điểm', icon: 'M10 2v16', full: true },
    { name: 'parallelStraightLine', label: 'Kênh', title: 'Kênh song song: chạm 3 điểm', icon: 'M2 13L13 2M7 18L18 7', full: true },
    { name: 'priceChannelLine', label: 'Kênh giá', title: 'Kênh giá: chạm 3 điểm', icon: 'M2 14L14 2M6 18L18 6M4 16L16 4', full: true },
    { name: 'fibonacciLine', label: 'Fibo', title: 'Fibonacci thoái lui: chạm đỉnh rồi đáy', icon: 'M2 4h16M2 8h16M2 12h16M2 16h16' },
  ];
  const ICON_CLEAR = 'M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11';

  // decimals: số chữ số thập phân (mặc định 2; tỷ giá cần 4).
  function fmtPrice(p, decimals) {
    const d = decimals == null ? 2 : decimals;
    return p.toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function fmtVolume(v) {
    if (v >= 1e9) return (v / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tỷ';
    if (v >= 1e6) return (v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 }) + ' tr';
    if (v >= 1e3) return (v / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + ' N';
    return v.toLocaleString('vi-VN');
  }

  // t: Unix giây (UTC). Trả về ngày (và giờ nếu khung trong ngày) theo giờ Việt Nam.
  function fmtTime(t, tf) {
    const d = new Date((t + VN_OFFSET) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    const date = p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear();
    return tf && tf.intraday ? date + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) : date;
  }

  // ---------- Thiết lập KLineChart (chỉ khi thư viện đã nạp) ----------

  // KLineChart đưa số dạng "1234.5" (có thể kèm chữ); đổi sang kiểu Việt Nam "1.234,5".
  function viNumber(value) {
    const s = String(value);
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) return s;
    return m[1] + m[2].replace(/\B(?=(\d{3})+$)/g, '.') + (m[3] ? ',' + m[3] : '');
  }

  // Ngày giờ theo kiểu Việt Nam. Trục thời gian dùng dạng gọn để không chồng chữ trên màn hẹp.
  function formatDate(params) {
    const d = new Date(params.timestamp + VN_OFFSET * 1000);
    const p = (n) => String(n).padStart(2, '0');
    const day = p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1);
    const year = String(d.getUTCFullYear());
    const time = p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    const tpl = params.template;
    const hasTime = tpl.indexOf('HH') >= 0;
    if (params.type === 'xAxis') {
      if (tpl === 'HH:mm') return time;
      if (hasTime) return day + ' ' + time;
      if (tpl === 'YYYY') return year;
      if (tpl === 'YYYY-MM') return p(d.getUTCMonth() + 1) + '/' + year;
      return day + '/' + year.slice(2);
    }
    return day + '/' + year + (hasTime ? ' ' + time : '');
  }

  // Dữ liệu chỉ báo: bỏ trống (không vẽ) khi chưa đủ số nến.
  function pack(keys, series, i) {
    const o = {};
    keys.forEach(function (k, j) { if (series[j][i] != null) o[k] = series[j][i]; });
    return o;
  }

  const closesOf = (list) => list.map((d) => d.close);
  const alpha = (hex, a) => hex + a; // biến màu là mã hex 6 ký tự

  function registerAll() {
    KC.registerLocale('vi-VN', {
      time: 'Thời gian: ', open: 'Mở: ', high: 'Cao: ', low: 'Thấp: ', close: 'Đóng: ',
      volume: 'KL: ', turnover: 'GTGD: ', change: 'Thay đổi: ',
      second: 'giây', minute: 'phút', hour: 'giờ', day: 'ngày', week: 'tuần', month: 'tháng', year: 'năm',
    });

    // Đường trung bình động. calcParams là danh sách chu kỳ đang bật, ví dụ [20, 50].
    const maFigures = (params) => params.map((p, i) => ({ key: 'ma' + i, title: 'MA' + p + ': ', type: 'line' }));
    KC.registerIndicator({
      name: 'VST_MA', shortName: 'MA', series: 'price', calcParams: [20], figures: maFigures([20]),
      regenerateFigures: maFigures,
      calc: function (list, ind) {
        const closes = closesOf(list);
        const keys = ind.calcParams.map((_, i) => 'ma' + i);
        const series = ind.calcParams.map((p) => VST.indicators.sma(closes, p));
        return list.map((_, i) => pack(keys, series, i));
      },
    });

    KC.registerIndicator({
      name: 'VST_BOLL', shortName: 'BOLL', series: 'price', calcParams: [20, 2],
      figures: [
        { key: 'upper', title: 'BB trên: ', type: 'line' },
        { key: 'mid', title: 'BB giữa: ', type: 'line' },
        { key: 'lower', title: 'BB dưới: ', type: 'line' },
      ],
      calc: function (list, ind) {
        const bb = VST.indicators.bollinger(closesOf(list), ind.calcParams[0], ind.calcParams[1]);
        return list.map((_, i) => pack(['upper', 'mid', 'lower'], [bb.upper, bb.mid, bb.lower], i));
      },
    });

    KC.registerIndicator({
      name: 'VST_VOL', shortName: 'KL', series: 'volume', precision: 0, minValue: 0, shouldFormatBigNumber: true,
      figures: [{
        key: 'volume', title: 'KL: ', type: 'bar', baseValue: 0,
        styles: function (p) {
          const d = p.data.current;
          const c = !d ? C.ref : d.close > d.open ? C.up : d.close < d.open ? C.down : C.ref;
          return { style: 'fill', color: alpha(c, '88') };
        },
      }],
      calc: (list) => list.map((d) => ({ volume: d.volume || 0, open: d.open, close: d.close })),
    });

    // RSI (Wilder) kèm hai mốc 70 / 30.
    KC.registerIndicator({
      name: 'VST_RSI', shortName: 'RSI', precision: 2, minValue: 0, maxValue: 100, calcParams: [14],
      figures: [{ key: 'rsi', title: 'RSI14: ', type: 'line' }],
      regenerateFigures: (params) => [{ key: 'rsi', title: 'RSI' + params[0] + ': ', type: 'line' }],
      calc: function (list, ind) {
        const r = VST.indicators.rsi(closesOf(list), ind.calcParams[0]);
        return list.map((_, i) => pack(['rsi'], [r], i));
      },
      draw: function (p) {
        const ctx = p.ctx;
        if (C.rsiBand) {
          const y70 = p.yAxis.convertToPixel(70), y30 = p.yAxis.convertToPixel(30);
          ctx.fillStyle = C.rsiBand;
          ctx.fillRect(0, y70, p.bounding.width, y30 - y70);
        }
        ctx.strokeStyle = C.dim;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        [70, 30].forEach(function (v) {
          const y = Math.round(p.yAxis.convertToPixel(v)) + 0.5;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(p.bounding.width, y);
          ctx.stroke();
        });
        return false; // vẫn để thư viện vẽ đường RSI
      },
    });

    // Volume profile: khối lượng theo vùng giá của các nến đang nhìn thấy, vẽ thành cột ngang sát mép phải.
    // Phần tăng (đóng ≥ mở) và giảm xếp chồng. Không có số liệu riêng nên calc trả về rỗng.
    KC.registerIndicator({
      name: 'VST_VP', shortName: 'VP', series: 'price', calcParams: [40], figures: [],
      calc: (list) => list.map(() => ({})),
      draw: function (p) {
        const list = p.chart.getDataList();
        const range = p.chart.getVisibleRange();
        const from = Math.max(0, range.realFrom), to = Math.min(list.length, range.realTo);
        if (to - from < 2) return true;
        let lo = Infinity, hi = -Infinity;
        for (let i = from; i < to; i++) { lo = Math.min(lo, list[i].low); hi = Math.max(hi, list[i].high); }
        const n = p.indicator.calcParams[0];
        const step = (hi - lo) / n;
        if (!(step > 0)) return true;
        const up = new Array(n).fill(0), down = new Array(n).fill(0);
        for (let i = from; i < to; i++) {
          const b = list[i];
          const k = Math.min(n - 1, Math.floor(((b.high + b.low + b.close) / 3 - lo) / step));
          if (b.close >= b.open) up[k] += b.volume || 0; else down[k] += b.volume || 0;
        }
        const max = Math.max.apply(null, up.map((v, k) => v + down[k]));
        if (!(max > 0)) return true;
        const ctx = p.ctx;
        const W = p.bounding.width, maxW = W * 0.22;
        for (let k = 0; k < n; k++) {
          const y1 = p.yAxis.convertToPixel(lo + (k + 1) * step), y0 = p.yAxis.convertToPixel(lo + k * step);
          const h = Math.max(1, Math.abs(y0 - y1) - 1);
          const wu = (up[k] / max) * maxW, wd = (down[k] / max) * maxW;
          ctx.fillStyle = alpha(C.up, '66');
          ctx.fillRect(W - wu - wd, Math.min(y0, y1), wu, h);
          ctx.fillStyle = alpha(C.down, '66');
          ctx.fillRect(W - wd, Math.min(y0, y1), wd, h);
        }
        return true;
      },
    });

    KC.registerIndicator({
      name: 'VST_MACD', shortName: 'MACD', precision: 2, calcParams: [12, 26, 9],
      figures: [
        { key: 'macd', title: 'MACD: ', type: 'line' },
        { key: 'signal', title: 'Tín hiệu: ', type: 'line' },
        {
          key: 'hist', title: 'Hist: ', type: 'bar', baseValue: 0,
          styles: function (p) {
            const v = p.data.current && p.data.current.hist;
            return { style: 'fill', color: alpha(v >= 0 ? C.up : C.down, 'aa') };
          },
        },
      ],
      calc: function (list, ind) {
        const m = VST.indicators.macd(closesOf(list), ind.calcParams[0], ind.calcParams[1], ind.calcParams[2]);
        return list.map((_, i) => pack(['macd', 'signal', 'hist'], [m.macd, m.signal, m.hist], i));
      },
    });
  }

  // valueMarks: hiện nhãn giá trị cuối của chỉ báo (MA, BB…) trên trục giá, như TradingView/FireAnt.
  function chartStyles(valueMarks) {
    const axis = {
      axisLine: { color: C.grid }, tickLine: { color: C.grid },
      tickText: { color: C.dim, size: 11 },
    };
    const crossDir = {
      line: { color: C.dim, dashedValue: [4, 3] },
      text: { color: C.text, backgroundColor: C.active, borderColor: C.active, size: 11 },
    };
    return {
      grid: { horizontal: { color: C.grid }, vertical: { color: C.grid } },
      candle: {
        bar: {
          compareRule: 'current_open',
          upColor: C.up, downColor: C.down, noChangeColor: C.ref,
          upBorderColor: C.up, downBorderColor: C.down, noChangeBorderColor: C.ref,
          upWickColor: C.up, downWickColor: C.down, noChangeWickColor: C.ref,
        },
        priceMark: {
          high: { color: C.dim }, low: { color: C.dim },
          last: { compareRule: 'previous_close', upColor: C.up, downColor: C.down, noChangeColor: C.ref },
        },
        tooltip: { showRule: 'none' }, // dùng dòng thông tin tiếng Việt phía trên biểu đồ
      },
      indicator: {
        // Tên chỉ báo đã nằm trong từng nhãn (MA20:, RSI14:, MACD:…) nên tắt dòng tên riêng.
        tooltip: { showRule: 'always', title: { showName: false, showParams: false }, legend: { color: C.dim } },
        lastValueMark: { show: !!valueMarks, text: { show: !!valueMarks, color: C.markText, size: 11 } },
      },
      xAxis: axis,
      yAxis: axis,
      separator: { color: C.border, activeBackgroundColor: alpha(C.accent, '33') },
      crosshair: { horizontal: crossDir, vertical: crossDir },
      overlay: {
        point: {
          color: C.accent, borderColor: alpha(C.accent, '55'),
          activeColor: C.accent, activeBorderColor: alpha(C.accent, '88'), radius: 5, activeRadius: 6,
        },
        line: { color: C.accent, size: 1 },
        text: { color: C.text, size: 11 },
        rect: { color: alpha(C.accent, '18'), borderColor: C.accent },
        polygon: { color: alpha(C.accent, '18'), borderColor: C.accent },
      },
    };
  }

  function periodOf(tf) {
    if (tf.aggregate === 'week') return { type: 'week', span: 1 };
    if (tf.resolution === '15') return { type: 'minute', span: 15 };
    if (tf.resolution === '60') return { type: 'hour', span: 1 };
    return { type: 'day', span: 1 };
  }

  // ---------- Hình vẽ lưu trên trình duyệt này, theo từng mã ----------

  function loadDrawings(symbol) {
    try {
      const all = JSON.parse(localStorage.getItem(DRAW_KEY)) || {};
      return Array.isArray(all[symbol]) ? all[symbol] : [];
    } catch (e) { return []; }
  }

  function saveDrawings(symbol, list) {
    try {
      const all = JSON.parse(localStorage.getItem(DRAW_KEY)) || {};
      if (list.length) all[symbol] = list; else delete all[symbol];
      localStorage.setItem(DRAW_KEY, JSON.stringify(all));
    } catch (e) { /* bỏ qua: chế độ ẩn danh hoặc bị chặn lưu trữ */ }
  }

  // ---------- Biểu đồ dashboard ----------

  class ChartView {
    // els: { main, legend, tools }
    // opts (tùy chọn): { toolset: 'full' — đủ bộ công cụ vẽ, dạng icon; valueMarks: true — nhãn giá trị chỉ báo trên trục }
    constructor(els, opts) {
      this.els = els;
      this.opts = opts || {};
      this.decimals = 2;
      this.symbol = null;
      this.tf = null;
      this.on = {};
      this._pending = [];
      this._push = null;
      this._selected = null;
      this._drawing = null; // { id, name } khi đang vẽ dở

      this.chart = KC.init(els.main, {
        locale: 'vi-VN',
        timezone: TIMEZONE,
        styles: chartStyles(this.opts.valueMarks),
        formatter: { formatDate: formatDate, formatBigNumber: (v) => fmtVolume(+v) },
        thousandsSeparator: { sign: '.', format: viNumber },
        decimalFold: { threshold: 99 },
      });

      // Nguồn nến cho thư viện: chỉ trả lại dữ liệu app.js đã tải (không gọi mạng ở đây).
      this.chart.setDataLoader({
        getBars: (p) => p.callback(p.type === 'init' ? this._pending.slice() : [], false),
        subscribeBar: (p) => { this._push = p.callback; },
        unsubscribeBar: () => { this._push = null; },
      });
      this.chart.setOffsetRightDistance(12);
      this.chart.subscribeAction('onCrosshairChange', (c) => this._updateLegend(c));
      this._buildTools();
    }

    // symbol: mã đang xem; bars: dữ liệu từ data.js; tf: khung thời gian;
    // keepView: khi tự làm mới, chỉ cập nhật nến cuối / nến mới để giữ vị trí đang xem.
    setData(symbol, bars, tf, keepView) {
      const data = bars.map((b) => ({
        timestamp: b.time * 1000, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
      }));
      const same = symbol === this.symbol && tf === this.tf;
      if (keepView && same && this._pushTail(data)) {
        this._updateLegend(null);
        return;
      }

      const symbolChanged = symbol !== this.symbol;
      const prevPeriod = this.tf ? periodOf(this.tf) : null;
      this.symbol = symbol;
      this.tf = tf;
      this._pending = data;
      this._cancelDrawing();
      // Đổi mã hoặc độ chính xác → setSymbol; đổi khung → setPeriod. Mỗi lệnh đều nạp lại dữ liệu ngay.
      this.chart.setSymbol({ ticker: symbol, pricePrecision: this.decimals, volumePrecision: 0 });
      const period = periodOf(tf);
      if (!prevPeriod || prevPeriod.type !== period.type || prevPeriod.span !== period.span) this.chart.setPeriod(period);

      // Mặc định hiển thị ~120 nến gần nhất (ít hơn trên màn hình hẹp).
      const size = this.chart.getSize(CANDLE_PANE, 'main');
      const n = window.innerWidth < 600 ? 60 : 120;
      if (size && size.width) this.chart.setBarSpace(Math.max(2, Math.min(24, size.width / n)));
      this.chart.scrollToRealTime();

      if (symbolChanged) this._restoreDrawings();
      this._updateLegend(null);
    }

    // Thêm/cập nhật các nến từ nến cuối đang có. Trả về false nếu dữ liệu không nối tiếp được.
    _pushTail(data) {
      const list = this.chart.getDataList();
      if (!this._push || !list.length || !data.length) return false;
      const last = list[list.length - 1].timestamp;
      let i = data.length - 1;
      while (i >= 0 && data[i].timestamp > last) i--;
      if (i < 0 || data[i].timestamp !== last || data.length - i > 50) return false;
      for (; i < data.length; i++) this._push(data[i]);
      return true;
    }

    // Thu/phóng để thấy đúng các nến trong `days` ngày gần nhất (nút 5 năm … 1 ngày).
    setVisibleDays(days) {
      const list = this.chart.getDataList();
      const size = this.chart.getSize(CANDLE_PANE, 'main');
      if (!list.length || !size || !size.width) return;
      const since = list[list.length - 1].timestamp - days * 86400000;
      let n = 0;
      for (let i = list.length - 1; i >= 0 && list[i].timestamp > since; i--) n++;
      this.chart.setBarSpace(Math.max(1, Math.min(40, (size.width - 40) / Math.max(n, 5))));
      this.chart.scrollToRealTime();
    }

    // Số chữ số thập phân của giá (cổ phiếu VN, vàng, BTC: 2; tỷ giá: 4). Gọi trước setData.
    setPrecision(decimals) {
      if (decimals === this.decimals) return;
      this.decimals = decimals;
      this.chart.overrideIndicator({ name: 'VST_MACD', precision: this._macdPrecision() });
    }

    _macdPrecision() { return this.decimals > 2 ? this.decimals + 1 : 2; }

    setIndicators(on) {
      this.on = Object.assign({}, on);
      const ch = this.chart;

      // MA: một chỉ báo chứa các chu kỳ đang bật, màu theo từng chu kỳ.
      ch.removeIndicator({ name: 'VST_MA' });
      const mas = [[on.ma20, 20, C.ma20, 1], [on.ma50, 50, C.ma50, 1], [on.ma200, 200, C.ma200, 2]].filter((m) => m[0]);
      if (mas.length) {
        ch.createIndicator({
          name: 'VST_MA', paneId: CANDLE_PANE, calcParams: mas.map((m) => m[1]),
          styles: { lines: mas.map((m) => ({ color: m[2], size: m[3] })) },
        }, true);
      }

      const has = (name) => ch.getIndicators({ name: name }).length > 0;
      if (on.bb && !has('VST_BOLL')) {
        ch.createIndicator({
          name: 'VST_BOLL', paneId: CANDLE_PANE,
          styles: { lines: [{ color: C.bb }, { color: C.bb, style: 'dashed', dashedValue: [4, 3] }, { color: C.bb }] },
        }, true);
      } else if (!on.bb) {
        ch.removeIndicator({ name: 'VST_BOLL' });
      }
      if (on.vp && !has('VST_VP')) ch.createIndicator({ name: 'VST_VP', paneId: CANDLE_PANE }, true);
      else if (!on.vp) ch.removeIndicator({ name: 'VST_VP' });

      const subStyles = {
        vol: null,
        rsi: { lines: [{ color: C.rsi }] },
        macd: { lines: [{ color: C.macd }, { color: C.signal }] },
      };
      Object.keys(SUB_PANES).forEach((key) => {
        const pane = SUB_PANES[key];
        const exists = has(pane.indicator);
        if (on[key] && !exists) {
          const create = { name: pane.indicator, paneId: pane.id, styles: subStyles[key] };
          if (key === 'macd') create.precision = this._macdPrecision();
          ch.createIndicator(create);
          ch.setPaneOptions({ id: pane.id, height: pane.height, minHeight: 40, order: pane.order });
        } else if (!on[key] && exists) {
          ch.removeIndicator({ name: pane.indicator });
        }
      });

      // Khung biểu đồ cao thêm đúng bằng tổng chiều cao các khung phụ đang bật (khi trang được cuộn).
      const subsHeight = Object.keys(SUB_PANES).reduce((s, k) => s + (on[k] ? SUB_PANES[k].height : 0), 0);
      this.els.main.style.setProperty('--subs-h', subsHeight + 'px');
    }

    _updateLegend(crosshair) {
      const el = this.els.legend;
      const list = this.chart.getDataList();
      if (!list.length) { el.textContent = ''; return; }
      let idx = list.length - 1;
      if (crosshair && crosshair.kLineData && crosshair.dataIndex >= 0 && crosshair.dataIndex < list.length) {
        idx = crosshair.dataIndex;
      }
      const b = list[idx];
      const prev = list[idx - 1];
      const chg = prev ? b.close - prev.close : 0;
      const pct = prev && prev.close ? (chg / prev.close) * 100 : 0;
      const cls = chg > 0 ? 'up' : chg < 0 ? 'down' : 'ref';
      const fp = (v) => fmtPrice(v, this.decimals);
      el.innerHTML =
        '<span class="lg-time">' + fmtTime(b.timestamp / 1000, this.tf) + '</span>' +
        '<span>M <b>' + fp(b.open) + '</b></span>' +
        '<span>C <b>' + fp(b.high) + '</b></span>' +
        '<span>T <b>' + fp(b.low) + '</b></span>' +
        '<span>Đ <b class="' + cls + '">' + fp(b.close) + '</b></span>' +
        '<span class="' + cls + '">' + (chg > 0 ? '+' : '') + fp(chg) + ' (' + (chg > 0 ? '+' : '') + VST.fmtPct(pct) + '%)</span>' +
        '<span>KL <b>' + fmtVolume(b.volume || 0) + '</b></span>';
    }

    // ---------- Công cụ vẽ ----------

    _buildTools() {
      const el = this.els.tools;
      if (!el) return;
      const full = this.opts.toolset === 'full';
      const icon = (d) => '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="' + d + '"/></svg>';
      // Bộ đầy đủ: nút chỉ có icon, tên công cụ nằm ở title và aria-label.
      const body = (t) => full ? icon(t.icon) + '<span class="sr-only">' + t.label + '</span>' : t.label;
      el.innerHTML = TOOLS.filter((t) => full || !t.full).map((t) =>
        '<button type="button" class="tool" data-tool="' + t.name + '" title="' + t.title + '" aria-pressed="false">' +
        body(t) + '</button>').join('') +
        '<button type="button" class="tool tool-clear" data-tool="clear" title="Xóa hình vẽ đang chọn, hoặc tất cả hình vẽ của mã này">' +
        (full ? icon(ICON_CLEAR) + '<span class="sr-only tool-clear-text">Xóa</span>' : 'Xóa') + '</button>';
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-tool]');
        if (!b) return;
        if (b.dataset.tool === 'clear') this._clearDrawings();
        else this._startDrawing(b.dataset.tool);
      });
    }

    _renderTools() {
      const el = this.els.tools;
      if (!el) return;
      el.querySelectorAll('button[data-tool]').forEach((b) => {
        const on = !!this._drawing && b.dataset.tool === this._drawing.name;
        b.classList.toggle('active', on);
        if (b.dataset.tool !== 'clear') b.setAttribute('aria-pressed', on);
      });
      const clear = el.querySelector('[data-tool="clear"]');
      const text = this._selected ? 'Xóa hình đã chọn' : 'Xóa';
      if (this.opts.toolset === 'full') {
        clear.querySelector('.tool-clear-text').textContent = text;
        clear.classList.toggle('armed', !!this._selected);
      } else {
        clear.textContent = text;
      }
    }

    _startDrawing(name) {
      const again = this._drawing && this._drawing.name === name;
      this._cancelDrawing();
      if (again || !this.symbol) { this._renderTools(); return; } // bấm lại nút đang chọn = hủy
      const id = this.chart.createOverlay(this._overlay({ name: name }));
      if (id) this._drawing = { id: id, name: name };
      this._renderTools();
    }

    _cancelDrawing() {
      if (!this._drawing) return;
      const id = this._drawing.id;
      this._drawing = null;
      this.chart.removeOverlay({ id: id });
    }

    // Thuộc tính chung cho mọi hình vẽ: nhóm, hút về giá OHLC, lưu lại khi vẽ xong / kéo / xóa.
    _overlay(o) {
      const save = () => setTimeout(() => this._saveDrawings(), 0);
      return Object.assign({
        groupId: DRAW_GROUP,
        mode: 'weak_magnet',
        onDrawEnd: () => { this._drawing = null; this._renderTools(); save(); },
        onPressedMoveEnd: save,
        onRemoved: (e) => {
          if (this._selected === e.overlay.id) this._selected = null;
          this._renderTools();
          save();
        },
        onSelected: (e) => { this._selected = e.overlay.id; this._renderTools(); },
        onDeselected: (e) => { if (this._selected === e.overlay.id) this._selected = null; this._renderTools(); },
      }, o);
    }

    _clearDrawings() {
      this._cancelDrawing();
      if (this._selected) {
        this.chart.removeOverlay({ id: this._selected });
        this._selected = null;
      } else if (this.chart.getOverlays({ groupId: DRAW_GROUP }).length &&
          window.confirm('Xóa tất cả hình vẽ của mã ' + this.symbol + '?')) {
        this.chart.removeOverlay({ groupId: DRAW_GROUP });
      }
      this._renderTools();
      this._saveDrawings();
    }

    _saveDrawings() {
      if (!this.symbol) return;
      const list = this.chart.getOverlays({ groupId: DRAW_GROUP })
        .filter((o) => !this._drawing || o.id !== this._drawing.id)
        .map((o) => ({ name: o.name, points: o.points.map((p) => ({ timestamp: p.timestamp, value: p.value })) }));
      saveDrawings(this.symbol, list);
    }

    // Đổi mã: bỏ hình vẽ của mã cũ, vẽ lại hình đã lưu của mã mới.
    _restoreDrawings() {
      this._selected = null;
      this.chart.removeOverlay({ groupId: DRAW_GROUP });
      const list = loadDrawings(this.symbol).filter((d) => d && typeof d.name === 'string' && Array.isArray(d.points));
      if (list.length) this.chart.createOverlay(list.map((d) => this._overlay({ name: d.name, points: d.points })));
      this._renderTools();
    }
  }

  if (KC) registerAll();

  VST.fmtPrice = fmtPrice;
  VST.fmtPct = function (v) { return v.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  VST.fmtVolume = fmtVolume;
  VST.fmtDate = function (t) { return fmtTime(t); };
  VST.ChartView = ChartView;
})();
