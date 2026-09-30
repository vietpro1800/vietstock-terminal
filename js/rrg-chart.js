// Vẽ biểu đồ RRG bằng SVG: 4 góc phần tư, đuôi mượt, nhãn ở điểm đầu, phóng to/kéo, chú thích khi rê chuột.
// Màu lấy từ biến CSS (class q-leading / q-weakening / q-lagging / q-improving trong style.css).
window.VST = window.VST || {};

(function () {
  const NS = 'http://www.w3.org/2000/svg';
  // Lề trên chừa chỗ cho các nút phóng to/thu nhỏ.
  const M = { left: 52, right: 10, top: 44, bottom: 34 };
  const esc = function (s) { return VST.escapeHtml ? VST.escapeHtml(s) : String(s); };

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function niceStep(span, target) {
    const raw = span / Math.max(target, 1);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }

  // Đường cong Catmull-Rom qua các điểm → path SVG dạng cubic Bézier.
  function smoothPath(pts) {
    if (!pts.length) return '';
    let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += 'C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' +
        p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
    }
    return d;
  }

  class RrgChart {
    // opts: { onSelect(id), fmtTip(item) → html }
    constructor(container, opts) {
      this.box = container;
      this.opts = opts || {};
      this.items = [];
      this.focus = null;   // id đang rê chuột / chạm
      this.pinned = null;  // id được chọn (giữ nổi bật)
      this.base = null;    // khung gốc
      this.view = null;    // khung đang xem

      this.svg = el('svg', { class: 'rrg-svg', role: 'img', 'aria-label': 'Biểu đồ RRG' }, container);
      this.tip = document.createElement('div');
      this.tip.className = 'rrg-tip';
      this.tip.hidden = true;
      container.appendChild(this.tip);

      const tools = document.createElement('div');
      tools.className = 'rrg-tools';
      tools.innerHTML =
        '<span class="rrg-zoom" aria-live="polite"></span>' +
        '<button type="button" data-z="in" aria-label="Phóng to">+</button>' +
        '<button type="button" data-z="out" aria-label="Thu nhỏ">−</button>' +
        '<button type="button" data-z="reset" aria-label="Về khung gốc">⟲</button>';
      container.appendChild(tools);
      this.zoomLabel = tools.querySelector('.rrg-zoom');
      tools.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-z]');
        if (!b) return;
        if (b.dataset.z === 'reset') this.resetView();
        else this._zoomAt(b.dataset.z === 'in' ? 1 / 1.3 : 1.3, null);
      });

      this._bindPanZoom();
      this.svg.addEventListener('click', (e) => {
        const g = e.target.closest('[data-id]');
        if (g) { this.opts.onSelect && this.opts.onSelect(g.dataset.id); return; }
        if (this.pinned && !this._dragged) { this.setPinned(null); }
      });
      if (window.ResizeObserver) new ResizeObserver(() => this.render()).observe(container);
      else window.addEventListener('resize', () => this.render());
    }

    // items: [{ id, name, points:[{ratio, momentum, time}], quadrant, ... }]; keepView: giữ khung đang xem.
    setData(items, keepView) {
      this.items = items;
      this.base = this._fit();
      if (!keepView || !this.view) this.view = Object.assign({}, this.base);
      if (this.pinned && !items.some((it) => it.id === this.pinned)) this.pinned = null;
      this.render();
    }

    setPinned(id) {
      this.pinned = id;
      this.render();
    }

    resetView() {
      if (!this.base) return;
      this.view = Object.assign({}, this.base);
      this.render();
    }

    _fit() {
      let x0 = 100, x1 = 100, y0 = 100, y1 = 100;
      this.items.forEach(function (it) {
        it.points.forEach(function (p) {
          x0 = Math.min(x0, p.ratio); x1 = Math.max(x1, p.ratio);
          y0 = Math.min(y0, p.momentum); y1 = Math.max(y1, p.momentum);
        });
      });
      const pad = function (a, b) {
        const span = Math.max(b - a, 1);
        return [a - span * 0.08, b + span * 0.08];
      };
      const x = pad(x0, x1), y = pad(y0, y1);
      return { x0: x[0], x1: x[1], y0: y[0], y1: y[1] };
    }

    // f < 1: phóng to. at: {x, y} theo tọa độ dữ liệu (mặc định giữa khung).
    _zoomAt(f, at) {
      const v = this.view;
      if (!v) return;
      const cx = at ? at.x : (v.x0 + v.x1) / 2;
      const cy = at ? at.y : (v.y0 + v.y1) / 2;
      const span = (v.x1 - v.x0) * f;
      const baseSpan = this.base.x1 - this.base.x0;
      if (span < baseSpan / 20 || span > baseSpan * 5) return;
      this.view = { x0: cx - (cx - v.x0) * f, x1: cx + (v.x1 - cx) * f, y0: cy - (cy - v.y0) * f, y1: cy + (v.y1 - cy) * f };
      this.render();
    }

    _bindPanZoom() {
      const svg = this.svg;
      let drag = null;
      svg.addEventListener('wheel', (e) => {
        if (!this.view) return;
        e.preventDefault();
        this._zoomAt(e.deltaY < 0 ? 1 / 1.15 : 1.15, this._toData(e));
      }, { passive: false });
      svg.addEventListener('dblclick', (e) => { e.preventDefault(); this.resetView(); });
      svg.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('[data-id]')) return;
        drag = { x: e.clientX, y: e.clientY, view: Object.assign({}, this.view) };
        this._dragged = false;
      });
      window.addEventListener('pointermove', (e) => {
        if (!drag || !this._scale) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) this._dragged = true;
        if (!this._dragged) return;
        const s = this._scale;
        const ddx = -dx / s.kx, ddy = dy / s.ky;
        this.view = { x0: drag.view.x0 + ddx, x1: drag.view.x1 + ddx, y0: drag.view.y0 + ddy, y1: drag.view.y1 + ddy };
        this.render();
      });
      window.addEventListener('pointerup', () => { drag = null; setTimeout(() => { this._dragged = false; }, 0); });
    }

    _toData(e) {
      const r = this.svg.getBoundingClientRect();
      const s = this._scale;
      if (!s) return null;
      return { x: s.x0 + (e.clientX - r.left - M.left) / s.kx, y: s.y1 - (e.clientY - r.top - M.top) / s.ky };
    }

    render() {
      const W = this.box.clientWidth, H = this.box.clientHeight;
      const svg = this.svg;
      svg.innerHTML = '';
      if (!W || !H || !this.view) return;
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('width', W);
      svg.setAttribute('height', H);

      const v = this.view;
      const pw = W - M.left - M.right, ph = H - M.top - M.bottom;
      const kx = pw / (v.x1 - v.x0), ky = ph / (v.y1 - v.y0);
      this._scale = { kx: kx, ky: ky, x0: v.x0, y1: v.y1 };
      const sx = (x) => M.left + (x - v.x0) * kx;
      const sy = (y) => M.top + (v.y1 - y) * ky;
      const clampX = (x) => Math.min(Math.max(x, M.left), M.left + pw);
      const clampY = (y) => Math.min(Math.max(y, M.top), M.top + ph);

      const defs = el('defs', {}, svg);
      const clip = el('clipPath', { id: 'rrg-clip' }, defs);
      el('rect', { x: M.left, y: M.top, width: pw, height: ph }, clip);

      // Góc phần tư
      const cx = clampX(sx(100)), cy = clampY(sy(100));
      const L = M.left, T = M.top, R = M.left + pw, B = M.top + ph;
      el('rect', { class: 'rrg-bg q-improving', x: L, y: T, width: cx - L, height: cy - T }, svg);
      el('rect', { class: 'rrg-bg q-leading', x: cx, y: T, width: R - cx, height: cy - T }, svg);
      el('rect', { class: 'rrg-bg q-lagging', x: L, y: cy, width: cx - L, height: B - cy }, svg);
      el('rect', { class: 'rrg-bg q-weakening', x: cx, y: cy, width: R - cx, height: B - cy }, svg);

      // Lưới và trục
      const grid = el('g', { class: 'rrg-grid' }, svg);
      const stepX = niceStep(v.x1 - v.x0, pw / 80), stepY = niceStep(v.y1 - v.y0, ph / 50);
      const dec = (s) => (s >= 1 ? 0 : s >= 0.1 ? 1 : 2);
      for (let x = Math.ceil(v.x0 / stepX) * stepX; x <= v.x1; x += stepX) {
        el('line', { x1: sx(x), x2: sx(x), y1: T, y2: B }, grid);
        const t = el('text', { x: sx(x), y: B + 14, class: 'rrg-tick', 'text-anchor': 'middle' }, svg);
        t.textContent = x.toFixed(dec(stepX)).replace('.', ',');
      }
      for (let y = Math.ceil(v.y0 / stepY) * stepY; y <= v.y1; y += stepY) {
        el('line', { x1: L, x2: R, y1: sy(y), y2: sy(y) }, grid);
        const t = el('text', { x: L - 6, y: sy(y) + 4, class: 'rrg-tick', 'text-anchor': 'end' }, svg);
        t.textContent = y.toFixed(dec(stepY)).replace('.', ',');
      }
      el('line', { class: 'rrg-axis', x1: cx, x2: cx, y1: T, y2: B }, svg);
      el('line', { class: 'rrg-axis', x1: L, x2: R, y1: cy, y2: cy }, svg);
      el('rect', { class: 'rrg-frame', x: L, y: T, width: pw, height: ph }, svg);
      const xl = el('text', { x: L + pw / 2, y: H - 4, class: 'rrg-axis-label', 'text-anchor': 'middle' }, svg);
      xl.textContent = 'RS-Ratio →';
      const yl = el('text', { x: 10, y: T + ph / 2, class: 'rrg-axis-label', 'text-anchor': 'middle', transform: 'rotate(-90 10 ' + (T + ph / 2) + ')' }, svg);
      yl.textContent = 'RS-Momentum →';

      const qLabel = (text, x, y, anchor, cls) => {
        const t = el('text', { x: x, y: y, class: 'rrg-q-label ' + cls, 'text-anchor': anchor }, svg);
        t.textContent = text;
      };
      qLabel('CẢI THIỆN', L + 8, T + 16, 'start', 'q-improving');
      qLabel('DẪN DẮT', R - 8, T + 16, 'end', 'q-leading');
      qLabel('TỤT HẬU', L + 8, B - 8, 'start', 'q-lagging');
      qLabel('SUY YẾU', R - 8, B - 8, 'end', 'q-weakening');

      // Đường đuôi (vẽ mục đang chọn sau cùng để nằm trên)
      const plot = el('g', { 'clip-path': 'url(#rrg-clip)' }, svg);
      const active = this.focus || this.pinned;
      const order = this.items.slice().sort((a, b) => (a.id === active) - (b.id === active));
      const labels = [];
      order.forEach((it) => {
        if (!it.points.length) return;
        const pts = it.points.map((p) => [sx(p.ratio), sy(p.momentum)]);
        const dim = active && it.id !== active;
        const g = el('g', { class: 'rrg-series q-' + it.quadrant + (dim ? ' dim' : '') + (it.id === active ? ' active' : '') }, plot);
        el('path', { d: smoothPath(pts), class: 'rrg-tail' }, g);
        pts.slice(0, -1).forEach((p, i) => {
          el('circle', { cx: p[0], cy: p[1], r: 1.6 + (i / pts.length) * 1.2, class: 'rrg-dot' }, g);
        });
        const h = pts[pts.length - 1];
        el('circle', { cx: h[0], cy: h[1], r: it.id === active ? 6 : 4.5, class: 'rrg-head' }, g);
        labels.push({ it: it, x: h[0], y: h[1], g: g, dim: dim });
      });

      // Nhãn: tránh chồng lên nhau bằng cách thử dịch lên/xuống.
      const placed = [];
      labels.sort((a, b) => (a.it.id === active) - (b.it.id === active)).reverse().forEach((lb) => {
        const w = lb.it.name.length * 7.2 + 4, hgt = 14;
        // Sát mép phải thì đặt nhãn sang bên trái điểm đầu; không vừa cả hai phía thì dịch vào trong khung.
        const overRight = lb.x + 9 + w > R;
        const left = overRight && lb.x - 9 - w >= L;
        const bx = left ? lb.x - 9 - w : overRight ? Math.max(L + 2, R - w) : lb.x + 8;
        const offsets = [0, -14, 14, -28, 28, -42, 42];
        let y = lb.y;
        for (const o of offsets) {
          const box = { x: bx, y: lb.y + o - 10, w: w, h: hgt };
          if (!placed.some((p) => box.x < p.x + p.w && p.x < box.x + box.w && box.y < p.y + p.h && p.y < box.y + box.h)) {
            placed.push(box);
            y = lb.y + o;
            break;
          }
        }
        const t = el('text', {
          x: left ? lb.x - 9 : bx + 1, y: y + 4, class: 'rrg-label', 'data-id': lb.it.id, 'text-anchor': left ? 'end' : 'start',
        }, lb.g);
        t.textContent = lb.it.name;
      });

      // Vùng chạm ở điểm đầu nằm trên cùng để nhãn của mục khác không che mất.
      const hits = el('g', { 'clip-path': 'url(#rrg-clip)' }, svg);
      labels.forEach((lb) => {
        const hit = el('circle', { cx: lb.x, cy: lb.y, r: 14, class: 'rrg-hit', 'data-id': lb.it.id }, hits);
        hit.addEventListener('pointerenter', () => this._hover(lb.it, [lb.x, lb.y]));
        hit.addEventListener('pointerleave', () => this._hover(null));
      });

      const zoom = (this.base.x1 - this.base.x0) / (v.x1 - v.x0);
      this.zoomLabel.textContent = Math.abs(zoom - 1) < 0.01 ? '' : '×' + zoom.toFixed(1).replace('.', ',');
    }

    _hover(it, pos) {
      const prev = this.focus;
      this.focus = it ? it.id : null;
      if (!it) {
        this.tip.hidden = true;
      } else {
        this.tip.innerHTML = this.opts.fmtTip ? this.opts.fmtTip(it) : esc(it.name);
        this.tip.hidden = false;
        const bw = this.box.clientWidth;
        const tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
        let x = pos[0] + 12, y = pos[1] - th - 8;
        if (x + tw > bw - 4) x = pos[0] - tw - 12;
        if (y < 4) y = pos[1] + 12;
        this.tip.style.left = Math.max(4, x) + 'px';
        this.tip.style.top = y + 'px';
      }
      if (prev !== this.focus) this.render();
    }
  }

  VST.RrgChart = RrgChart;
})();
