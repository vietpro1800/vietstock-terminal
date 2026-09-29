-- =====================================================================
-- ThảoChi Stock — Cấu trúc dữ liệu đăng nhập & phân quyền
-- Chạy toàn bộ file này trong Supabase → SQL Editor → New query → Run.
-- File có thể chạy lại nhiều lần mà không mất dữ liệu.
-- =====================================================================

-- 1. Bảng hồ sơ người dùng --------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  role        text not null default 'user'    check (role   in ('admin', 'user')),
  status      text not null default 'pending' check (status in ('pending', 'active', 'locked')),
  created_at  timestamptz not null default now()
);

comment on table public.profiles is 'Hồ sơ người dùng ThảoChi Stock: quyền (role) và trạng thái duyệt (status).';

-- 2. Hàm kiểm tra admin ----------------------------------------------
-- security definer: chạy với quyền chủ sở hữu nên đọc được profiles mà không
-- bị RLS gọi đệ quy. Chỉ admin còn "active" mới được tính là admin.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and status = 'active'
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;

-- 3. Tự tạo hồ sơ khi có người đăng ký mới ----------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Đồng bộ email khi người dùng đổi email.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

revoke execute on function public.handle_user_email_change() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- Tạo hồ sơ cho các tài khoản đã đăng ký trước khi chạy file này.
insert into public.profiles (id, email)
select id, coalesce(email, '') from auth.users
on conflict (id) do nothing;

-- 4. Chặn sửa sai qua API --------------------------------------------
-- Không cho đổi id/email/created_at qua API, và không cho admin tự đổi
-- quyền/trạng thái của chính mình (tránh tự khóa mất quyền quản trị).
-- Khi chạy trong SQL Editor, auth.uid() rỗng nên vẫn sửa được bình thường.
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new; -- SQL Editor / hệ thống
  end if;
  if new.id <> old.id or new.email <> old.email or new.created_at <> old.created_at then
    raise exception 'Không được sửa id, email hoặc ngày tạo.';
  end if;
  if old.id = (select auth.uid())
     and (new.role <> old.role or new.status <> old.status) then
    raise exception 'Không thể tự đổi quyền hoặc trạng thái của chính mình.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- 5. Row Level Security ----------------------------------------------
alter table public.profiles enable row level security;

-- Quyền cấp bảng: khách (anon) không được gì; người đã đăng nhập chỉ được
-- đọc, và chỉ được sửa 2 cột role/status (RLS bên dưới giới hạn tiếp: chỉ admin).
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (role, status) on public.profiles to authenticated;

drop policy if exists "Đọc hồ sơ của mình hoặc admin đọc tất cả" on public.profiles;
create policy "Đọc hồ sơ của mình hoặc admin đọc tất cả"
  on public.profiles
  for select
  to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Chỉ admin được sửa hồ sơ" on public.profiles;
create policy "Chỉ admin được sửa hồ sơ"
  on public.profiles
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Không có policy INSERT/DELETE: hồ sơ chỉ được tạo bởi trigger ở trên và
-- tự xóa khi xóa người dùng trong Authentication → Users.

-- =====================================================================
-- SAU KHI CHẠY FILE: đăng ký tài khoản trên web, xác nhận email, rồi chạy
-- câu lệnh sau (thay email của bạn) để đặt làm admin đầu tiên:
--
--   update public.profiles
--   set role = 'admin', status = 'active'
--   where email = 'email-cua-ban@example.com';
-- =====================================================================
