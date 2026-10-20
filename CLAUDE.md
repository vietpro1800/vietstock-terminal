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
  Đồ thị kỹ thuật (tên trên thanh điều hướng; file `dashboard.html`, `<html class="fa-theme">`, `<body class="dash fa">`) theo kiểu FireAnt (màu `--fa-*`): tab mã vừa xem,
  công cụ vẽ dọc, biểu đồ nền trắng, nút 5 năm … 1 ngày. Từ 768px chia 2 cột — biểu đồ 3/4 trái, sổ lệnh + thảo luận/bảng giá
  1/4 phải (tab Thảo luận / Tin tức / Bảng giá); nếu cao ≥ 560px thì gói trong 1 màn hình (không cuộn trang), các khung danh sách tự co giãn và cuộn bên trong.
  `chart.html` chỉ còn chuyển hướng về `index.html` (link cũ).
- **Khung ứng dụng (`index.html` + `js/shell.js`)**: thanh trên cùng cố định, mỗi trang chức năng chạy trong iframe riêng
  (giữ nguyên khi chuyển trang, không tải lại). Trang chức năng đặt `data-page="<id>"` trên `<html>`; mở thẳng sẽ tự chuyển
  về `index.html#<id>`. Trong khung, `<html>` có class `embedded` và `.topbar` của trang bị ẩn (khung hiện tiêu đề và
  `#status-dot`/`#status-text` của trang). Thêm trang mới: thêm vào `PAGES` trong `js/auth.js`. Chuyển trang trong code
  dùng `VST.nav.open('dashboard.html?symbol=HPG')` (link `<a href>` nội bộ được chặn và đi qua khung tự động).
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
  - `js/indicators.js` — hàm tính chỉ báo thuần (không đụng DOM): SMA, EMA, Bollinger, RSI, MACD, ATR, Supertrend,
    DMI/ADX (Wilder). Chiến lược giao dịch nằm ở `VST.backtest.STRATEGIES` (`js/backtest.js`) và dùng chung cho
    trang Backtest, Cảnh báo, Danh mục giả lập — thêm chiến lược mới ở đó là cả 3 trang tự có.
  - `js/chart.js` — biểu đồ kỹ thuật dashboard (KLineChart `klinecharts@10.0.3`): nến, KL, MA, BOLL, RSI, MACD
    (chỉ báo tính bằng `VST.indicators`), công cụ vẽ (lưu `localStorage` theo mã), hàm định dạng dùng chung `VST.fmt*`.
    Tùy chọn `new VST.ChartView(els, { toolset: 'full', valueMarks: true })`: đủ bộ công cụ vẽ dạng icon, nhãn giá trị
    chỉ báo trên trục; `setVisibleDays(n)` thu/phóng theo số ngày; chỉ báo `vp` = volume profile. Trang có thể đặt màu
    vùng biểu đồ riêng qua biến `--chart-*` trên `<html>` (chart.js đọc khi nạp).
    `js/backtest-chart.js` — biểu đồ trang backtest (Lightweight Charts), nạp sau `chart.js`.
  - `js/board.js` — bảng giá nhỏ trong tab của dashboard.
  - `js/priceboard.js` — bảng giá kiểu SSI iBoard (`VST.PriceTable`: Trần/Sàn/TC, 3 bước giá mua/bán, khớp lệnh,
    tổng KL, cao/thấp; trần/sàn tính bằng hàm thuần `VST.priceboard.priceLimits`). `js/priceboard-page.js` — logic trang
    `priceboard.html` (thẻ chỉ số trong ngày, nhóm Danh mục của tôi/VN30/HNX30/ngành). Rổ chỉ số và nhóm ngành rút gọn ở `VST.config.priceboard`
    (không dùng `VST.universe` vì bảng giá làm mới realtime, nhóm ngành phải gọn).
    Realtime nhiều mã qua `VST.SsiBoardFeed` trong `data.js`. Kiểm thử: `node tests/priceboard.test.js` (phải đạt hết nếu sửa `priceboard.js`).
  - `js/orderbook.js` — khung sổ lệnh/khớp lệnh (chỉ hiển thị; dữ liệu từ `VST.SsiRealtimeFeed` trong `data.js`).
  - `js/chat.js` — thảo luận theo mã (bảng `stock_comments` trong Supabase, realtime).
  - `js/news.js` — tab Tin tức: `VST.news.matcher` (hàm thuần lọc tin theo mã, ranh giới từ Unicode, mã dễ nhầm như
    HCM/CEO cần ngữ cảnh) + khung `VST.StockNews`. Dữ liệu: `VST.NewsSource` trong `data.js`. Từ khóa tin cho tài sản
    thế giới ở `VST.config.globalAssets[].news`. Kiểm thử: `node tests/news.test.js`.
  - `js/app.js` — dashboard: khởi tạo, gắn sự kiện, tự làm mới; `VST.dashboard.selectSymbol()` cho khung đổi mã.
  - `js/shell.js` — khung ứng dụng (`index.html`): thanh điều hướng, tạo/giữ iframe từng trang, đồng bộ `#hash`.
  - `js/heatmap.js` — bản đồ nhiệt thuần (`layout` treemap squarified 2 cấp, `change`, `bucket`, `avgValue`).
    `js/heatmap-page.js` — logic `heatmap.html` (cấu hình `VST.config.heatmap`, màu `--hm-*`, giá realtime qua `VST.SsiBoardFeed`).
    Kiểm thử: `node tests/heatmap.test.js` (phải đạt hết nếu sửa `heatmap.js`).
  - `js/signals.js` — cảnh báo Mua/Bán thuần (`find` tín hiệu của các chiến lược `VST.backtest.STRATEGIES` trong N phiên,
    mỗi đợt liên tiếp chỉ tính phiên đầu; `evaluate` % lãi/lỗ từ giá đóng cửa ngày báo và số phiên T+).
    `js/signals-page.js` — logic `signals.html` (cấu hình `VST.config.signals`, thiết lập lưu `localStorage`, giá realtime
    qua `VST.SsiBoardFeed`, thông báo trình duyệt khi có tín hiệu mới — chỉ khi web đang mở).
    Kiểm thử: `node tests/signals.test.js` (phải đạt hết nếu sửa `signals.js` hoặc `backtest.js`).
  - `js/paper.js` — danh mục giả lập thuần (`normalize` cấu hình, `simulate` chia vốn đều và chạy `VST.backtest.run`
    cho từng mã, `summarize` lãi/lỗ đã chốt/tạm tính, có giá realtime). `js/paper-page.js` — logic `paper.html`;
    chỉ lưu cấu hình ở bảng `paper_portfolios` (Supabase, RLS theo chủ sở hữu), giao dịch tính lại từ dữ liệu giá.
    Kiểm thử: `node tests/paper.test.js` (phải đạt hết nếu sửa `paper.js` hoặc `backtest.js`).
  - `js/reader.js` — đọc báo thuần (`parseFeed` RSS/Atom bằng regex, `fromRss2Json`, `tag`, `merge` gộp tin trùng theo
    link/tiêu đề, `filter` theo chuyên mục/báo/từ khóa không dấu). `js/reader-page.js` — logic `reader.html`; danh sách báo,
    feed RSS, chuyên mục, proxy CORS ở `VST.config.reader`. Dữ liệu: `VST.FeedSource` (qua proxy, thử lần lượt) và
    `VST.NewsSource` (news-crawler) trong `data.js`. Kiểm thử: `node tests/reader.test.js` (phải đạt hết nếu sửa `reader.js`).
  - `js/consult.js` — phân tích mã kiểu hội chẩn thuần (`VST.consult.analyze(bars, cfg)` → 6 thẻ điểm 0–1: QUÉT, KỸ THUẬT,
    HỖ TRỢ/KHÁNG CỰ, BIẾN ĐỘNG, RỦI RO, TỔNG HỢP MUA/THEO DÕI/TRÁNH; công thức ghi trong comment để dùng lại cho backtest).
    Ngưỡng lọc (gate), trọng số, mốc chấm điểm ở `VST.config.consult`. `js/analysis-page.js` — logic `analysis.html`
    (mở từ nút "Phân tích" trên dashboard). Kiểm thử: `node tests/consult.test.js` (phải đạt hết nếu sửa `consult.js` hoặc `indicators.js`).
  - `js/backtest.js` — công cụ backtest thuần (không DOM, không mạng), chạy được cả trong Node.
    `js/backtest-page.js` — logic trang `backtest.html`. Kiểm thử: `node tests/backtest.test.js`
    (phải đạt hết trước khi commit nếu sửa `backtest.js` hoặc `indicators.js`).
  - `js/universe.js` — danh sách ~1500 cổ phiếu toàn 3 sàn (HOSE/HNX/UPCoM) theo ngành ICB (`VST.universe`: `sectors`,
    `info[mã]` = sàn/ngành, `all`). **File sinh tự động** bằng `python3 tools/build_universe.py` (nguồn: dữ liệu
    `symbols.json` của vnstock-js) — không sửa tay; chạy lại script để cập nhật mã mới niêm yết/hủy niêm yết.
    Chỉ nạp ở `rrg.html`, `scan.html`, `heatmap.html`, `signals.html`, `paper.html` (sau `config.js`).
  - `js/rrg.js` — tính RRG thuần (chỉ số ngành, RS-Ratio, RS-Momentum). `js/rrg-chart.js` — vẽ RRG bằng SVG.
    `js/rrg-page.js` — logic trang `rrg.html`. Ngành và mã lấy từ `VST.universe.sectors`; lọc thanh khoản
    (GTGD TB20) và số mã bật sẵn khi xem một ngành ở `VST.config.rrg`.
    Kiểm thử: `node tests/rrg.test.js` (phải đạt hết nếu sửa `rrg.js` hoặc `indicators.js`).
  - `js/scan.js` — bộ lọc cổ phiếu thuần (`metrics(bars)` tính chỉ số một lần, `run(rows, filters)` lọc; danh sách
    tiêu chí `CRITERIA` và bộ lọc mẫu `PRESETS`). `js/scan-page.js` — logic trang `scan.html`; danh sách mã lấy từ
    `VST.universe` (phạm vi lọc theo sàn hoặc ngành). Kiểm thử: `node tests/scan.test.js` (phải đạt hết nếu sửa `scan.js` hoặc `indicators.js`).
  - `js/auth.js` — Supabase client, `VST.auth.guard()`, thanh người dùng, dịch lỗi sang tiếng Việt.
  - `js/login.js`, `js/reset.js`, `js/admin.js` — logic riêng của `login.html`,
    `reset-password.html`, `admin.html`.
  - `supabase/schema.sql` — bảng, trigger, RLS. Phải chạy lại được nhiều lần (idempotent).
  - Các file JS dùng chung namespace `window.VST`, nạp theo thứ tự trong từng file HTML.
- **Không bao giờ đưa khóa bí mật vào code**: không API key, token, mật khẩu, chuỗi kết nối
  trong bất kỳ file nào được commit. Web tĩnh thì mọi thứ trong code đều công khai.
  Ngoại lệ duy nhất: Supabase **publishable key** (`sb_publishable_...`) trong `js/config.js` — khóa công khai
  theo thiết kế. **Tuyệt đối không dùng/yêu cầu khóa `secret` (`sb_secret_...`) hay `service_role`.**
  Khi cần quyền cao hơn, phải đi qua backend/serverless giữ bí mật phía máy chủ.

## Đăng nhập & phân quyền (Supabase Auth)

- Mọi trang dashboard (hiện là `index.html` (khung), `dashboard.html`, `analysis.html`, `priceboard.html`, `heatmap.html`, `scan.html`, `rrg.html`,
  `backtest.html`, `signals.html`, `paper.html`, `reader.html`, `admin.html`) phải: đặt `class="auth-checking"` trên `<html>`,
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
- Gọi song song có giới hạn (mặc định 4 request cùng lúc; RRG/Lọc 10 vì tải ~1500 mã), có timeout và thử lại 1 lần.
- Vàng, tiền số, ngoại hối (`VST.config.globalAssets`): `BinanceSource` gọi
  `https://data-api.binance.vision/api/v3/klines` (công khai, không khóa, giá theo USD, tối đa 1000 nến/lượt).
  Vàng = `PAXGUSDT` (đại diện XAU/USD), EUR/USD = `EURUSDT`. `MarketRouter` chọn nguồn theo mã, nên biểu đồ
  kỹ thuật dùng chung cho mọi tài sản; tài sản này không có sổ lệnh SSI (khung sổ lệnh chỉ hiện giá).
- Sổ lệnh realtime: WebSocket `wss://iboard-pushstream.ssi.com.vn/realtime` (không chính thức, định dạng
  chuỗi `|` theo vnstock-js), lớp `SsiRealtimeFeed` trong `data.js`. Giá trong tin nhắn tính theo đồng → chia 1000.
- Tin tức (`NewsSource`): file JSON mỗi ngày `https://raw.githubusercontent.com/ttqteo/news-crawler/master/docs/news/MM-DD-YYYY.json`
  (dự án mã nguồn mở, tổng hợp Vietstock, VnExpress, Markettimes, ĐTCK…; GitHub cho phép CORS). Không có lọc theo mã
  phía máy chủ → tải theo ngày (mặc định 7, tối đa 28) và lọc ở trình duyệt; chỉ tải khi mở tab Tin tức.
- Đọc báo (`FeedSource`): RSS của VnEconomy, CafeF, Vietstock, Investing, Bloomberg; Reuters không còn RSS nên lấy qua
  Google Tin tức (`site:reuters.com`). Các báo không bật CORS → đi qua proxy công khai trong `VST.config.reader.proxies`
  (rss2json trả JSON, allorigins/codetabs trả XML), không khóa API.
- Lỗi phải được đổi sang câu tiếng Việt dễ hiểu trước khi hiển thị (xem `DataError` trong `js/data.js`).
- Thời gian API là Unix UTC; khi vẽ cộng 7 giờ để hiển thị giờ Việt Nam.

## Kiểm tra trước khi commit

- Mở trang ở độ rộng ~375px và trên máy tính, kiểm tra không lỗi console.
- Thử bật/tắt từng chỉ báo và đổi cả 4 khung thời gian.
- Nếu sửa phần đăng nhập: thử chưa đăng nhập, tài khoản pending, locked, user thường vào `admin.html`, và admin.
