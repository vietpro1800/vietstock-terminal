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
- **HTML/CSS/JS thuần, không build**: không npm, không bundler, không framework.
  Thư viện ngoài chỉ nạp qua CDN, **ghim phiên bản cụ thể** (ví dụ `lightweight-charts@4.2.3`).
  Mở `index.html` qua một web server tĩnh bất kỳ là chạy được.
- **Tách file rõ ràng**:
  - `css/style.css` — toàn bộ style.
  - `js/config.js` — hằng số cấu hình (danh sách mã, chu kỳ làm mới, khung thời gian).
  - `js/data.js` — lớp lấy dữ liệu. **Mọi lệnh gọi mạng chỉ nằm ở đây.** Đổi nguồn dữ liệu
    = viết lớp mới cùng giao diện (`getHistory`, `getHistoryBatch`) rồi đổi một dòng trong `app.js`.
  - `js/indicators.js` — hàm tính chỉ báo thuần (không đụng DOM).
  - `js/chart.js` — vẽ biểu đồ (Lightweight Charts).
  - `js/board.js` — bảng giá.
  - `js/app.js` — khởi tạo, gắn sự kiện, tự làm mới.
  - Các file JS dùng chung namespace `window.VST`, nạp theo thứ tự trong `index.html`.
- **Không bao giờ đưa khóa bí mật vào code**: không API key, token, mật khẩu, chuỗi kết nối
  trong bất kỳ file nào được commit. Web tĩnh thì mọi thứ trong code đều công khai.
  Khi cần đăng nhập/khóa riêng, phải đi qua backend hoặc dịch vụ xác thực (ví dụ proxy/serverless)
  giữ bí mật phía máy chủ.

## Dữ liệu

- Nguồn hiện tại: `https://dchart-api.vndirect.com.vn/dchart/history?resolution=D&symbol=HPG&from=<unix>&to=<unix>`
  trả về `{ s, t[], o[], h[], l[], c[], v[] }`. Giá cổ phiếu tính theo **nghìn đồng**.
- Gọi theo nhóm nhỏ (mặc định 4 request song song), có timeout và thử lại 1 lần.
- Lỗi phải được đổi sang câu tiếng Việt dễ hiểu trước khi hiển thị (xem `DataError` trong `js/data.js`).
- Thời gian API là Unix UTC; khi vẽ cộng 7 giờ để hiển thị giờ Việt Nam.

## Kiểm tra trước khi commit

- Mở trang ở độ rộng ~375px và trên máy tính, kiểm tra không lỗi console.
- Thử bật/tắt từng chỉ báo và đổi cả 4 khung thời gian.
