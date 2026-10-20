// Hiệu ứng "hội chẩn" cho lưới thẻ phân tích (analysis.html): một con nhện vẽ trên canvas trong suốt phủ lưới thẻ
// (không bắt sự kiện chạm) lần lượt nhảy qua từng thẻ vai trò. Mỗi lần đáp, 8 chân bám ra các góc thẻ, thẻ đó sáng lên và
// hiện điểm, một vòng sóng lan ra theo màu điểm (xanh ≥ 0,6, vàng 0,4–0,6, đỏ < 0,4); sau lưng để lại sợi tơ mờ dần.
// Cuối cùng nhện đáp xuống TỔNG HỢP (thẻ nhấp sáng, hiện kết luận) rồi nhảy lên bám ở góc thẻ, nằm trong khe giữa
// các thẻ để không che chữ. Toàn bộ ≤ 3 giây, sau đó vẽ một khung tĩnh và vòng requestAnimationFrame dừng hẳn.
// Màu lấy từ biến CSS --fx-* / --up / --ref / --down (không viết mã màu ở đây). Không dùng thư viện ngoài.
window.VST = window.VST || {};

VST.ConsultFx = (function () {
  // Mốc thời gian (giây).
  const T = {
    start: 0.05,   // lúc nhảy lần đầu
    jump: 0.22,    // thời gian bay một bước
    step: 0.42,    // từ lúc đáp thẻ này tới lúc đáp thẻ sau
    verdict: 0.17, // đáp TỔNG HỢP → hiện kết luận
    perch: 0.24,   // bước nhảy cuối lên góc thẻ
    end: 3.0,
  };
  const SILK_LIFE = 0.5; // sợi tơ mờ dần sau khi đáp
  const RING_LIFE = 0.35;
  const MAX_DPR = 2;
  // Góc 8 chân khi đáp trên thẻ (độ, trục y hướng xuống): 4 chân trái, 4 chân phải, xòe như ảnh mẫu.
  const LAND_ANGLES = [-150, -118, 118, 150, -30, -62, 62, 30];
  // Khi bám góc thẻ: chân chạy dọc hai khe (ngang và dọc) — [góc, khoảng cách].
  const PERCH_LEGS = [[180, 16], [180, 32], [-90, 16], [-90, 32], [0, 16], [0, 32], [90, 16], [90, 32]];

  class ConsultFx {
    // stage: phần tử bọc (position: relative) chứa lưới thẻ; canvas: thẻ <canvas> nằm phủ trong stage.
    constructor(stage, canvas) {
      this.stage = stage;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.raf = 0;
      this.run = null;     // lượt đang chạy
      this.settled = null; // { summary, gap } để vẽ lại nhện đang bám khi đổi kích thước
      this.w = 0;
      this.h = 0;
      this._frame = this._frame.bind(this);
      this._resize = this._resize.bind(this);
      const css = getComputedStyle(document.documentElement);
      const v = (name, fb) => css.getPropertyValue(name).trim() || fb;
      this.colors = {
        high: v('--up', 'green'), mid: v('--ref', 'yellow'), low: v('--down', 'red'),
        leg: v('--fx-leg', 'cyan'), joint: v('--fx-joint', 'white'), foot: v('--fx-foot', 'magenta'),
        body: v('--fx-body', 'blue'), bodyFill: v('--bg', 'black'),
      };
      if (window.ResizeObserver) new ResizeObserver(this._resize).observe(stage);
      window.addEventListener('resize', this._resize);
      window.addEventListener('orientationchange', this._resize);
      this._resize();
    }

    get running() { return !!this.run; }

    // cards: 5 thẻ vai trò theo thứ tự; summary: thẻ TỔNG HỢP; levels: 'low'|'mid'|'high' của từng thẻ vai trò.
    // hooks.reveal(i): thẻ i sáng lên; hooks.pulse(): TỔNG HỢP nhấp sáng; hooks.verdict(): hiện kết luận; hooks.done().
    play(cards, summary, levels, hooks) {
      this.stop();
      const targets = cards.concat([summary]);
      const hops = targets.map(function (el, i) {
        const t0 = T.start + i * T.step;
        return { el: el, t0: t0, t1: t0 + T.jump, level: levels[i] || null, jitter: jitter(), landed: false };
      });
      const last = hops[hops.length - 1];
      const perch = { perch: true, t0: last.t1 + T.verdict, landed: false };
      perch.t1 = perch.t0 + T.perch;
      hops.push(perch);
      this.run = {
        cards: cards, summary: summary, hooks: hooks || {}, hops: hops, gap: gapOf(summary),
        start: 0, last: 0, revealed: 0, verdictShown: false,
      };
      this.raf = requestAnimationFrame(this._frame);
    }

    // Kết thúc ngay (tab bị ẩn, tắt hiệu ứng…): hiện đủ mọi thứ, nhện bám góc TỔNG HỢP, dừng vòng lặp.
    finish() {
      const r = this.run;
      if (!r) return;
      while (r.revealed < r.cards.length) this._call('reveal', r.revealed++);
      if (!r.hops[r.hops.length - 2].landed) { r.hops[r.hops.length - 2].landed = true; this._call('pulse'); }
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

    // ---------- Vòng lặp ----------

    _call(name, arg) {
      const f = this.run && this.run.hooks[name];
      if (f) f(arg);
    }

    _settle() {
      const r = this.run;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.settled = { summary: r.summary, gap: r.gap };
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

      const nCards = r.cards.length;
      r.hops.forEach(function (h, i) {
        if (h.landed || t < h.t1) return;
        h.landed = true;
        if (i < nCards) this._call('reveal', r.revealed++);
        else if (i === nCards) this._call('pulse');
      }, this);
      if (!r.verdictShown && t >= r.hops[nCards].t1 + T.verdict) { r.verdictShown = true; this._call('verdict'); }
      if (t >= T.end) { this._settle(); return; }

      this._draw(r, t);
      this.raf = requestAnimationFrame(this._frame);
    }

    // ---------- Vẽ ----------

    _draw(r, t) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      if (!this.w || !this.h) return;
      const size = this._size();
      // Vị trí đáp của từng bước (tính lại mỗi khung hình để đúng cả khi xoay màn hình giữa chừng).
      const poses = r.hops.map((h) => this._pose(h, r, size));
      const startPose = { body: { x: poses[0].body.x, y: 0 }, feet: null };

      // Bước hiện tại: bước đầu tiên chưa đáp xong; đã đáp hết thì đứng ở bước cuối.
      let k = r.hops.findIndex((h) => t < h.t1);
      if (k < 0) k = r.hops.length - 1;
      const hop = r.hops[k];
      const from = k > 0 ? poses[k - 1] : startPose;
      const to = poses[k];

      // Sợi tơ: nối các điểm đã đi qua, mờ dần sau khi đáp.
      ctx.lineWidth = 1;
      ctx.strokeStyle = this.colors.leg;
      for (let i = 1; i <= k; i++) {
        const h = r.hops[i];
        if (t < h.t0) continue;
        const age = t - h.t1;
        const a = age < 0 ? 0.35 : 0.35 * (1 - age / SILK_LIFE);
        if (a <= 0) continue;
        const p = poses[i - 1].body;
        const q = age < 0 ? this._bodyAt(from.body, to.body, hop, t) : poses[i].body;
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }

      // Vòng sóng màu theo điểm tại chỗ vừa đáp.
      r.hops.forEach(function (h, i) {
        if (!h.level || t < h.t1 || t > h.t1 + RING_LIFE) return;
        const p = (t - h.t1) / RING_LIFE;
        ctx.globalAlpha = 0.7 * (1 - p);
        ctx.strokeStyle = this.colors[h.level];
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(poses[i].body.x, poses[i].body.y, size.ring * (0.3 + p), 0, Math.PI * 2); ctx.stroke();
      }, this);
      ctx.globalAlpha = 1;

      // Thân bay theo đường vòng cung; chân co lại khi cất cánh, duỗi ra bám chỗ mới khi đáp.
      const body = t < hop.t0 ? from.body : this._bodyAt(from.body, to.body, hop, t);
      const feet = [];
      for (let i = 0; i < 8; i++) {
        const tuck = this._tuck(body, i, size);
        const oldFoot = from.feet ? from.feet[i] : tuck;
        const lift = hop.t0 + i * 0.008, tucked = hop.t0 + 0.09;
        const reach0 = hop.t1 - 0.08 + i * 0.012, reach1 = reach0 + 0.14;
        let f;
        if (t < lift) f = oldFoot;
        else if (t < tucked) f = mix(oldFoot, tuck, easeOut((t - lift) / (tucked - lift)));
        else if (t < reach0) f = tuck;
        else if (t < reach1) f = mix(tuck, to.feet[i], easeOutBack((t - reach0) / (reach1 - reach0)));
        else f = to.feet[i];
        feet.push(f);
      }
      this._spider(body, feet, size);
    }

    // Khung tĩnh sau khi xong: nhện bám ở góc thẻ TỔNG HỢP (vẽ lại khi đổi kích thước/xoay màn hình).
    _drawSettled() {
      const s = this.settled;
      this.ctx.clearRect(0, 0, this.w, this.h);
      if (!s || !this.w || !this.h || !s.summary.isConnected) return;
      const size = this._size();
      const pose = this._pose({ perch: true }, { summary: s.summary, gap: s.gap }, size);
      this._spider(pose.body, pose.feet, size);
    }

    // Vị trí thân và 8 chân khi đáp ở bước h.
    _pose(h, r, size) {
      if (h.perch) {
        // Giao điểm khe ngang và khe dọc ở góc trên-trái thẻ TỔNG HỢP.
        const rc = this._rect(r.summary);
        const body = this._clamp({ x: rc.x - r.gap / 2, y: rc.y - r.gap / 2 });
        const feet = PERCH_LEGS.map((l) => this._clamp(polar(body, l[0], l[1] * size.scale, l[1] * size.scale)));
        return { body: body, feet: feet };
      }
      const rc = this._rect(h.el);
      const body = { x: rc.x + rc.w / 2, y: rc.y + rc.h / 2 };
      const rx = Math.min(rc.w * 0.48, 150), ry = Math.min(rc.h * 0.46, 95);
      const feet = LAND_ANGLES.map((a, i) => this._clamp(polar(body, a + h.jitter[i] * 8, rx * (1 + h.jitter[i] * 0.06), ry)));
      return { body: body, feet: feet };
    }

    _bodyAt(a, b, hop, t) {
      const p = Math.min(1, Math.max(0, (t - hop.t0) / (hop.t1 - hop.t0)));
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const lift = Math.min(70, 12 + dist * 0.3) * (hop.perch ? 0.5 : 1);
      return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e - Math.sin(Math.PI * p) * lift };
    }

    // Chân co sát thân khi bay.
    _tuck(body, i, size) {
      const side = i < 4 ? -1 : 1, row = i % 4;
      return { x: body.x + side * (size.bw + 16 * size.scale), y: body.y + (row - 1.5) * 9 * size.scale };
    }

    _spider(body, feet, size) {
      const ctx = this.ctx, c = this.colors;
      const bw = size.bw, bh = size.bh;
      // Chân: thân → khớp gối → bàn chân; khớp và giữa đoạn dưới có chấm sáng, bàn chân chấm hồng.
      ctx.lineWidth = 1.6 * size.scale;
      ctx.strokeStyle = c.leg;
      const joints = [];
      feet.forEach(function (f, i) {
        const side = i < 4 ? -1 : 1, row = i % 4;
        const a = { x: body.x + side * bw * 0.8, y: body.y + (row - 1.5) * (bh * 0.45) };
        const mx = (a.x + f.x) / 2, my = (a.y + f.y) / 2;
        const dx = f.x - a.x, dy = f.y - a.y, len = Math.hypot(dx, dy) || 1;
        let nx = -dy / len, ny = dx / len;
        if (ny > 0) { nx = -nx; ny = -ny; } // gối luôn gập lên trên
        const bend = Math.min(len * 0.22, 26 * size.scale);
        const k = { x: mx + nx * bend, y: my + ny * bend };
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(k.x, k.y); ctx.lineTo(f.x, f.y); ctx.stroke();
        joints.push(k, { x: (k.x + f.x) / 2, y: (k.y + f.y) / 2 });
      });
      ctx.fillStyle = c.joint;
      joints.forEach(function (p, i) {
        ctx.beginPath(); ctx.arc(p.x, p.y, (i % 2 ? 1.8 : 2.6) * size.scale, 0, Math.PI * 2); ctx.fill();
      });
      ctx.fillStyle = c.foot;
      feet.forEach(function (f) { ctx.beginPath(); ctx.arc(f.x, f.y, 3.4 * size.scale, 0, Math.PI * 2); ctx.fill(); });

      // Thân: khung chữ nhật xanh, quầng mờ (không dùng shadowBlur cho nhẹ máy), lõi tròn sáng.
      const x = body.x - bw, y = body.y - bh;
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = c.body;
      ctx.fillRect(x - 4, y - 4, bw * 2 + 8, bh * 2 + 8);
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.bodyFill;
      ctx.fillRect(x, y, bw * 2, bh * 2);
      ctx.lineWidth = 2 * size.scale;
      ctx.strokeStyle = c.body;
      ctx.strokeRect(x, y, bw * 2, bh * 2);
      ctx.fillStyle = c.leg;
      ctx.beginPath(); ctx.arc(body.x, body.y + bh * 0.35, bw * 0.55, 0, Math.PI * 2); ctx.fill();
    }

    // Kích thước nhện theo bề rộng màn hình (nhỏ hơn trên điện thoại).
    _size() {
      const scale = this.w < 560 ? 1 : 1.2;
      return { scale: scale, bw: 8 * scale, bh: 16 * scale, ring: 36 * scale };
    }

    // ---------- Hình học / kích thước ----------

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

    _rect(el) {
      const s = this.stage.getBoundingClientRect(), r = el.getBoundingClientRect();
      return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
    }
    _clamp(p) {
      return { x: Math.min(this.w - 4, Math.max(4, p.x)), y: Math.min(this.h - 4, Math.max(4, p.y)) };
    }
  }

  function polar(c, deg, rx, ry) {
    const a = deg * Math.PI / 180;
    return { x: c.x + Math.cos(a) * rx, y: c.y + Math.sin(a) * ry };
  }
  function mix(a, b, p) { return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p }; }
  function easeOut(p) { return 1 - Math.pow(1 - p, 3); }
  function easeOutBack(p) { const c = 1.7; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }
  // Độ lệch ngẫu nhiên nhỏ cho từng chân để mỗi lần đáp trông khác nhau, trong [-1, 1].
  function jitter() { const a = []; for (let i = 0; i < 8; i++) a.push(Math.random() * 2 - 1); return a; }
  // Khe giữa các thẻ (px), để nhện bám đúng giữa khe.
  function gapOf(el) {
    const g = parseFloat(getComputedStyle(el.parentElement).columnGap);
    return isFinite(g) ? g : 8;
  }

  return ConsultFx;
})();
