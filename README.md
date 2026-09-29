# VietStock Terminal

Web dashboard chứng khoán Việt Nam: biểu đồ nến kèm chỉ báo kỹ thuật và bảng giá 20 mã lớn.
Web tĩnh (HTML/CSS/JS thuần), chạy trực tiếp trên GitHub Pages, không cần build.

## Tính năng

- Ô nhập mã chứng khoán (gợi ý sẵn 20 mã lớn). Bấm vào một dòng trong bảng giá để xem mã đó.
- Biểu đồ nến (TradingView Lightweight Charts) với 4 khung: **15 phút, 1 giờ, Ngày, Tuần**.
- Chỉ báo bật/tắt được: **MA20, MA50, MA200, Bollinger (20, 2), RSI (14), MACD (12, 26, 9)**.
- Bảng giá 20 mã vốn hóa lớn: giá, thay đổi, %, khối lượng.
- Tự làm mới mỗi **30 giây**, tạm dừng khi tab bị ẩn.
- Giao diện nền tối, tối ưu cho điện thoại. Mã, khung thời gian và chỉ báo đã chọn được nhớ trên trình duyệt.

Giá hiển thị theo **nghìn đồng**. Thời gian theo giờ Việt Nam.

## Bật GitHub Pages

1. Đẩy code lên GitHub (nhánh `main`).
2. Vào kho trên GitHub → **Settings** → **Pages** (menu bên trái).
3. Ở mục **Build and deployment**:
   - **Source**: chọn **Deploy from a branch**.
   - **Branch**: chọn `main`, thư mục `/ (root)`, bấm **Save**.
4. Đợi 1–2 phút, tải lại trang Settings → Pages sẽ thấy dòng
   *"Your site is live at `https://<tên-tài-khoản>.github.io/vietstock-terminal/`"*.
5. Mở đường dẫn đó trên máy tính hoặc điện thoại. Trên điện thoại có thể chọn
   **Thêm vào Màn hình chính** để mở nhanh như ứng dụng.

Ghi chú:
- File `.nojekyll` ở thư mục gốc để GitHub Pages phục vụ file nguyên trạng, không xử lý bằng Jekyll.
- Kho **riêng tư (private)** chỉ bật được Pages với gói GitHub trả phí; kho công khai thì miễn phí.
- Mỗi lần đẩy code mới lên `main`, trang tự cập nhật sau khoảng 1 phút
  (có thể cần tải lại mạnh: Ctrl+F5, hoặc xóa bộ nhớ đệm trên điện thoại).

## Chạy thử trên máy

Cần mở qua web server (mở trực tiếp file `index.html` bằng `file://` có thể bị trình duyệt chặn gọi API):

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

## Cấu trúc thư mục

```
index.html          Trang chính
css/style.css       Giao diện (biến màu ở :root)
js/config.js        Cấu hình: danh sách mã, chu kỳ làm mới, khung thời gian
js/data.js          Lớp lấy dữ liệu (VndirectSource) — đổi nguồn dữ liệu tại đây
js/indicators.js    Tính MA, Bollinger, RSI, MACD
js/chart.js         Vẽ biểu đồ
js/board.js         Bảng giá
js/app.js           Khởi tạo, sự kiện, tự làm mới
CLAUDE.md           Quy ước phát triển
```

## Nguồn dữ liệu

API công khai của VNDirect:
`https://dchart-api.vndirect.com.vn/dchart/history?resolution=D&symbol=HPG&from=<unix>&to=<unix>`

- Dữ liệu được gọi theo nhóm nhỏ (4 mã cùng lúc), có giới hạn thời gian chờ và tự thử lại 1 lần.
- Khi lỗi, trang hiện thông báo tiếng Việt ở đầu trang; mã nào lỗi trong bảng giá sẽ ghi "Lỗi tải dữ liệu".
- Nếu trang báo *"Không kết nối được máy chủ dữ liệu"* dù mạng vẫn ổn, có thể máy chủ VNDirect
  đang chặn truy cập từ trình duyệt (CORS) hoặc tạm ngừng. Khi đó cần đổi nguồn dữ liệu
  hoặc dùng một proxy riêng — chỉ cần viết lớp mới trong `js/data.js`.
- Đây là API không chính thức, có thể thay đổi bất cứ lúc nào. Dữ liệu chỉ mang tính tham khảo.

## Bảo mật

Web tĩnh nghĩa là mọi file đều công khai. **Không đưa API key, token hay mật khẩu vào code.**
Khi mở rộng cho nhiều người dùng có đăng nhập, phần xác thực và khóa bí mật phải nằm ở
phía máy chủ (backend/serverless), không nằm trong kho này.
