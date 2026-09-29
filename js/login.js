// Trang đăng nhập / đăng ký / quên mật khẩu, và màn hình chờ duyệt / bị khóa.
(function () {
  const auth = VST.auth;
  const client = auth.client;
  const $ = (sel) => document.querySelector(sel);
  const MIN_PASSWORD = 8;

  // Lỗi đi kèm link trong email (ví dụ link hết hạn) nằm ở phần # của URL.
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const linkError = hashParams.get('error_code') || hashParams.get('error');

  document.querySelectorAll('[data-goto]').forEach(function (btn) {
    btn.addEventListener('click', function () { hideMsg(); show(btn.dataset.goto); });
  });
  document.querySelectorAll('[data-action="signout"]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* bỏ qua */ }
      hideMsg();
      show('login');
    });
  });
  document.querySelectorAll('[data-action="recheck"]').forEach(function (btn) {
    btn.addEventListener('click', function () { route(true); });
  });

  $('#login-form').addEventListener('submit', onLogin);
  $('#signup-form').addEventListener('submit', onSignup);
  $('#forgot-form').addEventListener('submit', onForgot);

  if (!client) {
    show('login');
    showMsg('Không tải được thư viện đăng nhập. Kiểm tra kết nối Internet rồi tải lại trang.', 'error');
    return;
  }

  if (linkError) {
    history.replaceState(null, '', window.location.pathname);
    showMsg(auth.errorMessage({ code: hashParams.get('error_code'), message: hashParams.get('error_description') || '' }), 'error');
  }
  route(false);

  // Xem phiên hiện tại và đưa người dùng đến đúng chỗ.
  async function route(manual) {
    let session;
    try {
      const s = await client.auth.getSession();
      session = s.data && s.data.session;
    } catch (e) {
      show('login');
      showMsg(auth.errorMessage(e), 'error');
      return;
    }
    if (!session) { show('login'); return; }

    let profile;
    try {
      profile = await auth.getProfile(session.user.id);
    } catch (e) {
      show('login');
      showMsg(auth.errorMessage(e), 'error');
      return;
    }

    if (profile && profile.status === 'active') {
      window.location.replace(auth.pageUrl('index.html'));
      return;
    }
    document.querySelectorAll('.js-email').forEach(function (el) { el.textContent = session.user.email; });
    if (profile && profile.status === 'locked') { hideMsg(); show('locked'); return; }
    show('pending');
    if (manual) showMsg('Tài khoản vẫn đang chờ duyệt.', 'info');
    else if (!linkError) hideMsg();
  }

  async function onLogin(e) {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim();
    const password = f.password.value;
    if (!email || !password) return showMsg('Vui lòng nhập email và mật khẩu.', 'error');
    await busy(f, async function () {
      const res = await client.auth.signInWithPassword({ email: email, password: password });
      if (res.error) return showMsg(auth.errorMessage(res.error), 'error');
      f.password.value = '';
      hideMsg();
      await route(false);
    });
  }

  async function onSignup(e) {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim();
    const password = f.password.value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return showMsg('Địa chỉ email không hợp lệ.', 'error');
    if (password.length < MIN_PASSWORD) return showMsg('Mật khẩu cần ít nhất ' + MIN_PASSWORD + ' ký tự.', 'error');
    if (password !== f.password2.value) return showMsg('Hai mật khẩu không khớp.', 'error');
    await busy(f, async function () {
      const res = await client.auth.signUp({
        email: email,
        password: password,
        options: { emailRedirectTo: auth.pageUrl('login.html') },
      });
      if (res.error) return showMsg(auth.errorMessage(res.error), 'error');
      f.reset();
      hideMsg();
      if (res.data && res.data.session) {
        // Supabase đang tắt xác nhận email: vào thẳng màn chờ duyệt.
        await route(false);
      } else {
        $('#check-email-addr').textContent = email;
        show('check-email');
      }
    });
  }

  async function onForgot(e) {
    e.preventDefault();
    const f = e.target;
    const email = f.email.value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return showMsg('Địa chỉ email không hợp lệ.', 'error');
    await busy(f, async function () {
      const res = await client.auth.resetPasswordForEmail(email, { redirectTo: auth.pageUrl('reset-password.html') });
      if (res.error) return showMsg(auth.errorMessage(res.error), 'error');
      showMsg('Nếu email này đã đăng ký, bạn sẽ nhận được link đặt lại mật khẩu trong vài phút. Xem cả thư mục Spam/Quảng cáo.', 'success');
    });
  }

  // ---------- Tiện ích giao diện ----------

  function show(view) {
    document.querySelectorAll('[data-view]').forEach(function (el) { el.hidden = el.dataset.view !== view; });
    const first = document.querySelector('[data-view="' + view + '"] input');
    if (first && window.innerWidth >= 600) first.focus();
  }

  function showMsg(text, kind) {
    const el = $('#msg');
    el.textContent = text;
    el.className = 'auth-msg ' + (kind || 'info');
    el.hidden = false;
  }

  function hideMsg() { $('#msg').hidden = true; }

  async function busy(form, fn) {
    const btn = form.querySelector('button[type="submit"]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Đang xử lý…';
    try {
      await fn();
    } catch (err) {
      showMsg(auth.errorMessage(err), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }
})();
