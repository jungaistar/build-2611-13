-- ════════════════════════════════════════════════════════════════════
-- build-2611-13 — 게시판 · 새 글 알림 (data10 로그인 키트 정본: data10-00/kit/auth · 적용 build-2611-00/tools/kit)
--
-- ▣ 먼저 auth.sql 을 실행한 프로젝트에서 실행합니다(구성원 판정 함수를 씁니다).
-- ▣ 만드는 개체는 전부 build261113_board_ 로 시작합니다(표 4 · 함수 5 · 정책 10 · 트리거 2).
--   트리거는 이 파일이 만든 표에만 붙습니다. 밖의 개체는 auth.users · auth.uid() 를 참조만 합니다.
-- ▣ 재실행 안전: IF NOT EXISTS · CREATE OR REPLACE · DROP … IF EXISTS
-- ▣ 설정은 표 build261113_board_settings 한 줄입니다. 도구의 「게시판 → 설정」(관리자)이나
--   Supabase 「Table Editor」에서 그 줄을 고치면 바로 반영됩니다.
--     board_name    게시판 이름
--     write_role    글을 쓸 수 있는 사람: member(승인된 구성원 모두) · admin(관리자만 = 공지 전용)
--     comments_on   댓글 쓰기 허용
--     notify_on     새 글 알림(종 표시 · 화면 알림) 켜기
--     poll_seconds  새 글을 확인하는 간격(초, 20~3600)
-- ════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.build261113_is_member()') is null or to_regprocedure('public.build261113_is_admin()') is null then
    raise exception '먼저 auth.sql 을 실행해 주세요(build261113_is_member · build261113_is_admin 이 없습니다).';
  end if;
end $$;

-- ───────── 1. 표 ─────────
create table if not exists public.build261113_board_settings (
  id           int primary key default 1,
  board_name   text not null default '게시판' check (char_length(board_name) between 1 and 40),
  write_role   text not null default 'member' check (write_role in ('member', 'admin')),
  comments_on  boolean not null default true,
  notify_on    boolean not null default true,
  poll_seconds int not null default 60 check (poll_seconds between 20 and 3600),
  updated_at   timestamptz not null default now(),
  constraint build261113_board_settings_one check (id = 1)
);
insert into public.build261113_board_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.build261113_board_posts (
  id          bigint generated always as identity primary key,
  author_id   uuid references auth.users(id) on delete set null,
  author_name text not null default '',
  title       text not null check (char_length(btrim(title)) between 1 and 200),
  body        text not null default '' check (char_length(body) <= 20000),
  pinned      boolean not null default false,          -- 공지(위에 고정) — 관리자만 build261113_board_pin 으로
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists build261113_board_posts_created_idx on public.build261113_board_posts (created_at desc);

create table if not exists public.build261113_board_comments (
  id          bigint generated always as identity primary key,
  post_id     bigint not null references public.build261113_board_posts(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  author_name text not null default '',
  body        text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists build261113_board_comments_post_idx on public.build261113_board_comments (post_id, created_at);

-- 사람마다 「어디까지 봤는가」 — 새 글 알림의 기준
create table if not exists public.build261113_board_reads (
  user_id uuid primary key references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.build261113_board_settings enable row level security;
alter table public.build261113_board_posts    enable row level security;
alter table public.build261113_board_comments enable row level security;
alter table public.build261113_board_reads    enable row level security;

-- ───────── 2. 함수 ─────────
-- 지금 로그인한 사람이 글을 쓸 수 있는가(설정의 write_role)
create or replace function public.build261113_board_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select public.build261113_is_member()
     and (public.build261113_is_admin()
          or coalesce((select s.write_role from public.build261113_board_settings s where s.id = 1), 'member') = 'member');
$$;

-- 글 · 댓글의 글쓴이는 서버가 채웁니다(화면에서 남의 이름으로 보낼 수 없게)
create or replace function public.build261113_board_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.author_name := coalesce((select nullif(btrim(m.name), '') from public.build261113_members m where m.user_id = auth.uid()), '구성원');
    new.created_at := now();
    if tg_table_name = 'build261113_board_posts' then new.pinned := false; new.updated_at := now(); end if;
  else
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists build261113_board_posts_stamp on public.build261113_board_posts;
create trigger build261113_board_posts_stamp before insert or update on public.build261113_board_posts
  for each row execute function public.build261113_board_stamp();
drop trigger if exists build261113_board_comments_stamp on public.build261113_board_comments;
create trigger build261113_board_comments_stamp before insert on public.build261113_board_comments
  for each row execute function public.build261113_board_stamp();

-- 공지로 올리기 · 내리기(관리자)
create or replace function public.build261113_board_pin(p_id bigint, p_on boolean)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.build261113_is_admin() then raise exception '관리 권한이 필요합니다.' using errcode = '42501'; end if;
  update public.build261113_board_posts set pinned = coalesce(p_on, false) where id = p_id;
  if not found then raise exception '없는 글입니다.'; end if;
  return 'ok';
end $$;

-- 「여기까지 봤음」 — 게시판을 열 때 화면이 부릅니다
create or replace function public.build261113_board_mark_seen()
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v timestamptz := now();
begin
  if not public.build261113_is_member() then raise exception '승인된 구성원만 쓸 수 있습니다.' using errcode = '42501'; end if;
  insert into public.build261113_board_reads (user_id, seen_at) values (auth.uid(), v)
    on conflict (user_id) do update set seen_at = excluded.seen_at;
  return v;
end $$;

-- 새 글 알림: 내가 마지막으로 본 뒤에 남이 쓴 글 수 · 가장 새 글
-- (처음 쓰는 사람은 지금까지의 글을 새 글로 세지 않도록 기준을 지금으로 잡습니다)
create or replace function public.build261113_board_unread()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_seen timestamptz; v_on boolean; v_n int; v_title text; v_id bigint; v_at timestamptz;
begin
  if not public.build261113_is_member() then return jsonb_build_object('count', 0, 'on', false); end if;
  select s.notify_on into v_on from public.build261113_board_settings s where s.id = 1;
  select r.seen_at into v_seen from public.build261113_board_reads r where r.user_id = auth.uid();
  if v_seen is null then
    insert into public.build261113_board_reads (user_id) values (auth.uid()) on conflict (user_id) do nothing;
    return jsonb_build_object('count', 0, 'on', coalesce(v_on, true));
  end if;
  select count(*) into v_n from public.build261113_board_posts p
   where p.created_at > v_seen and p.author_id is distinct from auth.uid();
  select p.id, p.title, p.created_at into v_id, v_title, v_at from public.build261113_board_posts p
   where p.created_at > v_seen and p.author_id is distinct from auth.uid() order by p.created_at desc limit 1;
  return jsonb_build_object('count', v_n, 'on', coalesce(v_on, true), 'id', v_id, 'title', v_title, 'at', v_at);
end $$;

-- ───────── 3. 정책(RLS) — 승인된 구성원만 ─────────
drop policy if exists build261113_board_settings_sel on public.build261113_board_settings;
create policy build261113_board_settings_sel on public.build261113_board_settings for select to authenticated
  using (public.build261113_is_member());
drop policy if exists build261113_board_settings_upd on public.build261113_board_settings;
create policy build261113_board_settings_upd on public.build261113_board_settings for update to authenticated
  using (public.build261113_is_admin()) with check (public.build261113_is_admin() and id = 1);

drop policy if exists build261113_board_posts_sel on public.build261113_board_posts;
create policy build261113_board_posts_sel on public.build261113_board_posts for select to authenticated
  using (public.build261113_is_member());
drop policy if exists build261113_board_posts_ins on public.build261113_board_posts;
create policy build261113_board_posts_ins on public.build261113_board_posts for insert to authenticated
  with check (public.build261113_board_can_write());
drop policy if exists build261113_board_posts_upd on public.build261113_board_posts;
create policy build261113_board_posts_upd on public.build261113_board_posts for update to authenticated
  using (public.build261113_is_member() and (author_id = auth.uid() or public.build261113_is_admin()))
  with check (public.build261113_is_member() and (author_id = auth.uid() or public.build261113_is_admin()));
drop policy if exists build261113_board_posts_del on public.build261113_board_posts;
create policy build261113_board_posts_del on public.build261113_board_posts for delete to authenticated
  using (public.build261113_is_member() and (author_id = auth.uid() or public.build261113_is_admin()));

drop policy if exists build261113_board_comments_sel on public.build261113_board_comments;
create policy build261113_board_comments_sel on public.build261113_board_comments for select to authenticated
  using (public.build261113_is_member());
drop policy if exists build261113_board_comments_ins on public.build261113_board_comments;
create policy build261113_board_comments_ins on public.build261113_board_comments for insert to authenticated
  with check (public.build261113_is_member()
              and coalesce((select s.comments_on from public.build261113_board_settings s where s.id = 1), true));
drop policy if exists build261113_board_comments_del on public.build261113_board_comments;
create policy build261113_board_comments_del on public.build261113_board_comments for delete to authenticated
  using (public.build261113_is_member() and (author_id = auth.uid() or public.build261113_is_admin()));

drop policy if exists build261113_board_reads_sel on public.build261113_board_reads;
create policy build261113_board_reads_sel on public.build261113_board_reads for select to authenticated
  using (user_id = auth.uid());

-- ───────── 4. 권한 — 화면이 보내는 칸만 ─────────
revoke all on public.build261113_board_settings, public.build261113_board_posts, public.build261113_board_comments, public.build261113_board_reads
  from public, anon, authenticated;
grant select on public.build261113_board_settings, public.build261113_board_posts, public.build261113_board_comments, public.build261113_board_reads to authenticated;
grant update (board_name, write_role, comments_on, notify_on, poll_seconds) on public.build261113_board_settings to authenticated;
grant insert (title, body) on public.build261113_board_posts to authenticated;
grant update (title, body) on public.build261113_board_posts to authenticated;
grant delete on public.build261113_board_posts, public.build261113_board_comments to authenticated;
grant insert (post_id, body) on public.build261113_board_comments to authenticated;

revoke execute on function public.build261113_board_can_write(), public.build261113_board_stamp(), public.build261113_board_pin(bigint, boolean),
  public.build261113_board_mark_seen(), public.build261113_board_unread() from public, anon;
grant execute on function public.build261113_board_can_write(), public.build261113_board_stamp(), public.build261113_board_pin(bigint, boolean),
  public.build261113_board_mark_seen(), public.build261113_board_unread() to authenticated;
