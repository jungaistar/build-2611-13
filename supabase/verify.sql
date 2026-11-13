-- ════════════════════════════════════════════════════════════════════
-- build-2611-13 — 연결 확인(읽기만 합니다. 아무것도 만들거나 고치지 않습니다)
-- auth.sql 을 실행한 뒤 SQL Editor 에 붙여 넣고 Run. 결과 한 줄의 값이 README 의 「기대하는 값」과 같으면 됩니다.
-- ════════════════════════════════════════════════════════════════════
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'build261113\_%' escape '\' and tablename not like 'build261113\_board\_%' escape '\' and tablename not like 'build261113\_site\_%' escape '\')            as "표(2)",
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'build261113\_%' escape '\' and tablename not like 'build261113\_board\_%' escape '\' and tablename not like 'build261113\_site\_%' escape '\' and rowsecurity) as "RLS 켜진 표(2)",
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'build261113\_%' escape '\' and tablename not like 'build261113\_board\_%' escape '\' and tablename not like 'build261113\_site\_%' escape '\')          as "정책(3)",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'build261113\_%' escape '\' and p.proname not like 'build261113\_board\_%' escape '\' and p.proname not like 'build261113\_site\_%' escape '\')                                          as "함수(5)",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'build261113\_%' escape '\' and p.proname not like 'build261113\_board\_%' escape '\' and p.proname not like 'build261113\_site\_%' escape '\'
       and has_function_privilege('anon', p.oid, 'execute'))                                                       as "비로그인이 부를 수 있는 함수(0)",
  (select count(*) from public.build261113_members)                                                                      as "구성원 수",
  (select count(*) from public.build261113_members where status = 'active' and 'admin' = any(roles))                     as "관리자 수(1 이상이면 준비 끝)";

-- 게시판 · 새 글 알림(board.sql 을 실행했을 때) — 표 4 · RLS 4 · 정책 10 · 함수 5 · 트리거 2 · 비로그인 0
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'build261113\_board\_%' escape '\')              as "게시판 표(4)",
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'build261113\_board\_%' escape '\' and rowsecurity) as "RLS 켜진 표(4)",
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'build261113\_board\_%' escape '\')            as "정책(10)",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'build261113\_board\_%' escape '\')                                            as "함수(5)",
  (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
     where not g.tgisinternal and c.relname like 'build261113\_board\_%' escape '\')                                              as "트리거(2)",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'build261113\_board\_%' escape '\'
       and has_function_privilege('anon', p.oid, 'execute'))                                                                 as "비로그인이 부를 수 있는 함수(0)";

-- 첫 화면 모양(site.sql 을 실행했을 때) — 표 1 · 정책 2 · 함수 1 · 비로그인이 부를 수 있는 함수 1(일부러 연 것)
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'build261113\_site\_%' escape '\' and rowsecurity) as "첫 화면 표·RLS(1)",
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'build261113\_site\_%' escape '\')            as "정책(2)",
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'build261113\_site\_%' escape '\'
       and has_function_privilege('anon', p.oid, 'execute'))                                                                as "비로그인 공개 함수(1)";

-- 구성원 목록(누가 대기 · 사용 · 중지인지)
select name, org, email, status, roles, requested_at, approved_at
  from public.build261113_members
 order by requested_at;
