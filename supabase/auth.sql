-- ════════════════════════════════════════════════════════════════════
-- build-2611-13 — 로그인 · 사용 신청 · 승인 (data10 로그인 키트 정본: data10-00/kit/auth · 적용 build-2611-00/tools/kit)
--
-- ▣ 만드는 개체는 전부 build261113_ 로 시작합니다(표 · 함수 · 정책 · 제약 · 색인).
--   밖의 개체는 auth.users · auth.uid() 를 참조만 합니다. 트리거 · storage 를 만들지 않습니다.
--   그래서 여러 사이트가 함께 쓰는 프로젝트에 넣어도 남의 개체를 건드리지 않고,
--   내 Supabase 프로젝트로 옮길 때도 이 파일을 그대로 실행하면 됩니다.
-- ▣ 재실행 안전: IF NOT EXISTS · CREATE OR REPLACE · DROP POLICY IF EXISTS
-- ▣ 업무 데이터는 아직 이 DB 에 두지 않습니다(브라우저 저장). 여기는 「누가 쓸 수 있는가」만 관리합니다.
-- ▣ 첫 관리자: 맨 아래 §8 목록의 이메일, 또는 관리자가 한 명도 없을 때 처음 「첫 관리자 되기」를 누른 사람.
-- ════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('auth.users') is null or to_regprocedure('auth.uid()') is null then
    raise exception 'auth.users · auth.uid() 가 없습니다. Supabase 프로젝트의 SQL Editor 에서 실행하는 파일입니다.';
  end if;
end $$;

-- ───────── 1. 구성원 ─────────
create table if not exists public.build261113_members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  name         text not null default '' check (char_length(name) <= 80),
  org          text not null default '' check (char_length(org) <= 120),     -- 소속(회사 · 부서)
  phone        text not null default '' check (char_length(phone) <= 40),
  email        text not null default '' check (char_length(email) <= 200),
  roles        text[] not null default '{}',                                  -- admin(구성원 승인 · 관리)
  status       text not null default 'pending' check (status in ('pending','active','disabled')),
  requested_at timestamptz not null default now(),
  approved_by  uuid,
  approved_at  timestamptz,
  constraint build261113_members_roles_chk check (roles <@ array['admin']::text[])
);

-- ───────── 2. 변경 이력(기록성 — UPDATE/DELETE 권한 없음) ─────────
create table if not exists public.build261113_member_changes (
  id           bigint generated always as identity primary key,
  user_id      uuid not null,
  fields       text[] not null default '{}',
  before       jsonb not null default '{}'::jsonb,
  after        jsonb not null default '{}'::jsonb,
  changed_by   uuid,
  changed_name text not null default '' check (char_length(changed_name) <= 80),
  changed_at   timestamptz not null default now(),
  constraint build261113_member_changes_json_chk check (jsonb_typeof(before) = 'object' and jsonb_typeof(after) = 'object'
    and octet_length(before::text) + octet_length(after::text) <= 8192)
);
create index if not exists build261113_member_changes_user_idx on public.build261113_member_changes (user_id, changed_at desc);

-- ───────── 3. 판정 함수 ─────────
create or replace function public.build261113_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.build261113_members m
                 where m.user_id = auth.uid() and m.status = 'active' and 'admin' = any(m.roles));
$$;
create or replace function public.build261113_is_member()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.build261113_members m where m.user_id = auth.uid() and m.status = 'active');
$$;
-- 관리자가 한 명이라도 있는가 — 「첫 관리자 되기」 단추를 보일지 정한다(누가 관리자인지는 알려 주지 않는다)
create or replace function public.build261113_has_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.build261113_members m where m.status = 'active' and 'admin' = any(m.roles));
$$;

-- ───────── 4. RLS ─────────
alter table public.build261113_members        enable row level security;
alter table public.build261113_member_changes enable row level security;

drop policy if exists build261113_members_sel on public.build261113_members;
create policy build261113_members_sel on public.build261113_members for select to authenticated
  using (user_id = auth.uid() or public.build261113_is_admin());
drop policy if exists build261113_members_ins on public.build261113_members;
create policy build261113_members_ins on public.build261113_members for insert to authenticated
  with check (user_id = auth.uid() and status = 'pending' and roles = '{}');
drop policy if exists build261113_member_changes_sel on public.build261113_member_changes;
create policy build261113_member_changes_sel on public.build261113_member_changes for select to authenticated
  using (public.build261113_is_admin() or user_id = auth.uid());

-- ───────── 5. 표 권한 — 화면이 보내는 칸만 ─────────
-- 고치기는 build261113_member_save 로만(이력 · 마지막 관리자 지키기를 건너뛰지 않게). 지우기 권한은 없습니다(사용 중지로 대신).
revoke all on public.build261113_members, public.build261113_member_changes from public, anon, authenticated;
grant select on public.build261113_members, public.build261113_member_changes to authenticated;
grant insert (user_id, name, org, phone, email) on public.build261113_members to authenticated;

-- ───────── 6. 구성원 고치기 ─────────
-- p_patch = {name?, org?, phone?, roles?, status?} — 들어 있는 칸만 바꿉니다.
create or replace function public.build261113_member_save(p_user uuid, p_patch jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  cur public.build261113_members%rowtype; nxt public.build261113_members%rowtype;
  v_admin boolean; v_name text; f text[] := '{}'; b jsonb := '{}'::jsonb; a jsonb := '{}'::jsonb; k text; v_left integer;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.' using errcode = '42501'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception '바꿀 칸(객체)을 보내 주세요.'; end if;
  v_admin := public.build261113_is_admin();
  if not v_admin and p_user is distinct from auth.uid() then
    raise exception '관리 권한이 있어야 다른 구성원을 고칠 수 있습니다.' using errcode = '42501';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('name', 'org', 'phone', 'roles', 'status') then raise exception '고칠 수 없는 칸입니다: %', k; end if;
    if not v_admin and k not in ('name', 'org', 'phone') then
      raise exception '본인은 이름 · 소속 · 연락처만 고칠 수 있습니다.' using errcode = '42501';
    end if;
  end loop;
  -- 관리자 두 명이 동시에 서로를 빼도 0명이 되지 않게 사용 중 관리자 줄을 먼저 잠급니다
  perform 1 from public.build261113_members where status = 'active' and 'admin' = any(roles) order by user_id for update;
  select * into cur from public.build261113_members where user_id = p_user for update;
  if not found then raise exception '없는 구성원입니다.'; end if;
  nxt := cur;
  if p_patch ? 'name'  then nxt.name  := left(btrim(coalesce(p_patch->>'name', '')), 80); end if;
  if p_patch ? 'org'   then nxt.org   := left(btrim(coalesce(p_patch->>'org', '')), 120); end if;
  if p_patch ? 'phone' then nxt.phone := left(btrim(coalesce(p_patch->>'phone', '')), 40); end if;
  if p_patch ? 'roles' then
    if jsonb_typeof(p_patch->'roles') <> 'array' then raise exception '권한은 목록입니다.'; end if;
    select coalesce(array_agg(distinct x order by x), '{}') into nxt.roles from jsonb_array_elements_text(p_patch->'roles') x;
    if not (nxt.roles <@ array['admin']::text[]) then raise exception '없는 권한 이름입니다.'; end if;
  end if;
  if p_patch ? 'status' then
    nxt.status := p_patch->>'status';
    if nxt.status is null or nxt.status not in ('pending','active','disabled') then
      raise exception '상태는 대기 · 사용 · 중지 중 하나입니다.';
    end if;
  end if;
  -- 대기 중인 사람에게 관리 권한을 주면 승인한 것으로 본다
  if cur.status = 'pending' and not (p_patch ? 'status') and cardinality(nxt.roles) > 0 then nxt.status := 'active'; end if;
  if nxt.status = 'active' and cur.status <> 'active' then nxt.approved_by := auth.uid(); nxt.approved_at := now(); end if;
  -- 마지막 관리자 지키기
  if cur.status = 'active' and 'admin' = any(cur.roles) and not (nxt.status = 'active' and 'admin' = any(nxt.roles)) then
    select count(*) into v_left from public.build261113_members where user_id <> p_user and status = 'active' and 'admin' = any(roles);
    if v_left = 0 then raise exception '마지막 관리자는 뺄 수 없습니다. 다른 구성원에게 관리 권한을 먼저 주세요.'; end if;
  end if;
  foreach k in array array['name', 'org', 'phone', 'roles', 'status'] loop
    if to_jsonb(cur) -> k is distinct from to_jsonb(nxt) -> k then
      f := f || k; b := b || jsonb_build_object(k, to_jsonb(cur) -> k); a := a || jsonb_build_object(k, to_jsonb(nxt) -> k);
    end if;
  end loop;
  if cardinality(f) = 0 then return 'same'; end if;
  update public.build261113_members set name = nxt.name, org = nxt.org, phone = nxt.phone, roles = nxt.roles, status = nxt.status,
    approved_by = nxt.approved_by, approved_at = nxt.approved_at where user_id = p_user;
  select left(coalesce(name, ''), 80) into v_name from public.build261113_members where user_id = auth.uid();
  insert into public.build261113_member_changes (user_id, fields, before, after, changed_by, changed_name)
    values (p_user, f, b, a, auth.uid(), coalesce(v_name, ''));
  return 'changed';
end $$;

-- ───────── 7. 첫 관리자 되기 — 관리자가 한 명도 없을 때만 ─────────
-- 내 Supabase 로 옮긴 뒤 처음 가입한 사람(요청자)이 SQL 을 고치지 않고 관리자가 되는 길입니다.
-- 관리자가 이미 있으면 아무것도 하지 않습니다(마지막 관리자 지키기 때문에 0명이 되는 일도 없습니다).
create or replace function public.build261113_claim_first_admin()
returns text language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtext('build261113_claim_first_admin'));
  if public.build261113_has_admin() then return 'exists'; end if;
  select email into v_email from auth.users where id = auth.uid();
  insert into public.build261113_members (user_id, email, roles, status, approved_at)
    values (auth.uid(), left(coalesce(v_email, ''), 200), array['admin'], 'active', now())
    on conflict (user_id) do update set roles = array['admin'], status = 'active', approved_at = coalesce(public.build261113_members.approved_at, now());
  insert into public.build261113_member_changes (user_id, fields, after, changed_by, changed_name)
    values (auth.uid(), array['roles','status'], jsonb_build_object('roles', array['admin'], 'status', 'active'), auth.uid(), '첫 관리자 되기');
  return 'claimed';
end $$;

-- ───────── 함수 권한 — PUBLIC · anon 둘 다 끊습니다 ─────────
-- 정책이 전부 authenticated 대상이라 anon 은 판정 함수를 평가하지 않습니다
revoke execute on function public.build261113_is_admin(), public.build261113_is_member(), public.build261113_has_admin(),
  public.build261113_member_save(uuid, jsonb), public.build261113_claim_first_admin() from public, anon;
grant execute on function public.build261113_is_admin(), public.build261113_is_member(), public.build261113_has_admin(),
  public.build261113_member_save(uuid, jsonb), public.build261113_claim_first_admin() to authenticated;

-- ───────── 8. 첫 관리자 지정(이메일 목록) ─────────
-- 목록의 계정을 사용 중 관리자로 넣습니다. auth.users 는 읽기만 합니다. 아직 로그인한 적 없는 이메일은 건너뜁니다.
-- 내 프로젝트로 옮길 때는 목록을 내 이메일로 바꾸거나 비워 두고 화면의 「첫 관리자 되기」를 씁니다.
do $$
declare
  v_emails text[] := array['aebon@kakao.com']::text[];
  v_email text; v_uid uuid; v_status text; v_roles text[];
begin
  foreach v_email in array coalesce(v_emails, '{}') loop
    v_uid := null;
    select id into v_uid from auth.users where lower(email) = lower(btrim(v_email)) order by created_at limit 1;
    if v_uid is null then raise notice '건너뜀(아직 로그인한 적 없는 계정): %', v_email; continue; end if;
    select status, roles into v_status, v_roles from public.build261113_members where user_id = v_uid for update;
    if not found then
      insert into public.build261113_members (user_id, name, email, roles, status, approved_at)
        values (v_uid, left(split_part(v_email, '@', 1), 80), left(btrim(v_email), 200), array['admin'], 'active', now());
    elsif v_status = 'active' and 'admin' = any(v_roles) then
      continue;
    else
      update public.build261113_members set status = 'active', roles = array['admin'], approved_at = coalesce(approved_at, now()) where user_id = v_uid;
    end if;
    insert into public.build261113_member_changes (user_id, fields, before, after, changed_name)
      values (v_uid, array['roles','status'], jsonb_build_object('roles', v_roles, 'status', v_status),
              jsonb_build_object('roles', array['admin'], 'status', 'active'), '첫 관리자 지정');
  end loop;
end $$;
