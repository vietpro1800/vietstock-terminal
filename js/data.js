// Lớp lấy dữ liệu. Mọi lệnh gọi mạng chỉ nằm trong file này.
// Muốn đổi nguồn: viết lớp mới có cùng getHistory / getHistoryBatch rồi đổi trong app.js.
window.VST = window.VST || {};

(function () {
  // Lỗi có thông điệp tiếng Việt, hiển thị thẳng cho người dùng được.
  class DataError extends Error {
    constructor(message, symbol) {
      super(message);
      this.name = 'DataError';
      this.symbol = symbol;
    }
  }

  const TIMEOUT_MS = 10000;

  class VndirectSource {
    constructor(opts) {
      this.baseUrl = 'https://dchart-api.vndirect.com.vn/dchart/history';
      this.batchSize = (opts && opts.batchSize) || 4;
    }

    // Trả về mảng nến [{time, open, high, low, close, volume}], time là Unix UTC (giây).
    // tf: một mục trong VST.config.timeframes.
    async getHistory(symbol, tf) {
      const to = Math.floor(Date.now() / 1000);
      let bars = await this._fetchBars(symbol, tf.resolution, to - tf.days * 86400, to);
      if (tf.aggregate === 'week') bars = toWeekly(bars);
      return bars;
    }

    // Nến ngày trong khoảng [from, to] (Unix giây). Dùng cho backtest.
    getHistoryRange(symbol, from, to) {
      return this._fetchBars(symbol, 'D', Math.floor(from), Math.floor(to));
    }

    async _fetchBars(symbol, resolution, from, to) {
      symbol = String(symbol || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{2,10}$/.test(symbol)) {
        throw new DataError('Mã chứng khoán không hợp lệ: "' + symbol + '".', symbol);
      }
      const url = this.baseUrl + '?resolution=' + encodeURIComponent(resolution) +
        '&symbol=' + encodeURIComponent(symbol) + '&from=' + from + '&to=' + to;

      let json;
      try {
        json = await fetchJson(url);
      } catch (e) {
        // Thử lại một lần cho lỗi mạng/timeout/5xx.
        if (e.retryable) {
          await sleep(800);
          json = await fetchJson(url).catch(function (e2) { throw toDataError(e2, symbol); });
        } else {
          throw toDataError(e, symbol);
        }
      }

      if (!json || json.s === 'no_data' || !Array.isArray(json.t) || json.t.length === 0) {
        throw new DataError('Không có dữ liệu cho mã ' + symbol + '. Kiểm tra lại mã hoặc thử khung thời gian khác.', symbol);
      }
      if (json.s && json.s !== 'ok') {
        throw new DataError('Máy chủ dữ liệu báo lỗi khi tải mã ' + symbol + '.', symbol);
      }

      const bars = [];
      for (let i = 0; i < json.t.length; i++) {
        const b = {
          time: json.t[i],
          open: +json.o[i], high: +json.h[i], low: +json.l[i], close: +json.c[i],
          volume: +(json.v && json.v[i]) || 0,
        };
        if (isFinite(b.open) && isFinite(b.close)) bars.push(b);
      }
      bars.sort(function (a, b) { return a.time - b.time; });
      return dedupe(bars);
    }

    // Tải nhiều mã theo nhóm nhỏ. Trả về { [symbol]: {bars} | {error} } — không bao giờ reject.
    // onProgress(đã xong, tổng) — tùy chọn, gọi sau mỗi nhóm.
    async getHistoryBatch(symbols, tf, onProgress) {
      const out = {};
      for (let i = 0; i < symbols.length; i += this.batchSize) {
        const group = symbols.slice(i, i + this.batchSize);
        const results = await Promise.allSettled(group.map((s) => this.getHistory(s, tf)));
        results.forEach(function (r, k) {
          out[group[k]] = r.status === 'fulfilled' ? { bars: r.value } : { error: r.reason };
        });
        if (onProgress) onProgress(Math.min(i + this.batchSize, symbols.length), symbols.length);
      }
      return out;
    }
  }

  async function fetchJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    } catch (e) {
      const err = new Error(e.name === 'AbortError' ? 'timeout' : 'network');
      err.kind = err.message;
      err.retryable = true;
      throw err;
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const err = new Error('http');
      err.kind = 'http';
      err.status = res.status;
      err.retryable = res.status >= 500 || res.status === 429;
      throw err;
    }
    try {
      return await res.json();
    } catch (e) {
      const err = new Error('parse');
      err.kind = 'parse';
      throw err;
    }
  }

  function toDataError(e, symbol) {
    if (e instanceof DataError) return e;
    const tag = symbol ? ' (mã ' + symbol + ')' : '';
    switch (e.kind) {
      case 'timeout':
        return new DataError('Máy chủ dữ liệu phản hồi quá chậm' + tag + '. Sẽ thử lại ở lần làm mới sau.', symbol);
      case 'network':
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          return new DataError('Bạn đang mất kết nối Internet.', symbol);
        }
        return new DataError('Không kết nối được máy chủ dữ liệu' + tag + '. Có thể do mạng hoặc trình duyệt chặn truy cập.', symbol);
      case 'http':
        if (e.status === 429) return new DataError('Gọi dữ liệu quá nhiều, máy chủ tạm từ chối. Vui lòng đợi một lát.', symbol);
        return new DataError('Máy chủ dữ liệu trả lỗi (mã ' + e.status + ')' + tag + '.', symbol);
      case 'parse':
        return new DataError('Dữ liệu nhận về không đúng định dạng' + tag + '.', symbol);
      default:
        return new DataError('Lỗi không xác định khi tải dữ liệu' + tag + '.', symbol);
    }
  }

  function dedupe(bars) {
    const out = [];
    for (const b of bars) {
      if (out.length && out[out.length - 1].time === b.time) out[out.length - 1] = b;
      else out.push(b);
    }
    return out;
  }

  // Gộp nến ngày thành nến tuần (tuần bắt đầu thứ Hai, theo giờ VN).
  function toWeekly(bars) {
    const out = [];
    let cur = null;
    let curKey = null;
    for (const b of bars) {
      const d = new Date((b.time + 7 * 3600) * 1000);
      const dow = (d.getUTCDay() + 6) % 7; // 0 = thứ Hai
      const key = Math.floor(d.getTime() / 86400000) - dow;
      if (key !== curKey) {
        if (cur) out.push(cur);
        cur = Object.assign({}, b);
        curKey = key;
      } else {
        cur.high = Math.max(cur.high, b.high);
        cur.low = Math.min(cur.low, b.low);
        cur.close = b.close;
        cur.volume += b.volume;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---------- Sổ lệnh & khớp lệnh realtime (WebSocket bảng giá SSI iBoard) ----------
  // Nguồn không chính thức: định dạng tin nhắn là chuỗi phân tách bằng "|" (vị trí trường theo
  // thư viện mã nguồn mở vnstock-js). WebSocket không bị chặn CORS như fetch.
  // Mỗi lúc chỉ theo dõi 1 mã: watch(symbol, onQuote, onStatus).
  //   onQuote({ symbol, price, change, pct, vol, totalVol, side: 'M'|'B'|'', time, bids, asks })
  //   price/change theo nghìn đồng; pct tự tính = change / (price − change).
  //   onStatus('connecting' | 'open' | 'closed')
  class SsiRealtimeFeed {
    constructor(opts) {
      this.url = (opts && opts.url) || 'wss://iboard-pushstream.ssi.com.vn/realtime';
      this.symbol = null;
      this.socket = null;
      this.retry = 0;
      this.timer = null;
      this.onQuote = null;
      this.onStatus = null;
    }

    watch(symbol, onQuote, onStatus) {
      const prev = this.symbol;
      this.symbol = String(symbol || '').toUpperCase();
      this.onQuote = onQuote;
      this.onStatus = onStatus;
      if (this.socket && this.socket.readyState === 1) {
        if (prev && prev !== this.symbol) this._send('unsub', [prev]);
        this._send('sub', [this.symbol]);
        this._status('open');
      } else if (!this.socket) {
        this._connect();
      }
    }

    _connect() {
      clearTimeout(this.timer);
      if (typeof WebSocket === 'undefined') { this._status('closed'); return; }
      this._status('connecting');
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        this._status('closed');
        this._schedule();
        return;
      }
      this.socket = ws;
      ws.onopen = () => {
        this.retry = 0;
        if (this.symbol) this._send('sub', [this.symbol]);
        this._status('open');
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string' || ev.data.indexOf('|') < 0) return;
        const q = parseSsi(ev.data);
        if (q && q.symbol === this.symbol && this.onQuote) this.onQuote(q);
      };
      ws.onclose = () => {
        if (this.socket !== ws) return;
        this.socket = null;
        this._status('closed');
        this._schedule();
      };
      ws.onerror = function () { /* onclose sẽ xử lý kết nối lại */ };
    }

    // Kết nối lại với thời gian chờ tăng dần (tối đa 30 giây).
    _schedule() {
      const delay = Math.min(30000, 2000 * Math.pow(2, this.retry++));
      this.timer = setTimeout(() => this._connect(), delay);
    }

    _send(type, symbols) {
      try {
        this.socket.send(JSON.stringify({
          type: type, topic: 'stockRealtimeBySymbolsAndBoards',
          variables: { symbols: symbols, boardIds: ['MAIN'] }, component: 'priceTableEquities',
        }));
      } catch (e) { /* socket vừa đóng: onclose sẽ kết nối lại */ }
    }

    _status(s) { if (this.onStatus) this.onStatus(s); }
  }

  // Giá trong tin nhắn tính theo đồng → đổi sang nghìn đồng cho khớp với biểu đồ.
  function parseSsi(str) {
    const p = str.split('|');
    const num = function (i) { const v = Number(p[i]); return isFinite(v) ? v : 0; };
    const symbol = ((p[1] || '').split('#')[1] || '').toUpperCase();
    if (!symbol) return null;
    const level = function (i) { return { price: num(i) / 1000, vol: num(i + 1) }; };
    const t = num(65);
    const price = num(42) / 1000, change = num(52) / 1000;
    const ref = price - change;
    return {
      symbol: symbol,
      bids: [level(2), level(4), level(6)],
      asks: [level(22), level(24), level(26)],
      price: price,
      vol: num(43),
      change: change,
      pct: ref > 0 ? (change / ref) * 100 : 0,
      totalVol: num(54),
      side: p[66] === 'b' ? 'M' : p[66] === 's' ? 'B' : '',
      // lastUpdated có thể là mili giây hoặc giây; không rõ thì lấy giờ máy.
      time: t > 1e12 ? t / 1000 : t > 1e9 ? t : Date.now() / 1000,
    };
  }

  VST.DataError = DataError;
  VST.VndirectSource = VndirectSource;
  VST.SsiRealtimeFeed = SsiRealtimeFeed;
  VST.parseSsiQuote = parseSsi;
})();
