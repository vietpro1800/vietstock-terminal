// Hàm tính chỉ báo kỹ thuật. Đầu vào là mảng số, đầu ra là mảng cùng độ dài (null khi chưa đủ dữ liệu).
window.VST = window.VST || {};

VST.indicators = (function () {
  function sma(values, period) {
    const out = new Array(values.length).fill(null);
    let sum = 0;
    for (let i = 0; i < values.length; i++) {
      sum += values[i];
      if (i >= period) sum -= values[i - period];
      if (i >= period - 1) out[i] = sum / period;
    }
    return out;
  }

  function ema(values, period) {
    const out = new Array(values.length).fill(null);
    const k = 2 / (period + 1);
    let prev = null;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null) continue;
      if (prev == null) {
        // Khởi tạo bằng SMA của `period` giá trị hợp lệ đầu tiên.
        sum += v;
        count++;
        if (count === period) { prev = sum / period; out[i] = prev; }
      } else {
        prev = v * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }

  function bollinger(values, period, mult) {
    period = period || 20;
    mult = mult || 2;
    const mid = sma(values, period);
    const upper = new Array(values.length).fill(null);
    const lower = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += (values[j] - mid[i]) ** 2;
      const sd = Math.sqrt(s / period);
      upper[i] = mid[i] + mult * sd;
      lower[i] = mid[i] - mult * sd;
    }
    return { mid: mid, upper: upper, lower: lower };
  }

  // RSI theo cách làm mượt Wilder.
  function rsi(values, period) {
    period = period || 14;
    const out = new Array(values.length).fill(null);
    if (values.length <= period) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) {
      const d = values[i] - values[i - 1];
      if (d >= 0) gain += d; else loss -= d;
    }
    gain /= period;
    loss /= period;
    out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    for (let i = period + 1; i < values.length; i++) {
      const d = values[i] - values[i - 1];
      gain = (gain * (period - 1) + Math.max(d, 0)) / period;
      loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
    return out;
  }

  function macd(values, fast, slow, signal) {
    fast = fast || 12; slow = slow || 26; signal = signal || 9;
    const ef = ema(values, fast);
    const es = ema(values, slow);
    const line = values.map(function (_, i) { return ef[i] != null && es[i] != null ? ef[i] - es[i] : null; });
    const sig = ema(line, signal);
    const hist = line.map(function (v, i) { return v != null && sig[i] != null ? v - sig[i] : null; });
    return { macd: line, signal: sig, hist: hist };
  }

  // Các chỉ báo dưới đây nhận 3 mảng giá cao / thấp / đóng cửa cùng độ dài.

  function trueRange(high, low, close, i) {
    if (i === 0) return high[0] - low[0];
    return Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
  }

  // ATR (Average True Range) làm mượt Wilder; giá trị đầu tiên ở chỉ số `period`.
  function atr(high, low, close, period) {
    period = period || 14;
    const n = close.length;
    const out = new Array(n).fill(null);
    if (n <= period) return out;
    let sum = 0;
    for (let i = 1; i <= period; i++) sum += trueRange(high, low, close, i);
    let prev = sum / period;
    out[period] = prev;
    for (let i = period + 1; i < n; i++) {
      prev = (prev * (period - 1) + trueRange(high, low, close, i)) / period;
      out[i] = prev;
    }
    return out;
  }

  // Supertrend: dải ATR quanh (cao + thấp) / 2. dir = 1 (xu hướng tăng, đường nằm dưới giá) hoặc -1 (giảm).
  function supertrend(high, low, close, period, mult) {
    period = period || 10;
    mult = mult || 3;
    const n = close.length;
    const a = atr(high, low, close, period);
    const line = new Array(n).fill(null);
    const dir = new Array(n).fill(null);
    let up = null, dn = null, d = 1;
    for (let i = 0; i < n; i++) {
      if (a[i] == null) continue;
      const mid = (high[i] + low[i]) / 2;
      const bu = mid + mult * a[i];
      const bl = mid - mult * a[i];
      // Dải trên chỉ được hạ xuống, dải dưới chỉ được nâng lên (trừ khi giá đã phá qua ở phiên trước).
      const nu = up == null || bu < up || close[i - 1] > up ? bu : up;
      const nl = dn == null || bl > dn || close[i - 1] < dn ? bl : dn;
      if (up == null) d = close[i] >= mid ? 1 : -1;
      else if (d === 1 && close[i] < nl) d = -1;
      else if (d === -1 && close[i] > nu) d = 1;
      up = nu;
      dn = nl;
      dir[i] = d;
      line[i] = d === 1 ? nl : nu;
    }
    return { line: line, dir: dir };
  }

  // DMI (+DI, −DI) và ADX theo Wilder. +DI/−DI có từ chỉ số `period`, ADX từ chỉ số 2·period − 1.
  function dmi(high, low, close, period) {
    period = period || 14;
    const n = close.length;
    const plus = new Array(n).fill(null);
    const minus = new Array(n).fill(null);
    const adx = new Array(n).fill(null);
    if (n <= period) return { plus: plus, minus: minus, adx: adx };
    let tr = 0, pdm = 0, mdm = 0, dxSum = 0, adxPrev = null;
    for (let i = 1; i < n; i++) {
      const upMove = high[i] - high[i - 1];
      const downMove = low[i - 1] - low[i];
      const p = upMove > downMove && upMove > 0 ? upMove : 0;
      const m = downMove > upMove && downMove > 0 ? downMove : 0;
      const t = trueRange(high, low, close, i);
      if (i <= period) {
        tr += t; pdm += p; mdm += m;
        if (i < period) continue;
      } else {
        tr = tr - tr / period + t;
        pdm = pdm - pdm / period + p;
        mdm = mdm - mdm / period + m;
      }
      const pdi = tr > 0 ? (100 * pdm) / tr : 0;
      const mdi = tr > 0 ? (100 * mdm) / tr : 0;
      plus[i] = pdi;
      minus[i] = mdi;
      const dx = pdi + mdi > 0 ? (100 * Math.abs(pdi - mdi)) / (pdi + mdi) : 0;
      if (adxPrev == null) {
        dxSum += dx;
        if (i === 2 * period - 1) { adxPrev = dxSum / period; adx[i] = adxPrev; }
      } else {
        adxPrev = (adxPrev * (period - 1) + dx) / period;
        adx[i] = adxPrev;
      }
    }
    return { plus: plus, minus: minus, adx: adx };
  }

  return { sma: sma, ema: ema, bollinger: bollinger, rsi: rsi, macd: macd, atr: atr, supertrend: supertrend, dmi: dmi };
})();
