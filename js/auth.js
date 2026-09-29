// Đăng nhập & phân quyền qua Supabase Auth. Dùng chung cho mọi trang.
// Trang cần bảo vệ gọi VST.auth.guard() trước khi chạy bất cứ thứ gì khác.
window.VST = window.VST || {};

(function () {
  const cfg = VST.config.supabase;
  const RECHECK_MS = 5 * 60 * 1000;

  const client = window.supabase
    ? window.supabase.createClient(cfg.url, cfg.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // implicit: link trong email mở được trên thiết bị khác với nơi đăng ký.
        flowType: 'implicit',
      },
    })
    : null;

  // Đường dẫn tuyệt đối tới một trang cùng thư mục (chạy đúng cả trên GitHub Pages lẫn localhost).
  function pageUrl(name) {
    return new URL(name, window.location.href).href.split('#')[0].split('?')[0];
  }

  async function getProfile(userId) {
    const res = await client.from('profiles').select('id, email, role, status, created_at').eq('id', userId).maybeSingle();
    if (res.error) throw res.error;
    return res.data;
  }

  // Trả về { user, profile } nếu hợp lệ; nếu không thì chuyển trang và không bao giờ resolve.
  // opts.admin = true: bắt buộc quyền admin.
  async function guard(opts) {
    opts = opts || {};
    if (!client) {
      showGateError('Không tải được thư viện đăng nhập. Kiểm tra kết nối Internet rồi tải lại trang.');
      return never();
    }
    let ctx;
    try {
      ctx = await check(opts);
    } catch (err) {
      showGateError(errorMessage(err));
      return never();
    }
    if (!ctx) return never();
    document.documentElement.classList.remove('auth-checking');

    client.auth.onAuthStateChange(function (event) {
      if (event === 'SIGNED_OUT') window.location.replace(pageUrl('login.html'));
    });
    // Kiểm tra lại định kỳ: tài khoản bị khóa/bỏ quyền trong lúc đang mở trang sẽ bị đẩy ra.
    const recheck = function () { check(opts).catch(function () { /* lỗi mạng tạm thời: bỏ qua */ }); };
    setInterval(function () { if (!document.hidden) recheck(); }, RECHECK_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) recheck(); });
    return ctx;
  }

  async function check(opts) {
    const s = await client.auth.getSession();
    const session = s.data && s.data.session;
    if (!session) { window.location.replace(pageUrl('login.html')); return null; }
    const profile = await getProfile(session.user.id);
    if (!profile || profile.status !== 'active') {
      // Trang đăng nhập sẽ hiện thông báo "chờ duyệt" / "đã khóa".
      window.location.replace(pageUrl('login.html'));
      return null;
    }
    if (opts.admin && profile.role !== 'admin') {
      window.location.replace(pageUrl('index.html'));
      return null;
    }
    return { user: session.user, profile: profile };
  }

  function never() { return new Promise(function () {}); }

  async function signOut() {
    try { await client.auth.signOut({ scope: 'local' }); } catch (e) { /* vẫn chuyển trang */ }
    window.location.replace(pageUrl('login.html'));
  }

  // Thanh người dùng trên topbar: link Quản trị/Dashboard + Đăng xuất.
  function mountUserBar(el, profile, current) {
    const links = [];
    if (current === 'admin') links.push('<a class="ub-link" href="index.html">Dashboard</a>');
    else if (profile.role === 'admin') links.push('<a class="ub-link" href="admin.html">Quản trị</a>');
    el.innerHTML =
      '<span class="ub-email" title="' + escapeHtml(profile.email) + '">' + escapeHtml(profile.email) + '</span>' +
      links.join('') +
      '<button type="button" class="ub-btn" data-action="signout">Đăng xuất</button>';
    el.querySelector('[data-action="signout"]').addEventListener('click', signOut);
  }

  function showGateError(msg) {
    document.documentElement.classList.remove('auth-checking');
    document.body.innerHTML =
      '<main class="auth-page"><div class="auth-card">' +
      '<h1 class="brand brand-lg">ThảoChi<span>Stock</span></h1>' +
      '<p class="auth-msg error">' + escapeHtml(msg) + '</p>' +
      '<button type="button" class="btn btn-primary btn-block" onclick="location.reload()">Thử lại</button>' +
      '<a class="auth-link" href="login.html">Về trang đăng nhập</a>' +
      '</div></main>';
  }

  // Đổi lỗi của Supabase sang câu tiếng Việt dễ hiểu.
  const MESSAGES = {
    invalid_credentials: 'Email hoặc mật khẩu không đúng.',
    email_not_confirmed: 'Email chưa được xác nhận. Hãy mở link trong email xác nhận (kiểm tra cả thư mục Spam/Quảng cáo).',
    user_already_exists: 'Email này đã được đăng ký. Hãy đăng nhập hoặc dùng "Quên mật khẩu".',
    email_exists: 'Email này đã được đăng ký. Hãy đăng nhập hoặc dùng "Quên mật khẩu".',
    weak_password: 'Mật khẩu quá yếu. Dùng ít nhất 8 ký tự, nên có cả chữ và số.',
    same_password: 'Mật khẩu mới phải khác mật khẩu cũ.',
    over_email_send_rate_limit: 'Đã gửi quá nhiều email trong thời gian ngắn. Vui lòng đợi ít phút rồi thử lại.',
    over_request_rate_limit: 'Thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.',
    email_address_invalid: 'Địa chỉ email không hợp lệ.',
    email_address_not_authorized: 'Máy chủ chưa được cấu hình để gửi email tới địa chỉ này. Vui lòng liên hệ quản trị viên.',
    signup_disabled: 'Hiện đang tạm ngừng nhận đăng ký mới.',
    otp_expired: 'Link đã hết hạn hoặc đã được dùng. Vui lòng yêu cầu gửi lại.',
    session_not_found: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    refresh_token_not_found: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    user_banned: 'Tài khoản đã bị chặn.',
    PGRST116: 'Không tìm thấy dữ liệu hoặc bạn không có quyền thực hiện thao tác này.',
    '42501': 'Bạn không có quyền thực hiện thao tác này.',
  };

  function errorMessage(err) {
    if (!err) return '';
    if (typeof err === 'string') return err;
    if (MESSAGES[err.code]) return MESSAGES[err.code];
    const msg = String(err.message || '').toLowerCase();
    if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('load failed')) {
      return 'Không kết nối được máy chủ đăng nhập. Kiểm tra mạng rồi thử lại.';
    }
    if (msg.includes('invalid login')) return MESSAGES.invalid_credentials;
    if (msg.includes('rate limit')) return MESSAGES.over_request_rate_limit;
    if (msg.includes('tự đổi quyền')) return 'Không thể tự đổi quyền hoặc trạng thái của chính mình.';
    return 'Có lỗi xảy ra, vui lòng thử lại.' + (err.message ? ' (Chi tiết: ' + err.message + ')' : '');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  VST.escapeHtml = escapeHtml;
  VST.auth = {
    client: client,
    pageUrl: pageUrl,
    getProfile: getProfile,
    guard: guard,
    signOut: signOut,
    mountUserBar: mountUserBar,
    errorMessage: errorMessage,
  };
})();
