// Phân tích mã kiểu hội chẩn nhiều vai trò — hàm thuần, không đụng DOM, không gọi mạng; chạy được cả trong Node
// (để sau này dùng lại cho backtest: gọi analyze() trên bars cắt tới từng ngày).
// analyze(bars, cfg) → 6 thẻ, mỗi thẻ điểm 0–1 (càng cao càng thuận lợi cho việc MUA):
//   QUÉT, KỸ THUẬT, HỖ TRỢ/KHÁNG CỰ, BIẾN ĐỘNG, RỦI RO (cao = rủi ro thấp), TỔNG HỢP (MUA / THEO DÕI / BÁN).
// cfg: VST.config.consult (ngưỡng, trọng số, mốc chấm điểm). Công thức từng thẻ ghi ngay trên hàm tính thẻ đó.
window.VST = window.VST || {};

VST.consult = (function () {
  const ind = VST.indicators;
  const MIN_BARS = 60; // đủ cho MA50 và MACD(12, 26, 9)

  const LABELS = {
    scan: 'QUÉT', tech: 'KỸ THUẬT', sr: 'HỖ TRỢ/KHÁNG CỰ', vol: 'BIẾN ĐỘNG', risk: 'RỦI RO', summary: 'TỔNG HỢP',
  };
  const ORDER = ['scan', 'tech', 'sr', 'vol', 'risk', 'summary'];

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  // lin(x, [a, b]): x = a → 0, x = b → 1, tuyến tính ở giữa, ngoài khoảng giữ 0 hoặc 1.
  function lin(x, ab) { return ab[1] === ab[0] ? (x >= ab[1] ? 1 : 0) : clamp01((x - ab[0]) / (ab[1] - ab[0])); }
  function last(arr) { return arr[arr.length - 1]; }
  function round2(x) { return Math.round(x * 100) / 100; }
  // Số kiểu Việt Nam: dấu phẩy thập phân.
  function num(x, d) { return x.toFixed(d == null ? 1 : d).replace('.', ','); }
  function pct(x, d) { return num(x, d) + '%'; }

  // ---------- QUÉT ----------
  // volRatio = KL phiên cuối / KL trung bình 20 phiên TRƯỚC đó. Nếu phiên cuối chưa kết thúc (frac < 1: tỷ lệ thời gian
  // khớp lệnh đã qua, xem sessionFraction), KL phiên cuối được ước tính cả phiên = KL hiện tại / frac.
  // flow (dòng tiền) = Σ(GTGD_i × dấu(close_i − close_{i−1})) / Σ GTGD_i trong 20 phiên gần nhất, ∈ [−1, 1].
  // Điểm = (1 − w)·lin(volRatio, [0,5; 2]) + w·(flow + 1)/2, w = cfg.scan.flowWeight (0,5).
  function scoreScan(b, c, frac) {
    const n = b.closes.length, p = c.period;
    let s = 0;
    for (let i = n - 1 - p; i < n - 1; i++) s += b.vols[i];
    const avgVol = s / p;
    const volRatio = avgVol > 0 ? b.vols[n - 1] / frac / avgVol : 0;
    let signed = 0, total = 0;
    for (let i = n - p; i < n; i++) {
      const v = b.closes[i] * b.vols[i];
      const d = b.closes[i] - b.closes[i - 1];
      signed += d > 0 ? v : d < 0 ? -v : 0;
      total += v;
    }
    const flow = total > 0 ? signed / total : 0;
    const score = (1 - c.flowWeight) * lin(volRatio, c.volRatio) + c.flowWeight * (flow + 1) / 2;

    const volTxt = volRatio >= 1.5 ? 'KL đột biến ' + num(volRatio, 1) + '× TB20'
      : volRatio >= 0.8 ? 'KL ' + num(volRatio, 1) + '× TB20, bình thường' : 'KL thấp, chỉ ' + num(volRatio, 1) + '× TB20';
    const flowTxt = flow >= 0.2 ? 'dòng tiền vào' : flow <= -0.2 ? 'dòng tiền ra' : 'dòng tiền giằng co';
    return {
      score: score,
      note: volTxt + (frac < 1 ? ' (ước tính cả phiên)' : '') + ', ' + flowTxt + ' (' + (flow >= 0 ? '+' : '') + num(flow * 100, 0) + '%).',
      detail: { volRatio: volRatio, flow: flow, avgVol20: avgVol, sessionFraction: frac },
    };
  }

  // ---------- KỸ THUẬT ----------
  // Điểm = 0,5·xu hướng + 0,2·RSI + 0,3·MACD (trọng số cfg.tech.weights).
  //   xu hướng = (số điều kiện đúng trong: giá > MA20, giá > MA50, MA20 > MA50) / 3.
  //   RSI14: ≤ 30 → 0; 30…50 tăng 0→1; 50…65 → 1; 65…75 giảm 1→0,3; > 75 (quá mua) → 0,3.
  //   MACD theo histogram h = MACD − tín hiệu: h > 0 và tăng → 1; h > 0 → 0,7; h ≤ 0 nhưng tăng → 0,4; còn lại 0.
  function scoreTech(b, c) {
    const price = last(b.closes);
    const ma20 = last(ind.sma(b.closes, c.maFast));
    const ma50 = last(ind.sma(b.closes, c.maSlow));
    const trend = ((price > ma20) + (price > ma50) + (ma20 > ma50)) / 3;

    const rsi = last(ind.rsi(b.closes, c.rsiPeriod));
    const r = c.rsi;
    let rsiScore;
    if (rsi <= r.low) rsiScore = 0;
    else if (rsi < r.ideal[0]) rsiScore = lin(rsi, [r.low, r.ideal[0]]);
    else if (rsi <= r.ideal[1]) rsiScore = 1;
    else if (rsi <= r.high) rsiScore = 1 - (1 - r.overbought) * lin(rsi, [r.ideal[1], r.high]);
    else rsiScore = r.overbought;

    const m = ind.macd(b.closes);
    const h = last(m.hist), hPrev = m.hist[m.hist.length - 2];
    const rising = hPrev != null && h > hPrev;
    const mc = c.macd;
    const macdScore = h > 0 ? (rising ? mc.upRising : mc.up) : (rising ? mc.downRising : mc.down);

    const w = c.weights;
    const score = w.trend * trend + w.rsi * rsiScore + w.macd * macdScore;

    const trendTxt = trend === 1 ? 'Xu hướng tăng (giá > MA20 > MA50)'
      : trend === 0 ? 'Xu hướng giảm (giá < MA20 < MA50)'
        : price > ma20 ? 'Giá trên MA20, xu hướng chưa rõ' : 'Giá dưới MA20, xu hướng yếu';
    const rsiTxt = rsi > r.high ? 'quá mua' : rsi < r.low ? 'quá bán' : '';
    const macdTxt = h > 0 ? (rising ? 'MACD trên tín hiệu, đang mở rộng' : 'MACD trên tín hiệu nhưng chậm lại')
      : (rising ? 'MACD dưới tín hiệu, đang thu hẹp' : 'MACD dưới tín hiệu');
    return {
      score: score,
      note: trendTxt + '; RSI ' + num(rsi, 0) + (rsiTxt ? ' (' + rsiTxt + ')' : '') + '; ' + macdTxt + '.',
      detail: { price: price, ma20: ma20, ma50: ma50, trend: trend, rsi: rsi, rsiScore: rsiScore, hist: h, macdScore: macdScore },
    };
  }

  // ---------- HỖ TRỢ/KHÁNG CỰ ----------
  // S = đáy thấp nhất, R = đỉnh cao nhất của 20 phiên gần nhất (tính cả phiên cuối).
  // Điểm cơ bản = 1 − (giá − S)/(R − S): giá càng gần hỗ trợ càng còn nhiều dư địa tới kháng cự. R = S → 0,5.
  // Bứt phá: trong 3 phiên gần nhất có phiên đóng cửa > đỉnh 20 phiên trước nó, và giá hiện tại vẫn ≥ đỉnh cũ đó
  //   → điểm = max(điểm cơ bản, 0,75).
  // Xu hướng tăng: giá > MA50 → điểm = max(điểm, 0,5) (mã khỏe thường sát đỉnh, không bị phạt vì gần kháng cự).
  function scoreSr(b, c) {
    const n = b.closes.length, p = c.period, price = b.closes[n - 1];
    let S = Infinity, R = -Infinity;
    for (let i = n - p; i < n; i++) { S = Math.min(S, b.lows[i]); R = Math.max(R, b.highs[i]); }
    let brokeLevel = null;
    for (let j = n - c.breakoutBars; j < n && brokeLevel == null; j++) {
      let h = -Infinity;
      for (let i = j - p; i < j; i++) h = Math.max(h, b.highs[i]);
      if (b.closes[j] > h && price >= h) brokeLevel = h;
    }
    const breakout = brokeLevel != null;
    const ma = last(ind.sma(b.closes, c.ma));
    const uptrend = price > ma;
    const pos = R > S ? clamp01((price - S) / (R - S)) : 0.5;
    let score = R > S ? 1 - pos : 0.5;
    if (breakout) score = Math.max(score, c.breakout);
    if (uptrend) score = Math.max(score, c.uptrendFloor);
    const toS = (price / S - 1) * 100, toR = (R / price - 1) * 100;
    const note = breakout ? 'Bứt phá đỉnh 20 phiên ' + num(brokeLevel, 2) + ', giá đang giữ trên vùng này.'
      : pos <= 0.3 ? 'Giá gần hỗ trợ ' + num(S, 2) + ' (cách ' + pct(toS) + '), còn ' + pct(toR) + ' tới kháng cự ' + num(R, 2) + '.'
        : pos >= 0.7 ? 'Giá sát kháng cự ' + num(R, 2) + ' (còn ' + pct(toR) + ')' +
            (uptrend ? ', xu hướng tăng (trên MA' + c.ma + ').' : ', dư địa tăng hẹp.')
          : 'Giá giữa vùng ' + num(S, 2) + '–' + num(R, 2) + ', cách hỗ trợ ' + pct(toS) + '.';
    return {
      score: score, note: note,
      detail: { support: S, resistance: R, breakoutLevel: brokeLevel, position: pos, breakout: breakout, uptrend: uptrend },
    };
  }

  // ---------- BIẾN ĐỘNG ----------
  // σ = độ lệch chuẩn (mẫu) của % thay đổi giá đóng cửa ngày trong 20 phiên gần nhất.
  // GTGD TB20 (tỷ đồng) = trung bình(giá nghìn đồng × KL) / 1e6 trong 20 phiên.
  // Điểm = w·(1 − lin(σ, [1,5%; 5%])) + (1 − w)·lin(log10 GTGD, [log10 1; log10 50]), w = cfg.vol.weightSigma (0,5).
  function scoreVol(b, c) {
    const n = b.closes.length, p = c.period;
    const rets = [];
    let value = 0;
    for (let i = n - p; i < n; i++) {
      rets.push((b.closes[i] / b.closes[i - 1] - 1) * 100);
      value += b.closes[i] * b.vols[i];
    }
    const mean = rets.reduce((a, x) => a + x, 0) / p;
    const sigma = Math.sqrt(rets.reduce((a, x) => a + (x - mean) * (x - mean), 0) / (p - 1));
    const valueBn = value / p / 1e6;
    const sigmaScore = 1 - lin(sigma, c.sigma);
    const liqScore = valueBn > 0 ? lin(Math.log10(valueBn), [Math.log10(c.valueBn[0]), Math.log10(c.valueBn[1])]) : 0;
    const score = c.weightSigma * sigmaScore + (1 - c.weightSigma) * liqScore;
    const sTxt = sigma <= c.sigma[0] ? 'Biến động thấp' : sigma >= c.sigma[1] ? 'Biến động rất mạnh' : 'Biến động vừa';
    const lTxt = valueBn >= c.valueBn[1] ? 'thanh khoản cao' : valueBn <= c.valueBn[0] ? 'thanh khoản rất thấp' : 'thanh khoản trung bình';
    return {
      score: score,
      note: sTxt + ' (σ ' + pct(sigma, 1) + '/phiên), ' + lTxt + ' (' + num(valueBn, valueBn < 10 ? 1 : 0) + ' tỷ/phiên).',
      detail: { sigma: sigma, valueBn: valueBn, sigmaScore: sigmaScore, liqScore: liqScore },
    };
  }

  // ---------- RỦI RO (điểm cao = rủi ro thấp) ----------
  // Cắt lỗ gợi ý = max(giá − 2·ATR14, hỗ trợ 20 phiên S); khoảng cách d = (giá − cắt lỗ)/giá (%).
  // Mức giảm từ đỉnh dd = (1 − giá / đỉnh cao nhất 250 phiên ~ 52 tuần) (%).
  // Điểm = w·(1 − lin(d, [3%; 10%])) + (1 − w)·(1 − lin(dd, [10%; 40%])), w = cfg.risk.weightStop (0,6).
  function scoreRisk(b, c, support) {
    const n = b.closes.length, price = b.closes[n - 1];
    const atr = last(ind.atr(b.highs, b.lows, b.closes, c.atrPeriod));
    const stop = Math.min(price, Math.max(price - c.atrMult * atr, support));
    const dist = (1 - stop / price) * 100;
    let high = -Infinity;
    for (let i = Math.max(0, n - c.highBars); i < n; i++) high = Math.max(high, b.highs[i]);
    const dd = Math.max(0, (1 - price / high) * 100);
    const score = c.weightStop * (1 - lin(dist, c.stopDist)) + (1 - c.weightStop) * (1 - lin(dd, c.drawdown));
    const ddTxt = dd < 5 ? 'giá gần đỉnh 52 tuần' : 'giảm ' + pct(dd) + ' từ đỉnh 52 tuần ' + num(high, 2);
    return {
      score: score,
      note: 'Cắt lỗ gợi ý ' + num(stop, 2) + ' (−' + pct(dist) + '); ' + ddTxt + '.',
      detail: { atr: atr, stop: stop, stopDist: dist, high52: high, drawdown: dd },
    };
  }

  // ---------- TỔNG HỢP ----------
  // total = Σ trọng số × điểm thẻ (Quét 0,15; Kỹ thuật 0,35; HT/KC 0,10; Biến động 0,15; Rủi ro 0,25).
  // Kết luận theo luật, xét lần lượt (các thẻ tốt KHÔNG bù được cho kỹ thuật/rủi ro xấu):
  //   1) BÁN: (Kỹ thuật < sell.tech 0,35 VÀ giá < MA50) HOẶC Rủi ro < sell.risk 0,3.
  //   2) MUA: Kỹ thuật ≥ gate.tech 0,6 VÀ Rủi ro ≥ gate.risk 0,3 VÀ total ≥ verdict.buy 0,55.
  //   3) THEO DÕI: còn lại.
  function summarize(cards, cfg) {
    const w = cfg.weights;
    let total = 0, wsum = 0;
    Object.keys(w).forEach(function (k) { total += w[k] * cards[k].score; wsum += w[k]; });
    total = wsum > 0 ? total / wsum : 0;
    const tech = cards.tech.score, risk = cards.risk.score;
    const belowMa = !(cards.tech.detail.price > cards.tech.detail.ma50);

    const sellReasons = [];
    if (tech < cfg.sell.tech && belowMa) sellReasons.push('kỹ thuật yếu (' + num(tech, 2) + ') và giá dưới MA50');
    if (risk < cfg.sell.risk) sellReasons.push('rủi ro cao (điểm ' + num(risk, 2) + ')');
    const gateFailed = Object.keys(cfg.gate).filter((k) => cards[k].score < cfg.gate[k]);

    let verdict, note;
    if (sellReasons.length) {
      verdict = 'BÁN';
      note = 'Điểm tổng ' + num(total, 2) + '; ' + sellReasons.join(', ') + '.';
    } else if (!gateFailed.length && total >= cfg.verdict.buy) {
      verdict = 'MUA';
      note = 'Điểm tổng ' + num(total, 2) + ', qua ngưỡng lọc rủi ro và kỹ thuật.';
    } else {
      verdict = 'THEO DÕI';
      note = gateFailed.length
        ? 'Điểm tổng ' + num(total, 2) + ', chưa qua ngưỡng ' +
          gateFailed.map((k) => LABELS[k] + ' ≥ ' + num(cfg.gate[k], 1) + ' (đang ' + num(cards[k].score, 2) + ')').join(', ') + '.'
        : 'Điểm tổng ' + num(total, 2) + ', chưa đủ ' + num(cfg.verdict.buy, 2) + ' để mua.';
    }
    return { score: total, verdict: verdict, note: note, detail: { gateFailed: gateFailed, sellReasons: sellReasons } };
  }

  // Tỷ lệ thời gian khớp lệnh đã qua của phiên chứa nến cuối (0–1), theo giờ Việt Nam.
  // barTime, now: Unix giây. Nến cuối không phải hôm nay (theo giờ VN) hoặc đã hết giờ khớp lệnh → 1.
  // Kết quả không nhỏ hơn c.minFraction. now không có (backtest, dữ liệu lịch sử) → 1.
  function sessionFraction(barTime, now, c) {
    if (now == null) return 1;
    const day = (t) => Math.floor((t + 7 * 3600) / 86400);
    if (day(barTime) !== day(now)) return 1;
    const minutes = Math.floor(((now + 7 * 3600) % 86400) / 60);
    let done = 0, total = 0;
    c.sessions.forEach(function (s) {
      total += s[1] - s[0];
      done += Math.max(0, Math.min(minutes, s[1]) - s[0]);
    });
    const f = total > 0 ? done / total : 1;
    return f >= 1 ? 1 : Math.max(f, c.minFraction);
  }

  // bars: nến ngày [{time, open, high, low, close, volume}] tăng dần theo thời gian, giá theo nghìn đồng.
  // opts.now (Unix giây, tùy chọn): thời điểm hiện tại, để ước tính KL cả phiên khi phiên hôm nay chưa xong.
  // Trả về null nếu ít hơn 60 phiên. Kết quả: { time, price, verdict, cards: [{ id, label, score, note, detail }] }
  // với score làm tròn 2 chữ số; thứ tự thẻ theo ORDER.
  function analyze(bars, cfg, opts) {
    if (!bars || bars.length < MIN_BARS) return null;
    const b = {
      closes: bars.map((x) => x.close),
      highs: bars.map((x) => x.high),
      lows: bars.map((x) => x.low),
      vols: bars.map((x) => x.volume || 0),
    };
    const cards = {};
    const frac = sessionFraction(bars[bars.length - 1].time, opts && opts.now, cfg.scan);
    cards.scan = scoreScan(b, cfg.scan, frac);
    cards.tech = scoreTech(b, cfg.tech);
    cards.sr = scoreSr(b, cfg.sr);
    cards.vol = scoreVol(b, cfg.vol);
    cards.risk = scoreRisk(b, cfg.risk, cards.sr.detail.support);
    Object.keys(cards).forEach((k) => { cards[k].score = round2(clamp01(cards[k].score)); });
    cards.summary = summarize(cards, cfg);
    cards.summary.score = round2(cards.summary.score);
    return {
      time: bars[bars.length - 1].time,
      price: last(b.closes),
      verdict: cards.summary.verdict,
      cards: ORDER.map((id) => Object.assign({ id: id, label: LABELS[id] }, cards[id])),
    };
  }

  // Mức màu thanh điểm: 'low' (đỏ) / 'mid' (vàng) / 'high' (xanh).
  function level(score, cfg) { return score < cfg.colors.low ? 'low' : score < cfg.colors.high ? 'mid' : 'high'; }

  return { analyze: analyze, level: level, sessionFraction: sessionFraction, lin: lin, LABELS: LABELS, ORDER: ORDER, MIN_BARS: MIN_BARS };
})();
