// Trang quản trị: duyệt, khóa, mở khóa, đổi quyền tài khoản.
// Quyền thật sự do RLS trong Supabase kiểm soát; kiểm tra ở đây chỉ để hiển thị.
(function () {
  const auth = VST.auth;
  const esc = VST.escapeHtml;
  const $ = (id) => document.getElementById(id);

  const STATUS_LABEL = { pending: 'Chờ duyệt', active: 'Hoạt động', locked: 'Đã khóa' };
  const ROLE_LABEL = { admin: 'Admin', user: 'Người dùng' };

  const state = { me: null, rows: [], filter: null, search: '' };

  auth.guard({ admin: true }).then(function (ctx) {
    state.me = ctx.profile;
    auth.mountUserBar($('user-bar'), ctx.profile, 'admin');
    bind();
    load();
  });

  function bind() {
    $('filter').addEventListener('click', function (e) {
      const b = e.target.closest('button[data-filter]');
      if (!b) return;
      state.filter = b.dataset.filter;
      render();
    });
    $('search').addEventListener('input', function (e) {
      state.search = e.target.value.trim().toLowerCase();
      render();
    });
    $('reload').addEventListener('click', load);
    $('notice-close').addEventListener('click', function () { $('notice').hidden = true; });
    $('list').addEventListener('click', onAction);
  }

  async function load() {
    $('reload').disabled = true;
    try {
      const res = await auth.client
        .from('profiles')
        .select('id, email, role, status, created_at')
        .order('created_at', { ascending: false });
      if (res.error) throw res.error;
      state.rows = res.data || [];
      if (!state.filter) state.filter = state.rows.some((r) => r.status === 'pending') ? 'pending' : 'all';
      $('notice').hidden = true;
      render();
    } catch (err) {
      notice(auth.errorMessage(err));
      if (!state.rows.length) $('list').innerHTML = '<p class="dim center">Không tải được danh sách tài khoản.</p>';
    } finally {
      $('reload').disabled = false;
    }
  }

  function render() {
    const counts = { all: state.rows.length, pending: 0, active: 0, locked: 0 };
    state.rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
    $('filter').querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.filter === state.filter);
      b.querySelector('.count').textContent = '(' + (counts[b.dataset.filter] || 0) + ')';
    });

    const rows = state.rows.filter(function (r) {
      return (state.filter === 'all' || r.status === state.filter) &&
        (!state.search || r.email.toLowerCase().includes(state.search));
    });
    if (!rows.length) {
      $('list').innerHTML = '<p class="dim center">Không có tài khoản nào.</p>';
      return;
    }
    $('list').innerHTML = rows.map(rowHtml).join('');
  }

  function rowHtml(r) {
    const isMe = r.id === state.me.id;
    const actions = [];
    if (!isMe) {
      if (r.status === 'pending') actions.push(btn('approve', 'Duyệt', 'btn-primary'));
      if (r.status !== 'locked') actions.push(btn('lock', 'Khóa', 'btn-danger'));
      if (r.status === 'locked') actions.push(btn('unlock', 'Mở khóa'));
      actions.push(r.role === 'admin' ? btn('demote', 'Bỏ quyền admin') : btn('promote', 'Đặt làm admin'));
    }
    return '<div class="user-row" data-id="' + esc(r.id) + '">' +
      '<div class="user-info">' +
        '<div class="user-email">' + esc(r.email) + (isMe ? ' <span class="dim">(bạn)</span>' : '') + '</div>' +
        '<div class="user-meta">' +
          '<span class="badge st-' + esc(r.status) + '">' + esc(STATUS_LABEL[r.status] || r.status) + '</span>' +
          '<span class="badge role-' + esc(r.role) + '">' + esc(ROLE_LABEL[r.role] || r.role) + '</span>' +
          '<span class="dim">Đăng ký ' + fmtDate(r.created_at) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="user-actions">' + (isMe ? '<span class="dim small">Không thể tự sửa tài khoản của mình</span>' : actions.join('')) + '</div>' +
      '</div>';
  }

  function btn(action, label, cls) {
    return '<button type="button" class="btn btn-sm ' + (cls || '') + '" data-action="' + action + '">' + label + '</button>';
  }

  const ACTIONS = {
    approve: { patch: { status: 'active' }, done: 'Đã duyệt' },
    lock: { patch: { status: 'locked' }, done: 'Đã khóa', confirm: 'Khóa tài khoản {email}? Người này sẽ không vào được dashboard.' },
    unlock: { patch: { status: 'active' }, done: 'Đã mở khóa' },
    promote: { patch: { role: 'admin' }, done: 'Đã đặt làm admin', confirm: 'Đặt {email} làm admin? Người này sẽ quản lý được mọi tài khoản.' },
    demote: { patch: { role: 'user' }, done: 'Đã bỏ quyền admin', confirm: 'Bỏ quyền admin của {email}?' },
  };

  async function onAction(e) {
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    const id = b.closest('.user-row').dataset.id;
    const row = state.rows.find((r) => r.id === id);
    const act = ACTIONS[b.dataset.action];
    if (!row || !act) return;
    if (act.confirm && !window.confirm(act.confirm.replace('{email}', row.email))) return;

    b.closest('.user-actions').querySelectorAll('button').forEach((x) => { x.disabled = true; });
    try {
      const res = await auth.client.from('profiles').update(act.patch).eq('id', id)
        .select('id, email, role, status, created_at').single();
      if (res.error) throw res.error;
      Object.assign(row, res.data);
      $('notice').hidden = true;
      render();
      toast(act.done + ': ' + row.email);
    } catch (err) {
      notice(auth.errorMessage(err));
      render();
    }
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function notice(text) {
    $('notice-text').textContent = text;
    $('notice').hidden = false;
  }

  let toastTimer;
  function toast(text) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
  }
})();
