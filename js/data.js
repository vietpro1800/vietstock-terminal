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
    async getHistoryBatch(symbols, tf) {
      const out = {};
      for (let i = 0; i < symbols.length; i += this.batchSize) {
        const group = symbols.slice(i, i + this.batchSize);
        const results = await Promise.allSettled(group.map((s) => this.getHistory(s, tf)));
        results.forEach(function (r, k) {
          out[group[k]] = r.status === 'fulfilled' ? { bars: r.value } : { error: r.reason };
        });
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

  VST.DataError = DataError;
  VST.VndirectSource = VndirectSource;
})();
