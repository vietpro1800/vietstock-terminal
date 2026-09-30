// Khung thảo luận theo mã: đọc/gửi/xóa bình luận qua Supabase, nhận tin mới realtime.
// Quyền thật nằm ở RLS của bảng stock_comments (supabase/schema.sql).
window.VST = window.VST || {};

(function () {
  const LIMIT = 50;
  const esc = function (s) { return VST.escapeHtml(s); };

  class StockChat {
    // opts: { user, profile, onUnread(n) }
    constructor(root, opts) {
      this.root = root;
      this.client = VST.auth.client;
      this.me = opts.user;
      this.profile = opts.profile;
      this.onUnread = opts.onUnread || function () {};
      this.symbol = null;
      this.items = [];
      this.channel = null;
      this.token = 0;
      this.visible = true;
      this.unread = 0;

      root.innerHTML =
        '<div class="chat-list" aria-live="polite"><p class="dim center">Đang tải…</p></div>' +
        '<p class="chat-error" role="alert" hidden></p>' +
        '<form class="chat-form" autocomplete="off">' +
          '<label class="sr-only" for="chat-input">Nội dung bình luận</label>' +
          '<textarea id="chat-input" class="input chat-input" rows="2" maxlength="1000" placeholder="Viết bình luận…"></textarea>' +
          '<button type="submit" class="btn btn-primary chat-send">Gửi</button>' +
        '</form>' +
        '<p class="chat-note">Enter để gửi, Shift+Enter để xuống dòng. Mọi tài khoản đang hoạt động đều đọc được. ' +
          'Không chia sẻ thông tin cá nhân; đây không phải khuyến nghị đầu tư.</p>';
      this.list = root.querySelector('.chat-list');
      this.form = root.querySelector('.chat-form');
      this.input = root.querySelector('.chat-input');
      this.errEl = root.querySelector('.chat-error');

      this.form.addEventListener('submit', (e) => { e.preventDefault(); this.send(); });
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
      });
      this.list.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-del]');
        if (b) this.remove(Number(b.dataset.del));
      });
    }

    // Khung đang hiện trên màn hình hay không (để đếm tin chưa đọc).
    setVisible(v) {
      this.visible = v;
      if (v) { this.unread = 0; this.onUnread(0); this._scrollBottom(); }
    }

    async setSymbol(symbol) {
      if (symbol === this.symbol) return;
      this.symbol = symbol;
      this.items = [];
      this.unread = 0;
      this.onUnread(0);
      this.input.placeholder = 'Bình luận về ' + symbol + '…';
      this._error('');
      const token = ++this.token;
      if (this.channel) { this.client.removeChannel(this.channel); this.channel = null; }
      if (!this.client) { this._fatal('Không tải được thư viện Supabase.'); return; }

      this.list.innerHTML = '<p class="dim center">Đang tải…</p>';
      try {
        const res = await this.client.from('stock_comments')
          .select('id, symbol, user_id, author_name, body, created_at')
          .eq('symbol', symbol)
          .order('created_at', { ascending: false })
          .limit(LIMIT);
        if (token !== this.token) return;
        if (res.error) { this._fatal(messageOf(res.error)); return; }
        this.items = res.data.reverse();
        this._render(true);

        this.channel = this.client.channel('stock-comments-' + symbol)
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'stock_comments', filter: 'symbol=eq.' + symbol },
            (p) => { if (token === this.token) this._add(p.new, true); })
          .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'stock_comments' },
            (p) => { if (token === this.token && p.old) this._drop(p.old.id); })
          .subscribe();
      } catch (err) {
        if (token === this.token) this._fatal('Không tải được phần thảo luận. Vui lòng tải lại trang.');
      }
    }

    async send() {
      const body = this.input.value.trim();
      if (!body || !this.symbol || this.sending) return;
      this.sending = true;
      this.form.querySelector('.chat-send').disabled = true;
      this._error('');
      let res;
      try {
        res = await this.client.from('stock_comments')
          .insert({ symbol: this.symbol, body: body })
          .select('id, symbol, user_id, author_name, body, created_at')
          .single();
      } catch (err) {
        res = { error: err };
      }
      this.sending = false;
      this.form.querySelector('.chat-send').disabled = false;
      if (res.error) { this._error(messageOf(res.error)); return; }
      this.input.value = '';
      if (res.data.symbol === this.symbol) this._add(res.data, false);
      this._scrollBottom();
    }

    async remove(id) {
      if (!window.confirm('Xóa bình luận này?')) return;
      let res;
      try {
        res = await this.client.from('stock_comments').delete().eq('id', id);
      } catch (err) {
        res = { error: err };
      }
      if (res.error) { this._error(messageOf(res.error)); return; }
      this._drop(id);
    }

    _add(row, fromOthers) {
      if (!row || row.symbol !== this.symbol || this.items.some((it) => it.id === row.id)) return;
      const nearBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 80;
      this.items.push(row);
      if (this.items.length > LIMIT * 2) this.items.shift();
      this._render(nearBottom || !fromOthers);
      if (fromOthers && row.user_id !== this.me.id && !this.visible) {
        this.unread++;
        this.onUnread(this.unread);
      }
    }

    _drop(id) {
      const n = this.items.length;
      this.items = this.items.filter((it) => it.id !== id);
      if (this.items.length !== n) this._render(false);
    }

    _render(toBottom) {
      const admin = this.profile.role === 'admin';
      if (!this.items.length) {
        this.list.innerHTML = '<p class="dim center">Chưa có bình luận nào về ' + esc(this.symbol) + '. Hãy là người đầu tiên!</p>';
        return;
      }
      this.list.innerHTML = this.items.map((it) => {
        const mine = it.user_id === this.me.id;
        const del = mine || admin
          ? '<button type="button" class="chat-del" data-del="' + it.id + '" aria-label="Xóa bình luận" title="Xóa">×</button>' : '';
        return '<div class="chat-msg' + (mine ? ' mine' : '') + '">' +
          '<div class="chat-meta"><b>' + (mine ? 'Bạn' : esc(it.author_name || 'Ẩn danh')) + '</b>' +
          '<time datetime="' + esc(it.created_at) + '">' + fmtTime(it.created_at) + '</time>' + del + '</div>' +
          '<div class="chat-body">' + esc(it.body) + '</div></div>';
      }).join('');
      if (toBottom) this._scrollBottom();
    }

    _scrollBottom() { this.list.scrollTop = this.list.scrollHeight; }

    _error(msg) {
      this.errEl.textContent = msg;
      this.errEl.hidden = !msg;
    }

    _fatal(msg) {
      this.list.innerHTML = '<p class="dim center">' + esc(msg) + '</p>';
    }
  }

  function messageOf(err) {
    const msg = String((err && err.message) || '');
    if (err && (err.code === '42P01' || err.code === 'PGRST205' || /stock_comments/.test(msg) && /does not exist|schema cache/.test(msg))) {
      return 'Tính năng thảo luận chưa được bật: quản trị viên cần chạy lại file supabase/schema.sql trong Supabase.';
    }
    if (msg.indexOf('gửi quá nhanh') >= 0) return 'Bạn gửi quá nhanh, vui lòng đợi một lát.';
    if (err && err.code === '23514') return 'Bình luận phải có từ 1 đến 1.000 ký tự.';
    return VST.auth.errorMessage(err);
  }

  // Hôm nay: "13:20"; ngày khác: "29/09 13:20" (giờ Việt Nam).
  function fmtTime(iso) {
    const t = Date.parse(iso) / 1000;
    if (!isFinite(t)) return '';
    const d = new Date((t + 7 * 3600) * 1000);
    const now = new Date(Date.now() + 7 * 3600 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    const hm = p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
    return d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)
      ? hm : p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + ' ' + hm;
  }

  VST.StockChat = StockChat;
})();
