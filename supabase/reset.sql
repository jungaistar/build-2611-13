-- ════════════════════════════════════════════════════════════════════
-- build-2611-13 — 처음 상태로 되돌리기(실습을 다시 할 때)
--
-- ▣ auth.sql · board.sql · site.sql 이 만든 것을 모두 지웁니다: 이름이 build261113_ 로 시작하는 표 · 함수(정책 · 트리거 · 색인은 표와 함께 지워짐).
-- ▣ 그 안의 자료(구성원 · 승인 기록 · 게시판 글 · 댓글 · 설정)도 함께 사라지고 되돌릴 수 없습니다.
-- ▣ 다른 이름의 표 · 함수 · 가입한 계정(Authentication → Users)은 건드리지 않습니다.
-- ▣ 내 Supabase 프로젝트에서만 실행합니다. 여러 사이트가 함께 쓰는 프로젝트로 보이면 스스로 멈춥니다.
-- ▣ 지운 뒤 다시 하려면 auth.sql → board.sql → site.sql 순서로 실행합니다.
-- ════════════════════════════════════════════════════════════════════
do $$
declare r record; n_t int := 0; n_f int := 0;
begin
  if to_regclass('public.www_profiles') is not null or to_regclass('public.user_profiles') is not null then
    raise exception '여러 사이트가 함께 쓰는 프로젝트로 보입니다. 이 파일은 내 실습용 프로젝트에서만 실행합니다.';
  end if;
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'build261113\_%' escape '\' loop
    execute format('drop table if exists public.%I cascade', r.relname); n_t := n_t + 1;
  end loop;
  for r in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'build261113\_%' escape '\' loop
    execute format('drop function if exists %s cascade', r.sig); n_f := n_f + 1;
  end loop;
  raise notice '지웠습니다 — 표 %개 · 함수 %개', n_t, n_f;
end $$;

-- 확인: 두 값이 모두 0 이면 깨끗하게 지워진 것입니다.
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'build261113\_%' escape '\') as "남은 표(0)",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'build261113\_%' escape '\')                             as "남은 함수(0)";
