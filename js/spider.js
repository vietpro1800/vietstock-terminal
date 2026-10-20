// Con nhện hiệu ứng (VST.Spider) — vẽ trên một canvas trong suốt (pointer-events: none), nhảy qua các khung trên màn hình.
// - Khung ứng dụng (index.html, js/shell.js): một con nhện chung cho mọi tab, nhảy giữa các khung (panel, thẻ, bảng…)
//   của trang đang mở trong iframe (cùng nguồn nên đọc được vị trí phần tử bên trong).
// - Trang Phân tích mã: consult() — nhện lần lượt đáp lên 5 thẻ vai trò rồi TỔNG HỢP (hội chẩn); chạy trong khung thì
//   gọi con nhện của khung (window.parent.VST.spider), mở riêng thì dùng canvas của trang.
// Chạy liên tục: mỗi lần nhảy chỉ vẽ bằng requestAnimationFrame trong ~0,3 giây, giữa các lần nhảy nhện đứng yên
// (vẽ một khung tĩnh, không có vòng lặp), nên nhẹ máy. Tab bị ẩn thì ngừng hẳn. Tắt được (lưu localStorage, dùng chung
// mọi trang) và tự tắt khi máy bật giảm chuyển động. Màu lấy từ biến CSS --fx-* / --up / --ref / --down.
window.VST = window.VST || {};

VST.Spider = (function () {
  const PREF_KEY = 'vst.fx.spider';
  const MAX_DPR = 2;
  const SILK_LIFE = 0.5;
  const RING_LIFE = 0.35;
  // Hội chẩn (giây): mỗi thẻ cách nhau STEP, bay JUMP; đáp TỔNG HỢP → sau VERDICT hiện kết luận → nhảy lên góc thẻ.
  const CONSULT = { start: 0.05, step: 0.6, jump: 0.26, verdict: 0.25, perch: 0.26 };
  // Lang thang: thời gian nghỉ giữa hai lần nhảy (giây) theo kiểu đáp.
  const REST = { perch: [1.2, 2.6], spread: [0.7, 1.2] };
  const SPREAD_CHANCE = 0.3; // tỷ lệ đáp xòe chân giữa khung (còn lại bám một điểm trên mép khung)
  // Phần tử nhện có thể đáp khi lang thang (trong trang đang mở): khung, thẻ, bảng, hàng bảng, nút, ô nhập…
  const SELECTOR = '.panel, .an-card, .fa-main, .fa-book, .fa-side-tabs, .pb-top, .pb-toolbar, .pb-ix-sum, ' +
    '.hm-wrap, .hm-bar, .hm-controls, .bt-disclaimer, table, tbody tr, .btn, .seg, .input, .tabs, .an-chip, h2';
  const MIN_W = 60, MIN_H = 22;          // nhỏ hơn thì bỏ qua
  const SPREAD_W = 120, SPREAD_H = 60;   // phần đang thấy đủ lớn mới đáp xòe chân
  const EDGE_PAD = 6;                    // điểm bám cách mép canvas tối thiểu
  // Góc 8 chân khi đáp xòe (độ, trục y hướng xuống): 4 chân trái, 4 chân phải.
  const LAND_ANGLES = [-150, -118, 118, 150, -30, -62, 62, 30];
  // Độ xòe chân tối thiểu (px, trước khi nhân cỡ nhện) khi đứng yên: luôn xòe rộng như ảnh mẫu, kể cả khi bám mép
  // khung nhỏ (nút, hàng bảng giá) — chân có thể vươn ra ngoài khung.
  const REST_RX = 95, REST_RY = 68;

  const reduced = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  class Spider {
    // canvas: <canvas> phủ lên stage; opts.stage: phần tử canvas phủ kín (mặc định cha của canvas);
    // opts.candidates(): danh sách phần tử để nhện lang thang (mặc định: các khung trong document chứa canvas).
    constructor(canvas, opts) {
      opts = opts || {};
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.stage = opts.stage || canvas.parentElement;
      this.candidatesFn = opts.candidates || (() => findCandidates(document));
      this.win = canvas.ownerDocument.defaultView;
      this.on = false;
      this.seq = null;     // chuỗi bước nhảy đang chạy
      this.rest = null;    // { el, kind: 'perch'|'spread', corner|edge+u, jitter } — chỗ nhện đang đứng
      this.restPose = null;
      this.raf = 0;
      this.timer = 0;
      this.redrawQueued = false;
      this.w = 0;
      this.h = 0;
      this._frame = this._frame.bind(this);
      this._resize = this._resize.bind(this);
      this._onVisibility = this._onVisibility.bind(this);
      const css = getComputedStyle(document.documentElement);
      const v = (name, fb) => css.getPropertyValue(name).trim() || fb;
      this.colors = {
        high: v('--up', 'green'), mid: v('--ref', 'yellow'), low: v('--down', 'red'),
        leg: v('--fx-leg', 'cyan'), joint: v('--fx-joint', 'white'), foot: v('--fx-foot', 'magenta'),
        body: v('--fx-body', 'blue'), bodyFill: v('--bg', 'black'),
      };
      if (window.ResizeObserver) new ResizeObserver(this._resize).observe(this.stage);
      window.addEventListener('resize', this._resize);
      window.addEventListener('orientationchange', this._resize);
      document.addEventListener('visibilitychange', this._onVisibility);
      this.watch(document);
      this._resize();
    }

    // Bật/tắt (tắt thì xóa nhện, dừng mọi thứ). Bật mà máy đang giảm chuyển động thì vẫn tắt.
    setEnabled(on) {
      on = !!on && Spider.allowed();
      if (on === this.on) return;
      this.on = on;
      if (on) { this._scheduleWander(0.3); return; }
      this.finish();
      clearTimeout(this.timer);
      this.rest = null;
      this._clear();
    }

    get enabled() { return this.on; }
    get busy() { return !!this.seq; }

    // Theo dõi cuộn trong một document (khung ứng dụng gọi cho từng iframe) để nhện bám theo khung khi cuộn.
    watch(doc) {
      const self = this;
      doc.addEventListener('scroll', function () { self.refresh(); }, { capture: true, passive: true });
    }

    // Hội chẩn: cards = 5 thẻ vai trò, summary = thẻ TỔNG HỢP, levels = 'low'|'mid'|'high' của từng thẻ vai trò.
    // hooks.reveal(i), hooks.pulse(), hooks.verdict(), hooks.done(). Xong thì nhện tiếp tục lang thang.
    consult(cards, summary, levels, hooks) {
      hooks = hooks || {};
      if (!this.on) { finishHooks(cards.length, hooks); return; }
      this.finish();
      clearTimeout(this.timer);
      const items = [];
      let t = CONSULT.start;
      cards.forEach(function (el, i) {
        items.push({ target: spreadTarget(el), start: t, dur: CONSULT.jump, ring: levels[i],
          onLand: () => hooks.reveal && hooks.reveal(i) });
        t += CONSULT.step;
      });
      items.push({ target: spreadTarget(summary), start: t, dur: CONSULT.jump, onLand: () => hooks.pulse && hooks.pulse() });
      const tVerdict = t + CONSULT.jump + CONSULT.verdict;
      items.push({ target: { el: summary, kind: 'perch', corner: 0, jitter: jitter() }, start: tVerdict, dur: CONSULT.perch,
        onStart: () => hooks.verdict && hooks.verdict() });
      this._run(items, () => {
        if (hooks.done) hooks.done();
        this._scheduleWander(REST.perch[1]);
      });
    }

    // Kết thúc ngay chuỗi đang chạy: gọi đủ các bước còn lại, nhện đứng ở đích cuối.
    finish() {
      const s = this.seq;
      if (!s) return;
      s.items.forEach(function (it) {
        if (!it.started) { it.started = true; if (it.onStart) it.onStart(); }
        if (!it.landed) { it.landed = true; if (it.onLand) it.onLand(); }
      });
      this._end();
    }

    // Vẽ lại chỗ nhện đang đứng (sau khi cuộn, đổi tab…); khung đã khuất thì nhảy sang khung khác.
    refresh() {
      if (!this.on) return;
      if (this.seq) { this.seq.cache = null; return; }
      if (this.redrawQueued) return;
      this.redrawQueued = true;
      requestAnimationFrame(() => {
        this.redrawQueued = false;
        if (!this.on || this.seq) return;
        if (this.rest && !this._valid(this.rest.el)) { this.rest = null; this._scheduleWander(0.15); }
        this._drawRest();
      });
    }

    // ---------- Lang thang ----------

    _scheduleWander(sec) {
      clearTimeout(this.timer);
      if (!this.on || document.hidden) return;
      this.timer = setTimeout(() => this._wander(), sec * 1000);
    }

    _wander() {
      if (!this.on || this.seq || document.hidden) return;
      const list = this._candidates();
      if (!list.length) { this._scheduleWander(2); return; }
      const others = list.filter((el) => !this.rest || el !== this.rest.el);
      const pool = others.length ? others : list;
      let target = null;
      for (let tries = 0; tries < 6 && !target; tries++) {
        const el = pool[Math.floor(Math.random() * pool.length)];
        const v = this._visible(this._rect(el));
        if (Math.random() < SPREAD_CHANCE && v.w >= SPREAD_W && v.h >= SPREAD_H) { target = spreadTarget(el); break; }
        const edges = this._visibleEdges(el);
        if (edges.length) {
          target = { el: el, kind: 'perch', edge: edges[Math.floor(Math.random() * edges.length)], u: Math.random(), jitter: jitter() };
        }
      }
      if (!target) { this._scheduleWander(1); return; }
      const from = this.restPose ? this.restPose.body : { x: this.w / 2, y: 0 };
      const to = this._pose(target).body;
      const dist = Math.hypot(to.x - from.x, to.y - from.y);
      const dur = Math.min(0.45, 0.24 + dist / 2500);
      const rest = REST[target.kind];
      this._run([{ target: target, start: 0, dur: dur }], () => {
        this._scheduleWander(rest[0] + Math.random() * (rest[1] - rest[0]));
      });
    }

    _candidates() {
      let list = [];
      try { list = this.candidatesFn() || []; } catch (e) { list = []; }
      return list.filter((el) => this._valid(el));
    }

    // Phần tử còn trên trang, đủ lớn và ít nhất một phần nằm trong vùng canvas.
    _valid(el) {
      if (!el || !el.isConnected) return false;
      const r = this._rect(el);
      if (r.w < MIN_W || r.h < MIN_H) return false;
      return r.x < this.w - 20 && r.y < this.h - 20 && r.x + r.w > 20 && r.y + r.h > 20 && this._shown(el);
    }

    // Phần tử nằm trong iframe đang bị ẩn (tab khác của khung ứng dụng) thì coi như không thấy.
    _shown(el) {
      let w = el.ownerDocument.defaultView;
      while (w && w !== this.win && w.frameElement) {
        if (getComputedStyle(w.frameElement).visibility === 'hidden') return false;
        w = w.parent;
      }
      return true;
    }

    // Phần hình chữ nhật r nằm trong canvas.
    _visible(r) {
      const x0 = Math.max(r.x, 0), y0 = Math.max(r.y, 0);
      const x1 = Math.min(r.x + r.w, this.w), y1 = Math.min(r.y + r.h, this.h);
      return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    }

    // Các mép (0 trên, 1 phải, 2 dưới, 3 trái) của phần tử đang hiện trong canvas, đủ dài để bám.
    _visibleEdges(el) {
      const ok = [];
      for (let e = 0; e < 4; e++) { const g = this._edge(this._rect(el), e); if (g && g.len >= 20) ok.push(e); }
      return ok;
    }

    // Đoạn mép e của r nằm trong canvas: { x, y, dx, dy, len, ox, oy } — điểm đầu, hướng dọc mép, độ dài, hướng ra ngoài.
    _edge(r, e) {
      const P = EDGE_PAD, W = this.w - P, H = this.h - P;
      if (e === 0 || e === 2) {
        const y = e === 0 ? r.y : r.y + r.h;
        if (y < P || y > H) return null;
        const x0 = Math.max(r.x, P), x1 = Math.min(r.x + r.w, W);
        return x1 > x0 ? { x: x0, y: y, dx: 1, dy: 0, len: x1 - x0, ox: 0, oy: e === 0 ? -1 : 1 } : null;
      }
      const x = e === 3 ? r.x : r.x + r.w;
      if (x < P || x > W) return null;
      const y0 = Math.max(r.y, P), y1 = Math.min(r.y + r.h, H);
      return y1 > y0 ? { x: x, y: y0, dx: 0, dy: 1, len: y1 - y0, ox: e === 3 ? -1 : 1, oy: 0 } : null;
    }

    _onVisibility() {
      if (document.hidden) { this.finish(); clearTimeout(this.timer); }
      else if (this.on) { this._drawRest(); this._scheduleWander(0.5); }
    }

    // ---------- Chuỗi bước nhảy ----------

    // items: [{ target, start, dur, ring?, onStart?, onLand? }] — start, dur tính bằng giây từ lúc bắt đầu chuỗi.
    _run(items, done) {
      this.seq = {
        items: items, done: done, t0: 0, last: 0,
        from: this.restPose, // tư thế xuất phát (đang đứng), null = từ mép trên
        cache: null,
      };
      if (!this.raf) this.raf = requestAnimationFrame(this._frame);
    }

    _end() {
      const s = this.seq;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.seq = null;
      const last = s.items[s.items.length - 1];
      this.rest = last.target;
      this._drawRest();
      if (s.done) s.done();
    }

    _frame(now) {
      this.raf = 0;
      const s = this.seq;
      if (!s) return;
      if (!s.t0) s.t0 = now;
      // Tab bị ẩn hoặc trình duyệt bóp nghẹt khung hình → kết thúc ngay.
      if (document.hidden || (s.last && now - s.last > 500)) { this.finish(); return; }
      s.last = now;
      const t = (now - s.t0) / 1000;
      s.items.forEach(function (it) {
        if (!it.started && t >= it.start) { it.started = true; if (it.onStart) it.onStart(); }
        if (!it.landed && t >= it.start + it.dur) { it.landed = true; if (it.onLand) it.onLand(); }
      });
      const last = s.items[s.items.length - 1];
      if (t >= last.start + last.dur + 0.16) { this._end(); return; }
      this._draw(s, t);
      this.raf = requestAnimationFrame(this._frame);
    }

    // Tư thế đích của từng bước, tính một lần rồi giữ (đổi kích thước/cuộn thì tính lại) để khỏi đo DOM mỗi khung hình.
    _poses(s) {
      if (!s.cache) {
        const poses = s.items.map((it) => this._pose(it.target));
        const start = s.from && this.rest && this._valid(this.rest.el) ? this._pose(this.rest)
          : s.from || { body: { x: poses[0].body.x, y: 0 }, feet: null };
        s.cache = { start: start, poses: poses };
      }
      return s.cache;
    }

    _draw(s, t) {
      const ctx = this.ctx;
      this._clear();
      if (!this.w || !this.h) return;
      const size = this._size();
      const c = this._poses(s);
      let k = s.items.findIndex((it) => t < it.start + it.dur);
      if (k < 0) k = s.items.length - 1;
      const item = s.items[k];
      const from = k > 0 ? c.poses[k - 1] : c.start;
      const to = c.poses[k];

      // Sợi tơ nối các điểm đã đi qua, mờ dần sau khi đáp.
      ctx.lineWidth = 1;
      ctx.strokeStyle = this.colors.leg;
      for (let i = 0; i <= k; i++) {
        const it = s.items[i];
        if (t < it.start) continue;
        const age = t - it.start - it.dur;
        const a = age < 0 ? 0.35 : 0.35 * (1 - age / SILK_LIFE);
        if (a <= 0) continue;
        const p = (i > 0 ? c.poses[i - 1] : c.start).body;
        const q = age < 0 ? bodyAt(p, c.poses[i].body, it, t) : c.poses[i].body;
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      // Vòng sóng màu theo điểm tại chỗ vừa đáp.
      s.items.forEach(function (it, i) {
        const end = it.start + it.dur;
        if (!it.ring || t < end || t > end + RING_LIFE) return;
        const p = (t - end) / RING_LIFE;
        ctx.globalAlpha = 0.7 * (1 - p);
        ctx.strokeStyle = this.colors[it.ring] || this.colors.mid;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(c.poses[i].body.x, c.poses[i].body.y, size.ring * (0.3 + p), 0, Math.PI * 2); ctx.stroke();
      }, this);
      ctx.globalAlpha = 1;

      // Thân bay vòng cung; chân co khi cất cánh, duỗi bám chỗ mới khi đáp.
      const body = t < item.start ? from.body : bodyAt(from.body, to.body, item, t);
      const t1 = item.start + item.dur;
      const feet = [];
      for (let i = 0; i < 8; i++) {
        const tuck = tuckAt(body, i, size);
        const oldFoot = from.feet ? from.feet[i] : tuck;
        const lift = item.start + i * 0.008, tucked = item.start + 0.09;
        const reach0 = t1 - 0.08 + i * 0.012, reach1 = reach0 + 0.14;
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

    _drawRest() {
      this._clear();
      this.restPose = null;
      if (!this.on || !this.rest || !this.w || !this.h || !this._valid(this.rest.el)) return;
      this.restPose = this._pose(this.rest);
      this._spider(this.restPose.body, this.restPose.feet, this._size());
    }

    // Vị trí thân và 8 chân khi đứng ở target.
    _pose(target) {
      const rc = this._rect(target.el);
      if (target.kind === 'perch') {
        // Bám trên mép khung, thân lệch ra ngoài một chút (nằm trong khe giữa các khung), 8 chân xòe rộng ra xung quanh.
        // corner (0 trên-trái … 3 dưới-phải): bám đúng góc; edge + u (0–1): điểm trên phần mép đang hiện.
        let body;
        if (target.corner != null) {
          const right = target.corner === 1 || target.corner === 3, bottom = target.corner >= 2;
          body = { x: right ? rc.x + rc.w + 4 : rc.x - 4, y: bottom ? rc.y + rc.h + 4 : rc.y - 4 };
        } else {
          const g = this._edge(rc, target.edge) || this._edge(rc, 0) || { x: rc.x, y: rc.y, dx: 1, dy: 0, len: 0, ox: 0, oy: -1 };
          body = { x: g.x + g.dx * g.len * target.u + g.ox * 4, y: g.y + g.dy * g.len * target.u + g.oy * 4 };
        }
        body = this._clamp(body);
        const s = this._size().scale;
        return { body: body, feet: this._spread(body, REST_RX * s, REST_RY * s, target.jitter) };
      }
      // Đáp xòe chân giữa phần khung đang thấy.
      const vis = this._visible(rc);
      const box = vis.w > 0 && vis.h > 0 ? vis : rc;
      const body = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      const s = this._size().scale;
      const rx = Math.max(Math.min(box.w * 0.48, 150), REST_RX * s), ry = Math.max(Math.min(box.h * 0.46, 95), REST_RY * s);
      return { body: body, feet: this._spread(body, rx, ry, target.jitter) };
    }

    // 8 bàn chân xòe quanh thân theo hình elip rx × ry (lệch ngẫu nhiên nhẹ theo j để mỗi lần trông khác nhau).
    _spread(body, rx, ry, j) {
      j = j || ZERO8;
      return LAND_ANGLES.map((a, i) => this._clamp(polar(body, a + j[i] * 8, rx * (1 + j[i] * 0.06), ry)));
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

    // Kích thước nhện theo bề rộng (nhỏ hơn trên điện thoại).
    _size() {
      const scale = this.w < 560 ? 1 : 1.2;
      return { scale: scale, bw: 8 * scale, bh: 16 * scale, ring: 36 * scale };
    }

    // ---------- Hình học / kích thước ----------

    _clear() { this.ctx.clearRect(0, 0, this.w, this.h); }

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
      if (this.seq) this.seq.cache = null; // khung hình sau tự tính lại vị trí
      else this._drawRest();
    }

    // Hình chữ nhật của phần tử theo tọa độ canvas, kể cả phần tử nằm trong iframe (cộng dồn vị trí các iframe).
    _rect(el) {
      const r = el.getBoundingClientRect();
      let x = r.left, y = r.top;
      let w = el.ownerDocument.defaultView;
      while (w && w !== this.win && w.frameElement) {
        const f = w.frameElement, fr = f.getBoundingClientRect();
        x += fr.left + f.clientLeft;
        y += fr.top + f.clientTop;
        w = w.parent;
      }
      const c = this.canvas.getBoundingClientRect();
      return { x: x - c.left, y: y - c.top, w: r.width, h: r.height };
    }
    _clamp(p) {
      return { x: Math.min(this.w - 4, Math.max(4, p.x)), y: Math.min(this.h - 4, Math.max(4, p.y)) };
    }
  }

  // Lựa chọn bật/tắt (mặc định bật) dùng chung mọi trang; máy bật giảm chuyển động thì luôn tắt.
  Spider.prefOn = function () {
    try { return localStorage.getItem(PREF_KEY) !== 'off'; } catch (e) { return true; }
  };
  Spider.setPref = function (on) {
    try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch (e) { /* bỏ qua: chế độ ẩn danh */ }
  };
  Spider.reducedMotion = function () { return !!(reduced && reduced.matches); };
  Spider.allowed = function () { return Spider.prefOn() && !Spider.reducedMotion(); };
  // Gọi fn khi lựa chọn đổi (ở trang khác) hoặc khi máy đổi chế độ giảm chuyển động.
  Spider.onPrefChange = function (fn) {
    window.addEventListener('storage', function (e) { if (e.key === PREF_KEY) fn(); });
    if (reduced) {
      if (reduced.addEventListener) reduced.addEventListener('change', fn);
      else if (reduced.addListener) reduced.addListener(fn);
    }
  };
  Spider.PREF_KEY = PREF_KEY;

  function findCandidates(doc) {
    return Array.prototype.slice.call(doc.querySelectorAll(SELECTOR));
  }
  Spider.findCandidates = findCandidates;

  function finishHooks(n, hooks) {
    for (let i = 0; i < n; i++) if (hooks.reveal) hooks.reveal(i);
    if (hooks.pulse) hooks.pulse();
    if (hooks.verdict) hooks.verdict();
    if (hooks.done) hooks.done();
  }
  const ZERO8 = [0, 0, 0, 0, 0, 0, 0, 0];
  function spreadTarget(el) { return { el: el, kind: 'spread', jitter: jitter() }; }
  function bodyAt(a, b, item, t) {
    const p = Math.min(1, Math.max(0, (t - item.start) / item.dur));
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const lift = Math.min(70, 12 + dist * 0.3);
    return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e - Math.sin(Math.PI * p) * lift };
  }
  // Chân co sát thân khi bay.
  function tuckAt(body, i, size) {
    const side = i < 4 ? -1 : 1, row = i % 4;
    return { x: body.x + side * (size.bw + 16 * size.scale), y: body.y + (row - 1.5) * 9 * size.scale };
  }
  function polar(c, deg, rx, ry) {
    const a = deg * Math.PI / 180;
    return { x: c.x + Math.cos(a) * rx, y: c.y + Math.sin(a) * ry };
  }
  function mix(a, b, p) { return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p }; }
  function easeOut(p) { return 1 - Math.pow(1 - p, 3); }
  function easeOutBack(p) { const c = 1.7; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); }
  function jitter() { const a = []; for (let i = 0; i < 8; i++) a.push(Math.random() * 2 - 1); return a; }

  return Spider;
})();
