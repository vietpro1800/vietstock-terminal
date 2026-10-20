// Danh mục giả lập (paper trading) theo chiến lược. Hàm thuần: không đụng DOM, không gọi mạng; chạy được trong Node.
// Một danh mục = chiến lược + tham số + danh sách mã + vốn + ngày bắt đầu. Vốn chia đều cho từng mã; mỗi mã giao dịch
// độc lập theo tín hiệu chiến lược bằng VST.backtest.run (phí, thuế, lô 100, T+2, khớp ở giá mở cửa phiên sau).
// Giao dịch được tính lại từ dữ liệu giá mỗi lần mở, nên chỉ cần lưu cấu hình.
(function (root) {
  const VST = root.VST = root.VST || {};
  const bt = VST.backtest;
  const VN_OFFSET = 7 * 3600;
  const PRICE_UNIT = 1000;
  const MIN_CAPITAL = 1e6;
  const MAX_CAPITAL = 1e12;
  const MAX_YEARS_BACK = 10;

  class PaperError extends Error {
    constructor(message) {
      super(message);
      this.name = 'PaperError';
    }
  }

  // 'YYYY-MM-DD' (ngày VN) ↔ Unix giây lúc 0h giờ VN.
  function dateToTime(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return null;
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const d = new Date(ms);
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
    return ms / 1000 - VN_OFFSET;
  }
  function timeToDate(t) {
    const d = new Date((t + VN_OFFSET) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }

  // Chuẩn hóa và kiểm tra cấu hình nhập từ form / đọc từ CSDL. Lỗi → PaperError (tiếng Việt).
  // opts: { maxSymbols, isSymbol(mã) → bool, now (Unix giây) }
  function normalize(raw, opts) {
    raw = raw || {};
    opts = opts || {};
    const st = bt.STRATEGIES[raw.strategy];
    if (!st) throw new PaperError('Chưa chọn chiến lược hợp lệ.');

    const params = bt.defaultParams(raw.strategy);
    st.params.forEach(function (d) {
      const v = raw.params ? raw.params[d.key] : undefined;
      if (v == null || v === '') return;
      if (d.options) {
        if (d.options.some((o) => o[0] === v)) params[d.key] = v;
        return;
      }
      const num = Number(v);
      if (!isFinite(num) || num < d.min || num > d.max) {
        throw new PaperError(d.label + ' phải trong khoảng ' + d.min + '–' + d.max + '.');
      }
      params[d.key] = num;
    });
    const bad = st.validate && st.validate(params);
    if (bad) throw new PaperError(bad);

    const list = Array.isArray(raw.symbols) ? raw.symbols : String(raw.symbols || '').split(/[\s,;]+/);
    const symbols = [];
    list.forEach(function (s) {
      s = String(s || '').trim().toUpperCase();
      if (s && symbols.indexOf(s) < 0) symbols.push(s);
    });
    if (!symbols.length) throw new PaperError('Nhập ít nhất một mã cổ phiếu.');
    const max = opts.maxSymbols || 10;
    if (symbols.length > max) throw new PaperError('Mỗi danh mục tối đa ' + max + ' mã.');
    const wrong = symbols.filter((s) => !/^[A-Z0-9]{3}$/.test(s) || (opts.isSymbol && !opts.isSymbol(s)));
    if (wrong.length) throw new PaperError('Không tìm thấy mã: ' + wrong.join(', ') + '.');

    const capital = Math.round(Number(raw.capital));
    if (!isFinite(capital) || capital < MIN_CAPITAL * symbols.length) {
      throw new PaperError('Vốn tối thiểu 1 triệu đồng cho mỗi mã (' + symbols.length + ' mã).');
    }
    if (capital > MAX_CAPITAL) throw new PaperError('Vốn tối đa 1.000 tỷ đồng.');

    const start = dateToTime(raw.start);
    const now = opts.now || Math.floor(Date.now() / 1000);
    if (start == null) throw new PaperError('Ngày bắt đầu không hợp lệ.');
    if (start > now) throw new PaperError('Ngày bắt đầu không được sau hôm nay.');
    if (start < now - MAX_YEARS_BACK * 365.25 * 86400) throw new PaperError('Ngày bắt đầu chỉ được trong ' + MAX_YEARS_BACK + ' năm gần đây.');

    const pct = function (v, label) {
      if (v == null || v === '') return 0;
      const n = Number(v);
      if (!isFinite(n) || n < 0 || n > 100) throw new PaperError(label + ' phải từ 0 đến 100%.');
      return n;
    };

    return {
      strategy: raw.strategy,
      params: params,
      symbols: symbols,
      capital: capital,
      start: timeToDate(start),
      stopLoss: pct(raw.stopLoss, 'Cắt lỗ'),
      takeProfit: pct(raw.takeProfit, 'Chốt lời'),
    };
  }

  // Số phiên lịch sử chiến lược cần trước ngày bắt đầu để chỉ báo có giá trị ngay.
  function lookback(cfg) {
    const st = bt.STRATEGIES[cfg.strategy];
    return st.lookback(Object.assign(bt.defaultParams(cfg.strategy), cfg.params));
  }

  // Chạy mô phỏng. barsBySymbol: { [mã]: nến ngày, gồm cả lịch sử trước ngày bắt đầu } (thiếu = lỗi tải);
  // indexBars: nến VN-Index để so sánh (có thể null). Trả về trạng thái để summarize() tính số liệu.
  function simulate(cfg, barsBySymbol, indexBars) {
    const start = dateToTime(cfg.start);
    const n = cfg.symbols.length;
    const per = Math.floor(cfg.capital / n);
    const spare = cfg.capital - per * n; // phần lẻ không chia được, giữ ở tiền mặt
    const slices = cfg.symbols.map(function (sym) {
      const s = { symbol: sym, capital: per, cash: per, equity: [], trades: [], position: null, pending: null,
        lastPrice: null, lastTime: null, status: 'ok', error: '' };
      const bars = barsBySymbol[sym];
      if (!Array.isArray(bars) || !bars.length) {
        s.status = 'error';
        s.error = (bars && bars.message) || 'Không tải được dữ liệu.';
        return s;
      }
      const last = bars[bars.length - 1];
      s.lastPrice = last.close;
      s.lastTime = last.time;
      const si = bars.findIndex((b) => b.time >= start);
      if (si < 0) { s.status = 'waiting'; return s; } // chưa có phiên nào kể từ ngày bắt đầu
      const res = bt.run(bars, {
        strategy: cfg.strategy, params: cfg.params, capital: per, startIndex: si,
        stopLoss: cfg.stopLoss / 100, takeProfit: cfg.takeProfit / 100,
      });
      s.cash = res.cash;
      s.equity = res.equity;
      s.pending = res.pending;
      res.trades.forEach(function (t) {
        if (!t.open) { s.trades.push(Object.assign({ symbol: sym }, t)); return; }
        const sellable = bars[t.entryIndex + bt.DEFAULT_COSTS.settleDays];
        s.position = {
          symbol: sym, shares: t.shares, entryPrice: t.entryPrice, entryTime: t.entryTime, cost: t.cost,
          sellableTime: sellable ? sellable.time : null, lastPrice: last.close,
        };
      });
      return s;
    });

    // Giá trị cả danh mục theo ngày: cộng giá trị từng mã (trước khi mã có dữ liệu thì tính bằng vốn của mã).
    const timeSet = new Set();
    slices.forEach((s) => s.equity.forEach((e) => timeSet.add(e.time)));
    const times = Array.from(timeSet).sort((a, b) => a - b);
    const ptr = slices.map(() => -1);
    const equity = times.map(function (t) {
      let v = spare;
      slices.forEach(function (s, k) {
        while (ptr[k] + 1 < s.equity.length && s.equity[ptr[k] + 1].time <= t) ptr[k]++;
        v += ptr[k] >= 0 ? s.equity[ptr[k]].value : s.capital;
      });
      return { time: t, value: v };
    });
    const bench = indexBars && indexBars.length && times.length ? bt.benchmark(indexBars, times, cfg.capital) : [];
    return { cfg: cfg, slices: slices, spare: spare, equity: equity, bench: bench };
  }

  // Số liệu tổng hợp. prices: { [mã]: giá hiện tại } (realtime) ghi đè giá đóng cửa cuối của vị thế đang mở.
  function summarize(sim, prices) {
    prices = prices || {};
    const cap = sim.cfg.capital;
    let cash = sim.spare;
    sim.slices.forEach((s) => { cash += s.cash; });
    const positions = sim.slices.filter((s) => s.position).map(function (s) {
      const p = s.position;
      const price = prices[s.symbol] > 0 ? prices[s.symbol] : p.lastPrice;
      const value = Math.round(p.shares * price * PRICE_UNIT);
      return Object.assign({}, p, { price: price, value: value, pnl: value - p.cost, pnlPct: (value - p.cost) / p.cost });
    });
    const trades = [];
    sim.slices.forEach((s) => s.trades.forEach((t) => trades.push(t)));
    trades.sort((a, b) => b.exitTime - a.exitTime);
    const marketValue = positions.reduce((t, p) => t + p.value, 0);
    const nav = cash + marketValue;
    const realized = trades.reduce((t, x) => t + x.pnl, 0);
    const unrealized = positions.reduce((t, p) => t + p.pnl, 0);
    const b = sim.bench;
    return {
      capital: cap,
      cash: cash,
      marketValue: marketValue,
      nav: nav,
      pnl: nav - cap,
      pnlPct: (nav - cap) / cap,
      realized: realized,
      unrealized: unrealized,
      benchPct: b.length > 1 ? b[b.length - 1].value / b[0].value - 1 : null,
      positions: positions,
      trades: trades,
      pendings: sim.slices.filter((s) => s.pending).map((s) => Object.assign({ symbol: s.symbol }, s.pending)),
      waiting: sim.slices.filter((s) => s.status === 'waiting').map((s) => s.symbol),
      errors: sim.slices.filter((s) => s.status === 'error').map((s) => ({ symbol: s.symbol, message: s.error })),
      winRate: trades.length ? trades.filter((t) => t.pnl > 0).length / trades.length : null,
      equity: sim.equity,
      bench: b,
    };
  }

  VST.paper = {
    PaperError: PaperError,
    MIN_CAPITAL: MIN_CAPITAL,
    dateToTime: dateToTime,
    timeToDate: timeToDate,
    normalize: normalize,
    lookback: lookback,
    simulate: simulate,
    summarize: summarize,
  };
})(typeof window !== 'undefined' ? window : globalThis);
