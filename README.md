# ThảoChi Stock

Web dashboard chứng khoán Việt Nam: biểu đồ nến kèm chỉ báo kỹ thuật và bảng giá 20 mã lớn.
Web tĩnh (HTML/CSS/JS thuần), chạy trực tiếp trên GitHub Pages, không cần build.

## Tính năng

- Ô nhập mã chứng khoán (gợi ý sẵn 20 mã lớn). Bấm vào một dòng trong bảng giá để xem mã đó.
- Biểu đồ nến (TradingView Lightweight Charts) với 4 khung: **15 phút, 1 giờ, Ngày, Tuần**.
- Chỉ báo bật/tắt được: **MA20, MA50, MA200, Bollinger (20, 2), RSI (14), MACD (12, 26, 9)**.
- Bảng giá 20 mã vốn hóa lớn: giá, thay đổi, %, khối lượng.
- Tự làm mới mỗi **30 giây**, tạm dừng khi tab bị ẩn.
- Giao diện nền tối, tối ưu cho điện thoại. Mã, khung thời gian và chỉ báo đã chọn được nhớ trên trình duyệt.
- **Đăng nhập bằng Supabase Auth** (email + mật khẩu, quên mật khẩu). Người đăng ký mới phải được
  **admin duyệt tay** mới vào được dashboard. Trang **Quản trị** để duyệt, khóa, mở khóa, đổi quyền.

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

## Cài đặt đăng nhập (Supabase) — làm một lần

Web dùng Supabase project `https://vrotlzkbcedsodbvhbqn.supabase.co`. Code chỉ chứa
**publishable key** (khóa công khai, dùng thay anon key) — khóa này được phép công khai,
dữ liệu được bảo vệ bằng Row Level Security (RLS). **Không bao giờ** dán khóa `secret`
hoặc `service_role` vào code hay bất kỳ file nào trong kho.

Tên menu trong Supabase Dashboard có thể thay đổi nhẹ theo thời gian; các bước dưới đây theo giao diện hiện tại.

### Bước 1 — Chạy file SQL tạo bảng và phân quyền

1. Mở [Supabase Dashboard](https://supabase.com/dashboard) → chọn project.
2. Menu trái → **SQL Editor** → **New query**.
3. Mở file [`supabase/schema.sql`](supabase/schema.sql) trong kho này, sao chép **toàn bộ** nội dung, dán vào ô soạn thảo.
4. Bấm **Run** (hoặc Ctrl+Enter). Kết quả phải là *Success. No rows returned*.
   File chạy lại nhiều lần cũng không sao (không mất dữ liệu).
5. Kiểm tra: menu trái → **Table Editor** → thấy bảng `profiles`, có biểu tượng khóa / dòng
   *RLS enabled*.

File SQL tạo:
- Bảng `profiles` (`id`, `email`, `role` = admin/user, `status` = pending/active/locked, `created_at`).
- Trigger tự tạo hồ sơ trạng thái **pending** mỗi khi có người đăng ký.
- RLS: người dùng chỉ đọc được hồ sơ của mình; chỉ admin (đang active) xem được mọi người và
  sửa được `role`/`status`. Không ai tự thêm/xóa hồ sơ qua API. Admin không tự khóa/tự hạ quyền mình.

### Bước 2 — Cài Site URL và Redirect URL

Cần bước này để link trong email **xác nhận đăng ký** và **quên mật khẩu** mở đúng trang web.

1. Menu trái → **Authentication** → **URL Configuration**.
2. **Site URL**: nhập
   ```
   https://vietpro1800.github.io/vietstock-terminal/
   ```
   rồi bấm **Save**.
3. **Redirect URLs** → **Add URL**, thêm lần lượt:
   ```
   https://vietpro1800.github.io/vietstock-terminal/**
   http://localhost:8000/**
   ```
   (dòng thứ hai chỉ để thử trên máy; có thể bỏ nếu không cần). Bấm **Save**.

Web sẽ tự gửi kèm đường dẫn `.../login.html` (sau khi xác nhận email) và
`.../reset-password.html` (khi quên mật khẩu); cả hai đều khớp mẫu `/**` ở trên.

### Bước 3 — Cài đặt email

1. **Authentication** → **Sign In / Providers** → **Email**: đảm bảo **Enable Email provider** đang bật.
   Nên bật **Confirm email** (bắt người đăng ký xác nhận email).
2. **Quan trọng — dịch vụ gửi email mặc định của Supabase bị giới hạn**: chỉ gửi được rất ít email
   mỗi giờ và (với project mới) chỉ gửi tới địa chỉ email của thành viên trong team Supabase của bạn.
   Người ngoài đăng ký sẽ **không nhận được** email xác nhận / quên mật khẩu.
   Khi mở cho người khác dùng, hãy cài SMTP riêng: **Authentication** → **Emails** → **SMTP Settings**
   (ví dụ dùng Resend, Brevo, Gmail SMTP…). Thông tin SMTP nhập trong Dashboard, **không** đưa vào code.
   - Cách tạm thời: tắt **Confirm email** — người đăng ký vào thẳng trạng thái chờ duyệt (vẫn phải
     được admin duyệt). Nhưng chức năng quên mật khẩu vẫn cần gửi email được.
3. (Tuỳ chọn) **Authentication** → **Emails** → **Templates**: sửa nội dung email sang tiếng Việt.

### Bước 4 — Đặt tài khoản của bạn làm admin đầu tiên

1. Mở web → **Đăng ký** bằng email của bạn → mở email và bấm link xác nhận.
   Lúc này trang sẽ báo *"Tài khoản đang chờ duyệt"* — đúng như mong đợi.
2. Vào **SQL Editor** → **New query**, dán câu lệnh sau (**thay bằng email của bạn**) rồi **Run**:
   ```sql
   update public.profiles
   set role = 'admin', status = 'active'
   where email = 'email-cua-ban@example.com';
   ```
   Kết quả phải là *1 row affected*. Nếu là 0: kiểm tra lại email, hoặc bạn chưa đăng ký.
3. Quay lại web, bấm **Kiểm tra lại** → vào dashboard. Trên thanh trên cùng sẽ có nút **Quản trị**.

Từ đây, người mới đăng ký sẽ hiện trong **Quản trị → Chờ duyệt**; bấm **Duyệt** để cho phép vào.

### Lưu ý bảo mật

- Đăng nhập chặn người lạ **vào giao diện** dashboard. Tuy nhiên đây là web tĩnh: file HTML/JS
  và API giá cổ phiếu công khai (VNDirect) vẫn truy cập trực tiếp được nếu ai đó cố tình.
  Chỉ dữ liệu **lưu trong Supabase** (như bảng `profiles`) mới thực sự được RLS bảo vệ.
  Sau này nếu có dữ liệu riêng (danh mục, cảnh báo…), hãy lưu trong Supabase kèm RLS.
- Khóa một tài khoản có hiệu lực ngay với mọi thao tác dữ liệu; trang đang mở của người đó sẽ tự
  chuyển về màn hình "đã khóa" trong vòng tối đa 5 phút (hoặc khi họ quay lại tab).
- Muốn xóa hẳn một người dùng: **Authentication** → **Users** → xóa; hồ sơ trong `profiles` tự xóa theo.

## Chạy thử trên máy

Cần mở qua web server (mở trực tiếp file `index.html` bằng `file://` có thể bị trình duyệt chặn gọi API):

```bash
python3 -m http.server 8000
# mở http://localhost:8000
```

## Cấu trúc thư mục

```
index.html          Trang chính (dashboard, cần đăng nhập)
login.html          Đăng nhập / đăng ký / quên mật khẩu / chờ duyệt
reset-password.html Đặt mật khẩu mới từ link trong email
admin.html          Quản trị tài khoản (chỉ admin)
css/style.css       Giao diện (biến màu ở :root)
js/config.js        Cấu hình: danh sách mã, chu kỳ làm mới, khung thời gian, Supabase URL + publishable key
js/auth.js          Supabase client, kiểm tra đăng nhập/quyền, thông báo lỗi tiếng Việt
js/login.js         Logic trang đăng nhập
js/reset.js         Logic trang đặt lại mật khẩu
js/admin.js         Logic trang quản trị
js/data.js          Lớp lấy dữ liệu (VndirectSource) — đổi nguồn dữ liệu tại đây
js/indicators.js    Tính MA, Bollinger, RSI, MACD
js/chart.js         Vẽ biểu đồ
js/board.js         Bảng giá
js/app.js           Khởi tạo, sự kiện, tự làm mới
supabase/schema.sql Bảng profiles, trigger, RLS — chạy trong Supabase SQL Editor
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

Web tĩnh nghĩa là mọi file đều công khai. **Không đưa khóa bí mật, token hay mật khẩu vào code.**
Ngoại lệ duy nhất là Supabase **publishable key** — khóa được thiết kế để công khai.
Khóa `secret` / `service_role` của Supabase tuyệt đối không dùng trong web này; mọi quyền
được kiểm soát bằng RLS trong `supabase/schema.sql`.
