// Công cụ backtest chiến lược theo quy tắc thị trường Việt Nam.
// Hàm thuần: không đụng DOM, không gọi mạng. Chạy được cả trên trình duyệt lẫn Node (để kiểm thử).
// Giá trong nến tính theo nghìn đồng; tiền (vốn, phí, lãi/lỗ) tính theo đồng.
(function (root) {
  const VST = root.VST = root.VST || {};
  const ind = VST.indicators;

  const PRICE_UNIT = 1000; // 1 đơn vị giá = 1.000 đồng

  // Phí, thuế và quy tắc mặc định (chỉnh được trên trang).
  const DEFAULT_COSTS = {
    buyFee: 0.0015,  // phí mua 0,15%
    sellFee: 0.0015, // phí bán 0,15%
    sellTax: 0.001,  // thuế bán 0,1%
    lotSize: 100,    // mua theo lô 100 cổ phiếu
    settleDays: 2,   // T+2: mua phiên k, sớm nhất bán ở phiên k+2
  };

  class BacktestError extends Error {
    constructor(message) {
      super(message);
      this.name = 'BacktestError';
    }
  }

  // ---------- Phí, thuế, lô, T+2 ----------

  function costsOf(c) { return Object.assign({}, DEFAULT_COSTS, c || {}); }

  // Tiền phải trả khi mua `shares` cổ phiếu ở giá `price` (nghìn đồng).
  function buyCost(price, shares, costs) {
    costs = costsOf(costs);
    const value = Math.round(price * PRICE_UNIT * shares);
    const fee = Math.round(value * costs.buyFee);
    return { value: value, fee: fee, total: value + fee };
  }

  // Tiền thực nhận khi bán: trừ phí bán và thuế bán.
  function sellProceeds(price, shares, costs) {
    costs = costsOf(costs);
    const value = Math.round(price * PRICE_UNIT * shares);
    const fee = Math.round(value * costs.sellFee);
    const tax = Math.round(value * costs.sellTax);
    return { value: value, fee: fee, tax: tax, net: value - fee - tax };
  }

  // Số cổ phiếu tối đa mua được (bội số của lô) sao cho giá trị + phí không vượt quá tiền mặt.
  function maxShares(cash, price, costs) {
    costs = costsOf(costs);
    if (!(price > 0) || !(cash > 0)) return 0;
    const lot = costs.lotSize;
    let lots = Math.floor(cash / (price * PRICE_UNIT * lot * (1 + costs.buyFee)));
    while (lots > 0 && buyCost(price, lots * lot, costs).total > cash) lots--;
    return Math.max(lots, 0) * lot;
  }

  // Cổ phiếu mua ở phiên buyIndex có được bán ở phiên sellIndex không.
  function canSell(buyIndex, sellIndex, settleDays) {
    if (settleDays == null) settleDays = DEFAULT_COSTS.settleDays;
    return sellIndex - buyIndex >= settleDays;
  }

  // ---------- Chiến lược ----------
  // Mỗi chiến lược trả về { entry: bool[], exit: bool[] }, tín hiệu tính theo giá đóng cửa phiên i.

  function crossUp(a, b, i) {
    return i > 0 && a[i] != null && b[i] != null && a[i - 1] != null && b[i - 1] != null &&
      a[i - 1] <= b[i - 1] && a[i] > b[i];
  }
  function crossDown(a, b, i) { return crossUp(b, a, i); }

  const STRATEGIES = {
    maCross: {
      name: 'MA cắt nhau',
      desc: 'Mua khi đường MA nhanh cắt lên MA chậm, bán khi cắt xuống.',
      params: [
        { key: 'fast', label: 'MA nhanh', def: 20, min: 2, max: 250, step: 1 },
        { key: 'slow', label: 'MA chậm', def: 50, min: 3, max: 400, step: 1 },
        { key: 'type', label: 'Loại MA', def: 'sma', options: [['sma', 'SMA (trung bình đơn giản)'], ['ema', 'EMA (trung bình lũy thừa)']] },
      ],
      lookback: function (p) { return Math.max(p.fast, p.slow); },
      validate: function (p) { if (p.fast >= p.slow) return 'MA nhanh phải nhỏ hơn MA chậm.'; },
      signals: function (bars, p) {
        const c = bars.map(function (b) { return b.close; });
        const f = p.type === 'ema' ? ind.ema(c, p.fast) : ind.sma(c, p.fast);
        const s = p.type === 'ema' ? ind.ema(c, p.slow) : ind.sma(c, p.slow);
        return {
          entry: c.map(function (_, i) { return crossUp(f, s, i); }),
          exit: c.map(function (_, i) { return crossDown(f, s, i); }),
        };
      },
    },

    bottom: {
      name: 'Bắt đáy',
      desc: 'Mua khi giá dưới MA dài hạn, RSI xuống vùng quá bán trong vài phiên gần đây và MACD cắt lên đường signal. Bán khi MACD cắt xuống signal.',
      params: [
        { key: 'maLong', label: 'MA dài hạn', def: 200, min: 20, max: 400, step: 1 },
        { key: 'rsiPeriod', label: 'Chu kỳ RSI', def: 14, min: 2, max: 50, step: 1 },
        { key: 'rsiLevel', label: 'RSI dưới', def: 30, min: 5, max: 50, step: 1 },
        { key: 'rsiWindow', label: 'RSI quá bán trong (phiên)', def: 5, min: 1, max: 30, step: 1 },
        { key: 'macdFast', label: 'MACD nhanh', def: 12, min: 2, max: 50, step: 1 },
        { key: 'macdSlow', label: 'MACD chậm', def: 26, min: 3, max: 100, step: 1 },
        { key: 'macdSignal', label: 'MACD signal', def: 9, min: 2, max: 50, step: 1 },
      ],
      lookback: function (p) { return Math.max(p.maLong, p.macdSlow + p.macdSignal, p.rsiPeriod + p.rsiWindow); },
      validate: function (p) { if (p.macdFast >= p.macdSlow) return 'MACD nhanh phải nhỏ hơn MACD chậm.'; },
      signals: function (bars, p) {
        const c = bars.map(function (b) { return b.close; });
        const ma = ind.sma(c, p.maLong);
        const r = ind.rsi(c, p.rsiPeriod);
        const m = ind.macd(c, p.macdFast, p.macdSlow, p.macdSignal);
        const entry = c.map(function (close, i) {
          if (ma[i] == null || !(close < ma[i]) || !crossUp(m.macd, m.signal, i)) return false;
          for (let j = Math.max(0, i - p.rsiWindow + 1); j <= i; j++) {
            if (r[j] != null && r[j] < p.rsiLevel) return true;
          }
          return false;
        });
        return { entry: entry, exit: c.map(function (_, i) { return crossDown(m.macd, m.signal, i); }) };
      },
    },

    breakout: {
      name: 'Breakout',
      desc: 'Mua khi giá đóng cửa vượt đỉnh N phiên trước kèm khối lượng lớn hơn k lần trung bình. Bán khi giá đóng cửa thủng đáy M phiên trước.',
      params: [
        { key: 'lookback', label: 'Đỉnh N phiên', def: 20, min: 2, max: 250, step: 1 },
        { key: 'volMult', label: 'KL > k lần TB', def: 1.5, min: 0, max: 10, step: 0.1 },
        { key: 'volPeriod', label: 'TB khối lượng (phiên)', def: 20, min: 2, max: 100, step: 1 },
        { key: 'exitLookback', label: 'Bán khi thủng đáy M phiên', def: 10, min: 2, max: 250, step: 1 },
      ],
      lookback: function (p) { return Math.max(p.lookback, p.volPeriod, p.exitLookback) + 1; },
      signals: function (bars, p) {
        const n = bars.length;
        const entry = new Array(n).fill(false);
        const exit = new Array(n).fill(false);
        for (let i = 1; i < n; i++) {
          // Đỉnh/đáy và khối lượng trung bình tính trên các phiên TRƯỚC phiên i.
          if (i >= p.lookback && i >= p.volPeriod) {
            let hi = -Infinity;
            for (let j = i - p.lookback; j < i; j++) hi = Math.max(hi, bars[j].high);
            let vol = 0;
            for (let j = i - p.volPeriod; j < i; j++) vol += bars[j].volume;
            vol /= p.volPeriod;
            entry[i] = bars[i].close > hi && bars[i].volume > p.volMult * vol;
          }
          if (i >= p.exitLookback) {
            let lo = Infinity;
            for (let j = i - p.exitLookback; j < i; j++) lo = Math.min(lo, bars[j].low);
            exit[i] = bars[i].close < lo;
          }
        }
        return { entry: entry, exit: exit };
      },
    },

    rsi: {
      name: 'RSI quá bán / quá mua',
      desc: 'Mua khi RSI xuống dưới ngưỡng quá bán, bán khi RSI lên trên ngưỡng quá mua.',
      params: [
        { key: 'period', label: 'Chu kỳ RSI', def: 14, min: 2, max: 50, step: 1 },
        { key: 'buyBelow', label: 'Mua khi RSI dưới', def: 30, min: 1, max: 99, step: 1 },
        { key: 'sellAbove', label: 'Bán khi RSI trên', def: 70, min: 1, max: 99, step: 1 },
      ],
      lookback: function (p) { return p.period + 1; },
      validate: function (p) { if (p.buyBelow >= p.sellAbove) return 'Ngưỡng mua phải nhỏ hơn ngưỡng bán.'; },
      signals: function (bars, p) {
        const r = ind.rsi(bars.map(function (b) { return b.close; }), p.period);
        return {
          entry: r.map(function (v) { return v != null && v < p.buyBelow; }),
          exit: r.map(function (v) { return v != null && v > p.sellAbove; }),
        };
      },
    },
  };

  function defaultParams(id) {
    const out = {};
    STRATEGIES[id].params.forEach(function (d) { out[d.key] = d.def; });
    return out;
  }

  // ---------- Mô phỏng ----------

  // opts: { strategy, params, capital, costs, startIndex, stopLoss, takeProfit, signals? }
  //   stopLoss / takeProfit: tỷ lệ (0,07 = 7%), 0 hoặc null = tắt.
  //   signals: truyền sẵn { entry, exit } (dùng trong kiểm thử) thay cho strategy.
  // Quy tắc: tín hiệu theo giá đóng cửa phiên i → khớp ở giá mở cửa phiên i+1.
  // Cắt lỗ/chốt lời xét theo giá đóng cửa, bán ở giá mở cửa phiên sau.
  // Lệnh bán (mọi lý do) chỉ khớp khi cổ phiếu đã về (T+2); nếu chưa thì hoãn đến phiên được bán đầu tiên.
  function run(bars, opts) {
    const costs = costsOf(opts.costs);
    const capital = +opts.capital;
    if (!(capital > 0)) throw new BacktestError('Vốn ban đầu phải lớn hơn 0.');
    if (!bars || bars.length < 2) throw new BacktestError('Không đủ dữ liệu để chạy backtest.');
    const start = Math.max(0, opts.startIndex || 0);
    if (start >= bars.length - 1) throw new BacktestError('Khoảng thời gian đã chọn không có đủ phiên giao dịch.');

    let sig = opts.signals;
    if (!sig) {
      const st = STRATEGIES[opts.strategy];
      if (!st) throw new BacktestError('Chiến lược không hợp lệ.');
      const params = Object.assign(defaultParams(opts.strategy), opts.params || {});
      const bad = st.validate && st.validate(params);
      if (bad) throw new BacktestError(bad);
      sig = st.signals(bars, params);
    }
    const sl = opts.stopLoss > 0 ? opts.stopLoss : 0;
    const tp = opts.takeProfit > 0 ? opts.takeProfit : 0;

    let cash = capital;
    let pos = null;        // { index, price, shares, cost, fee }
    let pending = null;    // 'buy' | { reason } — lệnh chờ khớp ở giá mở cửa phiên sau
    let exitReason = null; // lý do bán đã phát sinh nhưng còn chờ T+2
    const trades = [];
    const equity = [];

    for (let i = start; i < bars.length; i++) {
      const bar = bars[i];

      // 1) Khớp lệnh chờ ở giá mở cửa.
      if (pending === 'buy') {
        const shares = maxShares(cash, bar.open, costs);
        if (shares > 0) {
          const bc = buyCost(bar.open, shares, costs);
          cash -= bc.total;
          pos = { index: i, price: bar.open, shares: shares, cost: bc.total, fee: bc.fee };
        }
      } else if (pending && pos) {
        const sp = sellProceeds(bar.open, pos.shares, costs);
        cash += sp.net;
        trades.push({
          entryIndex: pos.index, entryTime: bars[pos.index].time, entryPrice: pos.price,
          exitIndex: i, exitTime: bar.time, exitPrice: bar.open,
          shares: pos.shares, buyFee: pos.fee, sellFee: sp.fee, tax: sp.tax,
          cost: pos.cost, proceeds: sp.net,
          pnl: sp.net - pos.cost, pnlPct: (sp.net - pos.cost) / pos.cost,
          sessions: i - pos.index, reason: pending.reason, open: false,
        });
        pos = null;
        exitReason = null;
      }
      pending = null;

      // 2) Định giá cuối phiên.
      equity.push({ time: bar.time, value: cash + (pos ? pos.shares * bar.close * PRICE_UNIT : 0) });

      // 3) Xét tín hiệu theo giá đóng cửa (không đặt lệnh ở phiên cuối cùng).
      if (i === bars.length - 1) break;
      if (pos) {
        if (!exitReason) {
          if (sl && bar.close <= pos.price * (1 - sl)) exitReason = 'stop';
          else if (tp && bar.close >= pos.price * (1 + tp)) exitReason = 'take';
          else if (sig.exit[i]) exitReason = 'signal';
        }
        if (exitReason && canSell(pos.index, i + 1, costs.settleDays)) pending = { reason: exitReason };
      } else if (sig.entry[i]) {
        pending = 'buy';
      }
    }

    // Vị thế còn mở: tính lãi/lỗ tạm theo giá đóng cửa cuối (chưa trừ phí, thuế bán).
    if (pos) {
      const last = bars[bars.length - 1];
      const value = Math.round(pos.shares * last.close * PRICE_UNIT);
      trades.push({
        entryIndex: pos.index, entryTime: bars[pos.index].time, entryPrice: pos.price,
        exitIndex: bars.length - 1, exitTime: last.time, exitPrice: last.close,
        shares: pos.shares, buyFee: pos.fee, sellFee: 0, tax: 0, cost: pos.cost, proceeds: value,
        pnl: value - pos.cost, pnlPct: (value - pos.cost) / pos.cost,
        sessions: bars.length - 1 - pos.index, reason: 'open', open: true,
      });
    }

    return { equity: equity, trades: trades, cash: cash, capital: capital };
  }

  // Mua và giữ: mua tối đa ở giá mở cửa phiên đầu tiên, giữ đến cuối (cùng phí, lô).
  function buyAndHold(bars, startIndex, capital, costs) {
    startIndex = startIndex || 0;
    const first = bars[startIndex];
    const shares = maxShares(capital, first.open, costs);
    const cash = capital - (shares ? buyCost(first.open, shares, costs).total : 0);
    const equity = [];
    for (let i = startIndex; i < bars.length; i++) {
      equity.push({ time: bars[i].time, value: cash + shares * bars[i].close * PRICE_UNIT });
    }
    return { equity: equity, shares: shares };
  }

  // Chỉ số (VN-Index) quy đổi về cùng số vốn, căn theo ngày của mã đang backtest.
  function benchmark(indexBars, times, capital) {
    let j = -1;
    let base = null;
    const out = [];
    for (const t of times) {
      while (j + 1 < indexBars.length && indexBars[j + 1].time <= t) j++;
      if (j < 0) continue;
      if (base == null) base = indexBars[j].close;
      out.push({ time: t, value: capital * indexBars[j].close / base });
    }
    return out;
  }

  // ---------- Chỉ số đánh giá ----------

  // Sụt giảm tối đa, trả về số dương (0,25 = giảm 25% từ đỉnh).
  function maxDrawdown(values) {
    let peak = -Infinity;
    let dd = 0;
    for (const v of values) {
      if (v > peak) peak = v;
      if (peak > 0) dd = Math.max(dd, (peak - v) / peak);
    }
    return dd;
  }

  // equity: [{time, value}]; trades: chỉ tính các giao dịch đã đóng.
  function metrics(equity, trades) {
    const out = { totalReturn: null, cagr: null, maxDrawdown: null, sharpe: null,
      winRate: null, profitFactor: null, trades: 0, finalValue: null };
    if (!equity || equity.length < 2) return out;
    const values = equity.map(function (e) { return e.value; });
    const first = values[0] > 0 ? values[0] : null;
    const last = values[values.length - 1];
    out.finalValue = last;
    if (first) {
      out.totalReturn = last / first - 1;
      const years = (equity[equity.length - 1].time - equity[0].time) / (365.25 * 86400);
      if (years > 0 && last > 0) out.cagr = Math.pow(last / first, 1 / years) - 1;
    }
    out.maxDrawdown = maxDrawdown(values);

    // Sharpe năm hóa từ lợi nhuận ngày (lãi suất phi rủi ro = 0).
    const rets = [];
    for (let i = 1; i < values.length; i++) if (values[i - 1] > 0) rets.push(values[i] / values[i - 1] - 1);
    if (rets.length > 1) {
      const mean = rets.reduce(function (a, b) { return a + b; }, 0) / rets.length;
      const sd = Math.sqrt(rets.reduce(function (a, r) { return a + (r - mean) * (r - mean); }, 0) / (rets.length - 1));
      if (sd > 0) out.sharpe = (mean / sd) * Math.sqrt(252);
    }

    if (trades) {
      const closed = trades.filter(function (t) { return !t.open; });
      out.trades = closed.length;
      if (closed.length) {
        let win = 0, gp = 0, gl = 0;
        closed.forEach(function (t) {
          if (t.pnl > 0) { win++; gp += t.pnl; } else gl -= t.pnl;
        });
        out.winRate = win / closed.length;
        out.profitFactor = gl > 0 ? gp / gl : (gp > 0 ? Infinity : null);
      }
    }
    return out;
  }

  // ---------- Kiểm tra dữ liệu ----------

  // Tìm các phiên giá mở cửa hoặc đóng cửa thấp hơn giá đóng cửa phiên trước quá `threshold`
  // (mặc định 7,5% > biên độ sàn HOSE 7%). Thường là dấu hiệu dữ liệu CHƯA điều chỉnh
  // cổ tức bằng cổ phiếu / chia tách (hoặc mã sàn HNX, UPCoM có biên độ rộng hơn).
  function detectGaps(bars, threshold) {
    threshold = threshold || 0.075;
    const out = [];
    for (let i = 1; i < bars.length; i++) {
      const prev = bars[i - 1].close;
      if (!(prev > 0)) continue;
      const drop = 1 - Math.min(bars[i].open, bars[i].close) / prev;
      if (drop > threshold) out.push({ index: i, time: bars[i].time, drop: drop });
    }
    return out;
  }

  VST.backtest = {
    PRICE_UNIT: PRICE_UNIT,
    DEFAULT_COSTS: DEFAULT_COSTS,
    STRATEGIES: STRATEGIES,
    BacktestError: BacktestError,
    buyCost: buyCost,
    sellProceeds: sellProceeds,
    maxShares: maxShares,
    canSell: canSell,
    defaultParams: defaultParams,
    run: run,
    buyAndHold: buyAndHold,
    benchmark: benchmark,
    maxDrawdown: maxDrawdown,
    metrics: metrics,
    detectGaps: detectGaps,
  };
})(typeof window !== 'undefined' ? window : globalThis);
