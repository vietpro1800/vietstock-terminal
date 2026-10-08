# CLAUDE.md — Quy ước dự án ThảoChi Stock

Web dashboard chứng khoán Việt Nam, chạy tĩnh trên GitHub Pages. Hiện dùng cá nhân,
sau này mở rộng nhiều người dùng có đăng nhập.

## Quy ước bắt buộc

- **Giao diện tiếng Việt**: mọi nhãn, nút, thông báo lỗi hiển thị cho người dùng đều bằng tiếng Việt.
  Tên biến/hàm trong code dùng tiếng Anh.
- **Nền tối**: dùng biến màu trong `:root` của `css/style.css`, không viết mã màu rải rác.
  Màu giá theo thói quen thị trường VN: tăng = xanh lá, giảm = đỏ, đứng giá = vàng.
- **Ưu tiên điện thoại (mobile-first)**: CSS viết cho màn hình hẹp trước, mở rộng bằng
  `@media (min-width: ...)`. Không để trang bị cuộn ngang; vùng bấm tối thiểu ~40px.
  Dashboard (`index.html`, `<body class="dash">`): từ 768px chia 2 cột — biểu đồ 3/4 trái, sổ lệnh + thảo luận/bảng giá
  1/4 phải; nếu cao ≥ 560px thì gói trong 1 màn hình (không cuộn trang), các khung danh sách tự co giãn và cuộn bên trong.
- **HTML/CSS/JS thuần, không build**: không npm, không bundler, không framework.
  Thư viện ngoài chỉ nạp qua CDN, **ghim phiên bản cụ thể** (ví dụ `lightweight-charts@4.2.3`).
  Mở `index.html` qua một web server tĩnh bất kỳ là chạy được.
- **Chống bộ nhớ đệm cũ**: mọi `css/…` và `js/…` trong các file HTML đều có `?v=YYYYMMDD`.
  Mỗi lần sửa CSS/JS phải **đổi số này ở tất cả file HTML** (cùng một giá trị), nếu không trình duyệt
  có thể chạy HTML mới với JS/CSS cũ (GitHub Pages cho cache 10 phút).
- **Tách file rõ ràng**:
  - `css/style.css` — toàn bộ style.
  - `js/config.js` — hằng số cấu hình (danh sách mã, chu kỳ làm mới, khung thời gian).
  - `js/data.js` — lớp lấy dữ liệu. **Mọi lệnh gọi mạng chỉ nằm ở đây.** Đổi nguồn dữ liệu
    = viết lớp mới cùng giao diện (`getHistory`, `getHistoryBatch`) rồi đổi một dòng trong `app.js`.
  - `js/indicators.js` — hàm tính chỉ báo thuần (không đụng DOM).
  - `js/chart.js` — vẽ biểu đồ (Lightweight Charts).
  - `js/board.js` — bảng giá.
  - `js/orderbook.js` — khung sổ lệnh/khớp lệnh (chỉ hiển thị; dữ liệu từ `VST.SsiRealtimeFeed` trong `data.js`).
  - `js/chat.js` — thảo luận theo mã (bảng `stock_comments` trong Supabase, realtime).
  - `js/app.js` — khởi tạo, gắn sự kiện, tự làm mới.
  - `js/backtest.js` — công cụ backtest thuần (không DOM, không mạng), chạy được cả trong Node.
    `js/backtest-page.js` — logic trang `backtest.html`. Kiểm thử: `node tests/backtest.test.js`
    (phải đạt hết trước khi commit nếu sửa `backtest.js` hoặc `indicators.js`).
  - `js/rrg.js` — tính RRG thuần (chỉ số ngành, RS-Ratio, RS-Momentum). `js/rrg-chart.js` — vẽ RRG bằng SVG.
    `js/rrg-page.js` — logic trang `rrg.html`. Danh sách ngành và mã nằm ở `VST.config.rrg.sectors`.
    Kiểm thử: `node tests/rrg.test.js` (phải đạt hết nếu sửa `rrg.js` hoặc `indicators.js`).
  - `js/auth.js` — Supabase client, `VST.auth.guard()`, thanh người dùng, dịch lỗi sang tiếng Việt.
  - `js/login.js`, `js/reset.js`, `js/admin.js` — logic riêng của `login.html`,
    `reset-password.html`, `admin.html`.
  - `supabase/schema.sql` — bảng, trigger, RLS. Phải chạy lại được nhiều lần (idempotent).
  - Các file JS dùng chung namespace `window.VST`, nạp theo thứ tự trong `index.html`.
- **Không bao giờ đưa khóa bí mật vào code**: không API key, token, mật khẩu, chuỗi kết nối
  trong bất kỳ file nào được commit. Web tĩnh thì mọi thứ trong code đều công khai.
  Ngoại lệ duy nhất: Supabase **publishable key** (`sb_publishable_...`) trong `js/config.js` — khóa công khai
  theo thiết kế. **Tuyệt đối không dùng/yêu cầu khóa `secret` (`sb_secret_...`) hay `service_role`.**
  Khi cần quyền cao hơn, phải đi qua backend/serverless giữ bí mật phía máy chủ.

## Đăng nhập & phân quyền (Supabase Auth)

- Mọi trang dashboard (hiện là `index.html`, `rrg.html`, `backtest.html`, `admin.html`) phải: đặt `class="auth-checking"` trên `<html>`,
  nạp supabase-js + `config.js` + `auth.js`, và chỉ chạy code trang bên trong `VST.auth.guard().then(...)`
  (`guard({ admin: true })` cho trang quản trị). Chưa đăng nhập / chưa `active` → tự chuyển về `login.html`.
- Bảng `profiles`: `role` ∈ admin/user, `status` ∈ pending/active/locked. Người mới luôn là `pending`.
- **Quyền thật nằm ở RLS** trong `supabase/schema.sql`; kiểm tra phía trình duyệt chỉ để hiển thị.
  Mọi bảng mới trong Supabase phải bật RLS và có policy dựa trên `auth.uid()` / `public.is_admin()`.
- Link trong email (xác nhận, quên mật khẩu) dùng `VST.auth.pageUrl(...)` để chạy đúng cả GitHub Pages lẫn localhost.
- Dùng `flowType: 'implicit'` để link email mở được trên thiết bị khác nơi đăng ký.

## Dữ liệu

- Nguồn hiện tại: `https://dchart-api.vndirect.com.vn/dchart/history?resolution=D&symbol=HPG&from=<unix>&to=<unix>`
  trả về `{ s, t[], o[], h[], l[], c[], v[] }`. Giá cổ phiếu tính theo **nghìn đồng**.
- Gọi theo nhóm nhỏ (mặc định 4 request song song), có timeout và thử lại 1 lần.
- Vàng, tiền số, ngoại hối (`VST.config.globalAssets`): `BinanceSource` gọi
  `https://data-api.binance.vision/api/v3/klines` (công khai, không khóa, giá theo USD, tối đa 1000 nến/lượt).
  Vàng = `PAXGUSDT` (đại diện XAU/USD), EUR/USD = `EURUSDT`. `MarketRouter` chọn nguồn theo mã, nên biểu đồ
  kỹ thuật dùng chung cho mọi tài sản; tài sản này không có sổ lệnh SSI (khung sổ lệnh chỉ hiện giá).
- Sổ lệnh realtime: WebSocket `wss://iboard-pushstream.ssi.com.vn/realtime` (không chính thức, định dạng
  chuỗi `|` theo vnstock-js), lớp `SsiRealtimeFeed` trong `data.js`. Giá trong tin nhắn tính theo đồng → chia 1000.
- Lỗi phải được đổi sang câu tiếng Việt dễ hiểu trước khi hiển thị (xem `DataError` trong `js/data.js`).
- Thời gian API là Unix UTC; khi vẽ cộng 7 giờ để hiển thị giờ Việt Nam.

## Kiểm tra trước khi commit

- Mở trang ở độ rộng ~375px và trên máy tính, kiểm tra không lỗi console.
- Thử bật/tắt từng chỉ báo và đổi cả 4 khung thời gian.
- Nếu sửa phần đăng nhập: thử chưa đăng nhập, tài khoản pending, locked, user thường vào `admin.html`, và admin.
