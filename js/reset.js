// Trang đặt lại mật khẩu: mở từ link "Quên mật khẩu" trong email.
(function () {
  const auth = VST.auth;
  const client = auth.client;
  const MIN_PASSWORD = 8;
  const hashParams = new URLSearchParams(window.location.hash.slice(1));

  const show = (view) => document.querySelectorAll('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== view; });
  const msg = document.getElementById('msg');
  const showMsg = (text, kind) => { msg.textContent = text; msg.className = 'auth-msg ' + kind; msg.hidden = false; };

  if (!client) {
    show('invalid');
    showMsg('Không tải được thư viện đăng nhập. Kiểm tra kết nối Internet rồi tải lại trang.', 'error');
    return;
  }

  if (hashParams.get('error_code') || hashParams.get('error')) {
    history.replaceState(null, '', window.location.pathname);
    show('invalid');
    showMsg(auth.errorMessage({ code: hashParams.get('error_code'), message: hashParams.get('error_description') || '' }), 'error');
    return;
  }

  // supabase-js tự đọc token trong URL (detectSessionInUrl) rồi tạo phiên khôi phục.
  client.auth.getSession().then(function (s) {
    if (s.data && s.data.session) show('form');
    else show('invalid');
  }).catch(function (e) {
    show('invalid');
    showMsg(auth.errorMessage(e), 'error');
  });

  document.getElementById('reset-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const f = e.target;
    if (f.password.value.length < MIN_PASSWORD) return showMsg('Mật khẩu cần ít nhất ' + MIN_PASSWORD + ' ký tự.', 'error');
    if (f.password.value !== f.password2.value) return showMsg('Hai mật khẩu không khớp.', 'error');
    const btn = f.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Đang lưu…';
    try {
      const res = await client.auth.updateUser({ password: f.password.value });
      if (res.error) { showMsg(auth.errorMessage(res.error), 'error'); return; }
      msg.hidden = true;
      show('done');
    } catch (err) {
      showMsg(auth.errorMessage(err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Lưu mật khẩu mới';
    }
  });
})();
