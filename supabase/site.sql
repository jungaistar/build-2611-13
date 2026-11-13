-- ════════════════════════════════════════════════════════════════════
-- build-2611-13 — 첫 화면 모양 설정 (data10 로그인 키트 정본: data10-00/kit/auth · 적용 build-2611-00/tools/kit)
--
-- ▣ 먼저 auth.sql 을 실행한 프로젝트에서 실행합니다(관리자 판정 함수를 씁니다).
-- ▣ 만드는 개체는 전부 build261113_site_ 로 시작합니다(표 1 · 함수 1 · 정책 2). 트리거 없음.
-- ▣ 재실행 안전: IF NOT EXISTS · CREATE OR REPLACE · DROP POLICY IF EXISTS
-- ▣ 설정은 표 build261113_site_settings 한 줄입니다. 도구의 「첫 화면」(관리자)이나 Table Editor 에서 고칩니다.
--     hero_mode      auto(설정 파일 js/auth-config.js 의 landing.heroMode 를 따름 — 처음 값)
--                    design(회사 색 바탕 디자인 + 움직임) · slide(사진이 옆으로 넘어가는 슬라이드)
--     slide_seconds  사진이 넘어가는 간격(초, 3~20)
-- ▣ 로그인 전 화면이 읽어야 하므로 함수 build261113_site_public() 하나만 비로그인(anon)에게 엽니다.
--   이 함수는 위 두 값만 돌려줍니다. 표 자체는 비로그인이 읽을 수 없습니다.
-- ════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.build261113_is_admin()') is null then
    raise exception '먼저 auth.sql 을 실행해 주세요(build261113_is_admin 이 없습니다).';
  end if;
end $$;

create table if not exists public.build261113_site_settings (
  id            int primary key default 1,
  hero_mode     text not null default 'auto' check (hero_mode in ('auto', 'design', 'slide')),
  slide_seconds int not null default 5 check (slide_seconds between 3 and 20),
  updated_at    timestamptz not null default now(),
  constraint build261113_site_settings_one check (id = 1)
);
insert into public.build261113_site_settings (id) values (1) on conflict (id) do nothing;
alter table public.build261113_site_settings enable row level security;

-- 로그인 전 화면이 부르는 함수 — 공개해도 되는 두 값만
create or replace function public.build261113_site_public()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('hero_mode', s.hero_mode, 'slide_seconds', s.slide_seconds)
    from public.build261113_site_settings s where s.id = 1;
$$;

drop policy if exists build261113_site_settings_sel on public.build261113_site_settings;
create policy build261113_site_settings_sel on public.build261113_site_settings for select to authenticated
  using (public.build261113_is_admin());
drop policy if exists build261113_site_settings_upd on public.build261113_site_settings;
create policy build261113_site_settings_upd on public.build261113_site_settings for update to authenticated
  using (public.build261113_is_admin()) with check (public.build261113_is_admin() and id = 1);

revoke all on public.build261113_site_settings from public, anon, authenticated;
grant select on public.build261113_site_settings to authenticated;
grant update (hero_mode, slide_seconds) on public.build261113_site_settings to authenticated;

revoke execute on function public.build261113_site_public() from public;
grant execute on function public.build261113_site_public() to anon, authenticated;
