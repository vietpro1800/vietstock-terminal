// Trang "Khấn mã" (temple.html): các hàm thuần (không DOM, không mạng), chạy được cả trong Node.
// Dùng VST.priceboard.priceLimits / priceClass (js/priceboard.js) để tính trần/sàn.
// Kiểm thử: node tests/temple.test.js
(function (root) {
  const VST = root.VST = root.VST || {};
  const VN_OFFSET = 7 * 3600; // giây

  // Pháp danh vui theo thói quen nhà đầu tư; mỗi tài khoản cố định một pháp danh (băm từ id).
  const NAMES = [
    'Thích Đọc BCTC', 'Thích Bluechip', 'Thích Phái Sinh', 'Thích Tất Tay', 'Thích Phân Tích Kỹ Thuật',
    'Thích Hàng Về', 'Thích Cổ Tức', 'Thích Midcap', 'Thích Dòng Bank', 'Thích Canh Điểm Mua',
    'Thích Chốt Lời', 'Thích Bắt Đáy', 'Thích Ký Quỹ', 'Thích Lướt Sóng', 'Thích Ôm Dài Hạn',
    'Thích Cắt Lỗ', 'Thích Penny', 'Thích Tin Đồn', 'Thích Room Ngoại', 'Thích Vùng Hỗ Trợ',
  ];

  // Quẻ xin trong điện (chỉ để vui). rank: 'great' | 'good' | 'mid' | 'bad'.
  const FORTUNES = [
    { rank: 'great', title: 'Thượng thượng', text: 'Rồng gặp mây, {s} có lực cầu mạnh. Giữ vững tâm, đừng bán non.' },
    { rank: 'great', title: 'Thượng cát', text: 'Tím trần không xa, nhưng nhớ đặt điểm chốt lời trước khi mơ.' },
    { rank: 'good', title: 'Trung cát', text: 'Dòng tiền đang về, {s} đi từ từ mà chắc. Kiên nhẫn là công đức.' },
    { rank: 'good', title: 'Tiểu cát', text: 'Có sóng nhỏ cho {s}. Lướt thì nhanh tay, ôm thì bền chí.' },
    { rank: 'mid', title: 'Bình', text: '{s} đi ngang tích lũy. Gõ mõ đều tay, đừng vội tất tay.' },
    { rank: 'mid', title: 'Trung bình', text: 'Mây che nửa trăng. Chờ {s} vượt kháng cự rồi hãy tăng tỷ trọng.' },
    { rank: 'bad', title: 'Hạ', text: 'Gió ngược. Nhớ quy tắc cắt lỗ, giữ tiền là giữ đạo.' },
    { rank: 'bad', title: 'Hạ hạ', text: 'Đừng dùng ký quỹ hôm nay. Đọc lại báo cáo tài chính của {s} cho tâm an.' },
  ];

  // Băm chuỗi FNV-1a 32 bit → số nguyên không âm (ổn định giữa các trình duyệt).
  function hash(str) {
    let h = 0x811c9dc5;
    const s = String(str == null ? '' : str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }

  function dharmaName(seed) { return NAMES[hash(seed) % NAMES.length]; }

  // n pháp danh khác nhau cho các "nhà sư" trang trí trong điện (không trùng pháp danh của người xem).
  function monkNames(n, exclude) {
    return NAMES.filter((x) => x !== exclude).slice(0, Math.max(0, n));
  }

  // Lời khấn mẫu cho một mã.
  function presets(sym) {
    return [
      'Cầu ' + sym + ' tím trần 🟣',
      'Cầu ' + sym + ' xanh mướt 🌱',
      'Cầu hàng ' + sym + ' về sớm 📦',
      'Cầu ' + sym + ' thoát đáy 🪜',
      'Cầu tài khoản hết đỏ 🍀',
    ];
  }

  // Quẻ của một người cho một mã trong một ngày (cùng ngày xin lại vẫn ra quẻ cũ).
  function fortune(seed, sym, dayKey) {
    const f = FORTUNES[hash(seed + '|' + sym + '|' + dayKey) % FORTUNES.length];
    return { rank: f.rank, title: f.title, text: f.text.replace(/\{s\}/g, sym) };
  }

  // Số ngày (giờ VN) kể từ 1970 — khóa "hôm nay".
  function dayKey(ms) { return Math.floor((ms / 1000 + VN_OFFSET) / 86400); }

  // Phiên giao dịch theo giờ VN: open (9:00–11:30, 13:00–15:00, thứ Hai–Sáu), lunch, closed.
  function session(ms) {
    const d = new Date(ms + VN_OFFSET * 1000);
    const wd = d.getUTCDay();
    const m = d.getUTCHours() * 60 + d.getUTCMinutes();
    if (wd === 0 || wd === 6) return { id: 'closed', label: 'Ngoài giờ giao dịch' };
    if ((m >= 540 && m < 690) || (m >= 780 && m < 900)) return { id: 'open', label: 'Đang giao dịch' };
    if (m >= 690 && m < 780) return { id: 'lunch', label: 'Nghỉ trưa' };
    return { id: 'closed', label: 'Ngoài giờ giao dịch' };
  }

  // Giá và tham chiếu từ nến ngày: phiên cuối so với phiên trước đó.
  function fromBars(bars) {
    const ok = (bars || []).filter((b) => b && b.close > 0);
    if (!ok.length) return null;
    const last = ok[ok.length - 1];
    const prev = ok.length > 1 ? ok[ok.length - 2] : null;
    return { price: last.close, ref: prev ? prev.close : last.open || last.close, time: last.time };
  }

  // Trạng thái một mã: % thay đổi, lớp màu (ceil/floor/up/down/ref), trần/sàn và còn bao nhiêu % tới trần.
  function quoteState(price, ref, exchange) {
    const pb = VST.priceboard;
    if (!(price > 0) || !(ref > 0)) return null;
    const lim = pb ? pb.priceLimits(ref, exchange) : { ceil: null, floor: null };
    const chg = price - ref;
    return {
      price: price,
      ref: ref,
      chg: chg,
      pct: (chg / ref) * 100,
      cls: pb ? pb.priceClass(price, ref, lim.ceil, lim.floor) : chg > 0 ? 'up' : chg < 0 ? 'down' : 'ref',
      ceil: lim.ceil,
      floor: lim.floor,
      toCeil: lim.ceil ? Math.max(0, ((lim.ceil - price) / price) * 100) : null,
    };
  }

  // Số nén nhang còn cháy: lượt thắp trong `minutes` phút gần nhất.
  function burning(rows, nowMs, minutes) {
    const from = nowMs - minutes * 60000;
    return (rows || []).filter(function (r) {
      const t = Date.parse(r.created_at);
      return r.kind === 'incense' && t >= from && t <= nowMs + 60000;
    }).length;
  }

  // Chuẩn hóa lời khấn người dùng nhập: bỏ khoảng trắng thừa, cắt theo độ dài tối đa.
  function cleanPrayer(text, maxLen) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return Array.from(s).slice(0, maxLen || 200).join('');
  }

  VST.temple = {
    NAMES: NAMES,
    FORTUNES: FORTUNES,
    hash: hash,
    dharmaName: dharmaName,
    monkNames: monkNames,
    presets: presets,
    fortune: fortune,
    dayKey: dayKey,
    session: session,
    fromBars: fromBars,
    quoteState: quoteState,
    burning: burning,
    cleanPrayer: cleanPrayer,
  };
})(typeof window !== 'undefined' ? window : globalThis);
