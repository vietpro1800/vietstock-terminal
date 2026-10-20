// Bản đồ nhiệt (treemap): hàm thuần, không đụng DOM, không gọi mạng. Chạy được cả trong Node (để kiểm thử).
//   layout(groups, w, h, opts) — xếp ô 2 cấp (ngành → mã) bằng thuật toán squarified (Bruls và cộng sự, 2000).
//   change(row, n, todayKey)   — % thay đổi giá so với n phiên trước (có tính giá realtime).
//   bucket(pct, steps, scale)  — mức màu của một % thay đổi.
(function (root) {
  const VST = root.VST = root.VST || {};
  const VN_OFFSET = 7 * 3600;

  function dayKey(t) { return Math.floor((t + VN_OFFSET) / 86400); }

  // Tỷ lệ cạnh xấu nhất của một hàng diện tích `row` đặt dọc theo cạnh dài `side`.
  function worst(row, sum, side) {
    let max = 0, min = Infinity;
    for (const a of row) { if (a > max) max = a; if (a < min) min = a; }
    const s2 = side * side, sum2 = sum * sum;
    return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
  }

  // values: số dương, đã xếp giảm dần. Trả về [{x, y, w, h}] cùng thứ tự, phủ kín hình chữ nhật.
  function squarify(values, x, y, w, h) {
    const out = new Array(values.length);
    const total = values.reduce((t, v) => t + v, 0);
    if (!(total > 0) || !(w > 0) || !(h > 0)) {
      for (let i = 0; i < values.length; i++) out[i] = { x: x, y: y, w: 0, h: 0 };
      return out;
    }
    const scale = (w * h) / total;
    const areas = values.map((v) => v * scale);
    let i = 0;
    while (i < areas.length) {
      const side = Math.min(w, h);
      const row = [areas[i]];
      let sum = areas[i];
      let j = i + 1;
      while (j < areas.length) {
        const next = sum + areas[j];
        if (worst(row.concat(areas[j]), next, side) > worst(row, sum, side)) break;
        row.push(areas[j]);
        sum = next;
        j++;
      }
      const last = j >= areas.length;
      if (w >= h) {
        // Hàng là một cột bên trái.
        const cw = last ? w : Math.min(w, sum / h);
        let cy = y;
        row.forEach(function (a, k) {
          const ch = k === row.length - 1 ? y + h - cy : a / cw;
          out[i + k] = { x: x, y: cy, w: cw, h: Math.max(0, ch) };
          cy += ch;
        });
        x += cw; w -= cw;
      } else {
        const rh = last ? h : Math.min(h, sum / w);
        let cx = x;
        row.forEach(function (a, k) {
          const cw = k === row.length - 1 ? x + w - cx : a / rh;
          out[i + k] = { x: cx, y: y, w: Math.max(0, cw), h: rh };
          cx += cw;
        });
        y += rh; h -= rh;
      }
      i = j;
    }
    return out;
  }

  // groups: [{ id, name, items: [{ id, value, ... }] }]. Ô có value ≤ 0 bị bỏ qua.
  // opts.header: chiều cao dải tên ngành (bỏ khi ô ngành quá nhỏ), opts.gap: khoảng hở giữa các ngành.
  // Trả về { groups: [{ group, x, y, w, h, header }], tiles: [{ item, group, x, y, w, h }] }.
  function layout(groups, w, h, opts) {
    opts = opts || {};
    const header = opts.header == null ? 16 : opts.header;
    const gap = opts.gap == null ? 2 : opts.gap;
    const byValue = (a, b) => b.value - a.value;
    const gs = groups.map(function (g) {
      const items = g.items.filter((it) => it.value > 0).sort(byValue);
      return { group: g, items: items, value: items.reduce((t, it) => t + it.value, 0) };
    }).filter((g) => g.value > 0).sort(byValue);

    const rects = squarify(gs.map((g) => g.value), 0, 0, w, h);
    const outGroups = [];
    const tiles = [];
    gs.forEach(function (g, k) {
      const r = rects[k];
      const ix = r.x + gap / 2, iy = r.y + gap / 2;
      const iw = Math.max(0, r.w - gap), ih = Math.max(0, r.h - gap);
      const showHeader = iw >= 60 && ih >= header * 3;
      const hh = showHeader ? header : 0;
      outGroups.push({ group: g.group, x: ix, y: iy, w: iw, h: ih, header: showHeader });
      const inner = squarify(g.items.map((it) => it.value), ix, iy + hh, iw, ih - hh);
      g.items.forEach(function (it, n) {
        tiles.push(Object.assign({ item: it, group: g.group }, inner[n]));
      });
    });
    return { groups: outGroups, tiles: tiles };
  }

  // row: { closes: [giá đóng cửa ngày, cũ → mới], lastDay: dayKey nến cuối, rt: {price, ref} | null }.
  // n: số phiên so sánh (1 = so với tham chiếu). todayKey: dayKey hôm nay (giờ VN).
  // Có giá realtime: đó là giá phiên hôm nay; nếu nến cuối cũng là hôm nay thì bỏ nến đó khi tìm giá gốc.
  // Trả về { price, base, pct } hoặc null nếu thiếu dữ liệu.
  function change(row, n, todayKey) {
    const c = row.closes || [];
    const rt = row.rt && row.rt.price > 0 ? row.rt : null;
    const hist = rt ? (row.lastDay === todayKey ? c.slice(0, -1) : c) : c.slice(0, -1);
    const price = rt ? rt.price : c[c.length - 1];
    let base = hist[hist.length - n];
    if (n === 1 && rt && rt.ref > 0) base = rt.ref;
    if (!(price > 0) || !(base > 0)) return null;
    return { price: price, base: base, pct: (price / base - 1) * 100 };
  }

  // Mức màu: 'z' (đứng giá), 'u1'…'u5' (tăng), 'd1'…'d5' (giảm). steps: ngưỡng % tăng dần, ví dụ [1, 2, 3, 5];
  // scale: hệ số giãn ngưỡng cho kỳ dài (biến động 1 tháng lớn hơn 1 phiên).
  function bucket(pct, steps, scale) {
    if (pct == null || !isFinite(pct)) return '';
    const a = Math.abs(pct);
    if (a < 0.005) return 'z';
    let lv = 1;
    for (const s of steps) if (a >= s * (scale || 1)) lv++;
    return (pct > 0 ? 'u' : 'd') + Math.min(lv, steps.length + 1);
  }

  // GTGD bình quân k phiên cuối (tỷ đồng; giá nghìn đồng × KL cổ phiếu).
  function avgValue(bars, k) {
    const m = Math.min(k, bars.length);
    if (!m) return 0;
    let v = 0;
    for (let i = bars.length - m; i < bars.length; i++) v += bars[i].close * bars[i].volume;
    return v / m / 1e6;
  }

  VST.heatmap = {
    dayKey: dayKey,
    squarify: squarify,
    layout: layout,
    change: change,
    bucket: bucket,
    avgValue: avgValue,
  };
})(typeof window !== 'undefined' ? window : globalThis);
