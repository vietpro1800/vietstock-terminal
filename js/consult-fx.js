// Hiệu ứng "hội chẩn" cho lưới thẻ phân tích (analysis.html): canvas trong suốt phủ lên lưới, không bắt sự kiện chạm.
// play(): các thẻ vai trò lần lượt sáng lên, mỗi thẻ bắn một đường cong (có chấm sáng chạy dọc) về thẻ TỔNG HỢP,
// thỉnh thoảng có đường mảnh nối ngang giữa các thẻ; khi đủ đường thì TỔNG HỢP nhấp sáng và hiện kết luận.
// Toàn bộ ≤ 3 giây, sau đó các đường còn rất nhạt và vòng lặp requestAnimationFrame dừng hẳn.
// Màu lấy từ biến CSS --up / --ref / --down (không viết mã màu ở đây). Không dùng thư viện ngoài.
window.VST = window.VST || {};

VST.ConsultFx = (function () {
  // Mốc thời gian (giây) tính từ lúc bắt đầu.
  const T = {
    first: 0.15,     // thẻ đầu tiên sáng
    step: 0.4,       // khoảng cách giữa các thẻ
    travel: 0.5,     // thời gian chấm sáng chạy từ thẻ tới TỔNG HỢP
    verdict: 0.25,   // đường cuối về đích → TỔNG HỢP nhấp sáng ngay, sau khoảng này thì hiện kết luận
    fadeStart: 2.55, // các đường bắt đầu mờ
    end: 3.0,        // kết thúc hẳn
  };
  const LINK_LIFE = 0.7;   // thời gian sống của đường "trao đổi" ngang
  const FINAL_ALPHA = 0.14; // độ đậm còn lại của đường sau khi xong
  const SEGMENTS = 28;     // số đoạn thẳng xấp xỉ đường cong
  const MAX_DPR = 2;       // giới hạn mật độ điểm ảnh cho máy yếu

  class ConsultFx {
    // stage: phần tử bọc (position: relative) chứa lưới thẻ; canvas: thẻ <canvas> nằm phủ trong stage.
    constructor(stage, canvas) {
      this.stage = stage;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.raf = 0;
      this.run = null;     // lượt hiệu ứng đang chạy
      this.settled = null; // { cards, summary, scores } để vẽ lại đường nhạt khi đổi kích thước
      this.w = 0;
      this.h = 0;
      this._frame = this._frame.bind(this);
      this._resize = this._resize.bind(this);
      const css = getComputedStyle(document.documentElement);
      this.colors = {
        high: css.getPropertyValue('--up').trim() || 'green',
        mid: css.getPropertyValue('--ref').trim() || 'yellow',
        low: css.getPropertyValue('--down').trim() || 'red',
        link: css.getPropertyValue('--text-dim').trim() || 'gray',
      };
      if (window.ResizeObserver) new ResizeObserver(this._resize).observe(stage);
      window.addEventListener('resize', this._resize);
      window.addEventListener('orientationchange', this._resize);
      this._resize();
    }

    get running() { return !!this.run; }

    // cards: phần tử 5 thẻ vai trò theo thứ tự; summary: thẻ TỔNG HỢP; levels: 'low'|'mid'|'high' của từng thẻ vai trò.
    // hooks.reveal(i): thẻ i sáng lên; hooks.pulse(): TỔNG HỢP nhấp sáng; hooks.verdict(): hiện kết luận; hooks.done().
    play(cards, summary, levels, hooks) {
      this.stop();
      this.settled = null;
      const n = cards.length;
      const lastArrive = T.first + (n - 1) * T.step + T.travel;
      // Đường "trao đổi": ngẫu nhiên giữa hai thẻ đã sáng, vài lần trong lúc chạy.
      const links = [];
      for (let k = 1; k < n; k++) {
        const t0 = T.first + k * T.step + 0.12 + Math.random() * 0.15;
        const a = Math.floor(Math.random() * (k + 1));
        let b = Math.floor(Math.random() * (k + 1));
        if (b === a) b = (a + 1) % (k + 1);
        links.push({ a: a, b: b, t0: t0 });
      }
      this.run = {
        cards: cards, summary: summary, levels: levels, hooks: hooks || {}, links: links,
        start: 0, last: 0, revealed: 0,
        tPulse: lastArrive,
        tVerdict: lastArrive + T.verdict,
        pulsed: false, verdictShown: false,
      };
      this.raf = requestAnimationFrame(this._frame);
    }

    // Kết thúc ngay (tab bị ẩn, phân tích mã khác…): hiện đủ mọi thứ, để lại đường nhạt, dừng vòng lặp.
    finish() {
      const r = this.run;
      if (!r) return;
      while (r.revealed < r.cards.length) this._call('reveal', r.revealed++);
      if (!r.pulsed) { r.pulsed = true; this._call('pulse'); }
      if (!r.verdictShown) { r.verdictShown = true; this._call('verdict'); }
      this._settle();
    }

    // Dừng và xóa sạch canvas (không gọi hook).
    stop() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.run = null;
      this.settled = null;
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // ---------- Nội bộ ----------

    _call(name, arg) {
      const f = this.run && this.run.hooks[name];
      if (f) f(arg);
    }

    _settle() {
      const r = this.run;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.settled = { cards: r.cards, summary: r.summary, levels: r.levels };
      const hooks = r.hooks;
      this.run = null;
      this._drawSettled();
      if (hooks.done) hooks.done();
    }

    _frame(now) {
      const r = this.run;
      if (!r) return;
      if (!r.start) r.start = now;
      // Tab bị ẩn hoặc trình duyệt bóp nghẹt khung hình (iframe bị ẩn) → kết thúc ngay.
      if (document.hidden || (r.last && now - r.last > 500)) { this.finish(); return; }
      r.last = now;
      const t = (now - r.start) / 1000;

      while (r.revealed < r.cards.length && t >= T.first + r.revealed * T.step) this._call('reveal', r.revealed++);
      if (!r.pulsed && t >= r.tPulse) { r.pulsed = true; this._call('pulse'); }
      if (!r.verdictShown && t >= r.tVerdict) { r.verdictShown = true; this._call('verdict'); }
      if (t >= T.end) { this._settle(); return; }

      this._draw(r, t);
      this.raf = requestAnimationFrame(this._frame);
    }

    _draw(r, t) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      if (!this.w || !this.h) return;
      const fade = t <= T.fadeStart ? 1 : 1 - (1 - FINAL_ALPHA) * Math.min(1, (t - T.fadeStart) / (T.end - T.fadeStart));
      const end = this._center(r.summary);
      const sumRect = this._rect(r.summary);

      // Đường trao đổi ngang: mảnh, mờ dần.
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = this.colors.link;
      r.links.forEach(function (l) {
        const age = t - l.t0;
        if (age < 0 || age > LINK_LIFE) return;
        const a = this._center(r.cards[l.a]), b = this._center(r.cards[l.b]);
        ctx.globalAlpha = 0.55 * (1 - age / LINK_LIFE) * Math.min(1, age / 0.12);
        const c = this._control(a, b, 0.12);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
        ctx.stroke();
      }, this);
      ctx.setLineDash([]);

      // Đường từ từng thẻ tới TỔNG HỢP.
      for (let i = 0; i < r.revealed; i++) {
        const p = Math.min(1, (t - T.first - i * T.step) / T.travel);
        if (p <= 0) continue;
        const color = this.colors[r.levels[i]] || this.colors.mid;
        const curve = this._curve(r.cards[i], sumRect, end, i);
        const ease = 1 - Math.pow(1 - p, 3);
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        // Vệt sáng rộng mờ + nét chính.
        ctx.globalAlpha = 0.18 * fade;
        ctx.lineWidth = 6;
        this._stroke(curve, ease);
        ctx.globalAlpha = 0.9 * fade;
        ctx.lineWidth = 2;
        this._stroke(curve, ease);
        // Chấm sáng chạy dọc đường (không dùng shadowBlur cho nhẹ máy).
        if (p < 1) {
          const q = this._at(curve, ease);
          ctx.globalAlpha = 0.25;
          ctx.beginPath(); ctx.arc(q.x, q.y, 7, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    }

    // Đường nhạt cố định sau khi xong (vẽ lại khi đổi kích thước/xoay màn hình).
    _drawSettled() {
      const s = this.settled;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      if (!s || !this.w || !this.h || !s.summary.isConnected) return;
      const end = this._center(s.summary), sumRect = this._rect(s.summary);
      ctx.lineWidth = 2;
      ctx.globalAlpha = FINAL_ALPHA;
      s.cards.forEach(function (el, i) {
        ctx.strokeStyle = this.colors[s.levels[i]] || this.colors.mid;
        this._stroke(this._curve(el, sumRect, end, i), 1);
      }, this);
      ctx.globalAlpha = 1;
    }

    _resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = this.stage.clientWidth, h = this.stage.clientHeight;
      if (w === this.w && h === this.h && this.canvas.width === Math.round(w * dpr)) return;
      this.w = w;
      this.h = h;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!this.run) this._drawSettled(); // đang chạy thì khung hình sau tự vẽ theo vị trí mới
    }

    // Hình chữ nhật của phần tử theo tọa độ canvas.
    _rect(el) {
      const s = this.stage.getBoundingClientRect(), r = el.getBoundingClientRect();
      return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
    }
    _center(el) {
      const r = this._rect(el);
      return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    }

    // Đường cong bậc 2 từ mép thẻ tới mép thẻ TỔNG HỢP, uốn sang hai phía xen kẽ để các đường không chồng lên nhau.
    _curve(el, sumRect, end, i) {
      const r = this._rect(el);
      const from = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      const a = edge(r, from, end), b = edge(sumRect, end, from);
      const c = this._control(a, b, i % 2 ? -0.22 : 0.22);
      return { a: a, c: c, b: b };
    }
    _control(a, b, bend) {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      return { x: mx - (b.y - a.y) * bend, y: my + (b.x - a.x) * bend };
    }
    _at(k, t) {
      const u = 1 - t;
      return { x: u * u * k.a.x + 2 * u * t * k.c.x + t * t * k.b.x, y: u * u * k.a.y + 2 * u * t * k.c.y + t * t * k.b.y };
    }
    // Vẽ đoạn đầu của đường cong, từ 0 tới tỷ lệ upto.
    _stroke(k, upto) {
      const ctx = this.ctx;
      const steps = Math.max(2, Math.ceil(SEGMENTS * upto));
      ctx.beginPath();
      ctx.moveTo(k.a.x, k.a.y);
      for (let s = 1; s <= steps; s++) {
        const q = this._at(k, upto * s / steps);
        ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
    }
  }

  // Giao điểm của tia từ tâm hình chữ nhật r (điểm c) về phía điểm to với mép r.
  function edge(r, c, to) {
    const dx = to.x - c.x, dy = to.y - c.y;
    if (!dx && !dy) return c;
    const sx = dx ? (r.w / 2) / Math.abs(dx) : Infinity;
    const sy = dy ? (r.h / 2) / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy, 1);
    return { x: c.x + dx * s, y: c.y + dy * s };
  }

  return ConsultFx;
})();
