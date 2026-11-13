/* data10 게시판 · 새 글 알림 — 정본: data10-00/kit/auth/js/board.js (리포 사본을 직접 고치지 말 것)
 *
 * 하는 일
 *   ① 「게시판」 페이지(#/kit-board): 목록 · 글 보기 · 글쓰기 · 고치기 · 지우기 · 댓글 · 공지(관리자)
 *   ② 새 글 알림: 왼쪽 메뉴 · 위쪽 줄 「게시판」 옆 숫자, 화면 오른쪽 아래 알림, (허용하면) 브라우저 알림
 *   ③ 설정(관리자): 게시판 이름 · 글쓰기 권한 · 댓글 · 알림 · 확인 간격 — Supabase 표 <접두사>_board_settings 한 줄
 * 필요한 것: supabase/auth.sql 다음에 supabase/board.sql 실행. 실행 전이면 「게시판」에 실행 안내가 나온다.
 * 끄기: js/auth-config.js 에 "board": false
 */
(window.AUTH_KIT_EXT = window.AUTH_KIT_EXT || []).push(function (kit) {
  'use strict';
  if (kit.local || !kit.sb || kit.config.board === false) return;
  var sb = kit.sb, P = kit.prefix, esc = kit.esc, icon = kit.icon, KEY = 'kit-board';
  var T = { set: P + '_board_settings', posts: P + '_board_posts', com: P + '_board_comments', reads: P + '_board_reads' };
  var RPC = { unread: P + '_board_unread', seen: P + '_board_mark_seen', pin: P + '_board_pin' };
  var DEF = { board_name: '게시판', write_role: 'member', comments_on: true, notify_on: true, poll_seconds: 60 };
  var set = null, timer = null, lastCount = 0, missing = false, mounted = false, lastToastId = null;

  function uid() { var u = kit.user(); return u && u.id; }
  function canWrite() { return kit.isAdmin() || (set || DEF).write_role === 'member'; }
  function isMissing(e) { return !!e && (/PGRST20[25]|42883|42P01/.test(e.code || '') || /does not exist|Could not find/i.test(e.message || '')); }
  function sub() { return (location.hash || '').replace(/^#\/?kit-board\/?/, '').split('?')[0]; }
  function go(s) { location.hash = '#/' + KEY + (s ? '/' + s : ''); }
  function text(s) { return esc(s).replace(/\n/g, '<br>'); }

  // ───────── 새 글 알림 ─────────
  function badge(n) {
    document.querySelectorAll('.kit-ext-n[data-ext="' + KEY + '"]').forEach(function (b) { b.hidden = !n; b.textContent = n > 99 ? '99+' : (n || ''); });
    var t = document.title.replace(/^\(\d+\+?\) /, ''); document.title = n ? '(' + (n > 99 ? '99+' : n) + ') ' + t : t;
  }
  function toast(info) {
    var old = document.getElementById('kbToast'); if (old) old.remove();
    var t = document.createElement('button'); t.type = 'button'; t.id = 'kbToast'; t.className = 'kb-toast';
    t.innerHTML = icon('bell', 'kit-ic') + '<span><b>새 글이 올라왔습니다</b><small>' + esc(info.title || '') + '</small></span>';
    t.onclick = function () { t.remove(); go(info.id ? 'p/' + info.id : ''); };
    document.body.appendChild(t); setTimeout(function () { if (t.parentNode) t.remove(); }, 9000);
    if (document.hidden && window.Notification && Notification.permission === 'granted') {
      try { var n = new Notification(((set || DEF).board_name) + ' · 새 글', { body: info.title || '', tag: 'kit-board-' + P }); n.onclick = function () { window.focus(); go(info.id ? 'p/' + info.id : ''); n.close(); }; } catch (e) {}
    }
  }
  function check() {
    if (!mounted || missing) return;
    sb.rpc(RPC.unread).then(function (r) {
      if (r.error) { if (isMissing(r.error)) { missing = true; stop(); badge(0); } return; }
      var d = r.data || {}, n = d.on === false ? 0 : (d.count || 0);
      if (location.hash.indexOf('#/' + KEY) === 0 && !sub()) { lastCount = n; return; }   // 목록을 보고 있으면 목록이 처리한다
      badge(n);
      if (n > lastCount && d.id && d.id !== lastToastId) { lastToastId = d.id; toast(d); }
      lastCount = n;
    });
  }
  function start() { stop(); var s = Math.max(20, Math.min(3600, +(set || DEF).poll_seconds || 60)); timer = setInterval(check, s * 1000); }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  function loadSet() {
    return sb.from(T.set).select('*').eq('id', 1).maybeSingle().then(function (r) {
      if (r.error) { if (isMissing(r.error)) missing = true; return null; }
      set = r.data || DEF; missing = false;
      document.querySelectorAll('a[href="#/' + KEY + '"] > span:not(.kit-ext-n)').forEach(function (s) { s.textContent = set.board_name || '게시판'; });
      return set;
    });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });

  // ───────── 페이지 ─────────
  function head(sub2) { return kit.kpHead('게시판', (set || DEF).board_name || '게시판', sub2 || '승인된 구성원만 보고 씁니다. 새 글이 올라오면 메뉴의 숫자와 화면 알림으로 알려 줍니다.'); }
  function wrap(pg, html) { pg.innerHTML = '<div class="kp kb">' + html + '</div>'; }
  function fail(pg, e) {
    if (isMissing(e)) return setup(pg);
    wrap(pg, head() + '<section class="kp-card"><p class="kb-err">불러오지 못했습니다. ' + esc(kit.errText ? kit.errText(e) : (e && e.message) || '') + '</p><button type="button" class="kp-btn" data-go="">다시 시도</button></section>'); bind(pg);
  }
  function setup(pg) {
    wrap(pg, kit.kpHead('게시판', '게시판 준비가 필요합니다', '이 Supabase 프로젝트에 게시판 표가 아직 없습니다.') +
      '<section class="kp-card"><h2>한 번만 하면 됩니다</h2><ol class="kp-steps">' +
      '<li><b>Supabase → SQL Editor</b><span>이 저장소의 <code>supabase/board.sql</code> 전체를 붙여 넣고 Run 을 누릅니다. (<code>auth.sql</code> 을 먼저 실행한 프로젝트여야 합니다)</span></li>' +
      '<li><b>확인</b><span><code>supabase/verify.sql</code> 을 실행해 게시판 줄이 표 4 · 정책 10 · 함수 5 인지 봅니다.</span></li>' +
      '<li><b>새로 고침</b><span>이 화면을 새로 고치면 게시판이 열립니다.</span></li></ol>' +
      '<p class="kp-note">자세한 순서는 <code>supabase/README.md</code> 의 「게시판 · 새 글 알림」에 있습니다.</p></section>');
  }
  function bind(pg) {
    pg.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { var s = b.getAttribute('data-go'); if (sub() === s) render(pg); else go(s); }; });
  }
  function render(pg) {
    if (missing) return loadSet().then(function () { missing ? setup(pg) : render(pg); });
    var s = sub();
    if (!set) return loadSet().then(function () { missing ? setup(pg) : render(pg); });
    if (s === 'new') return canWrite() ? form(pg, null) : go('');
    if (s === 'settings') return kit.isAdmin() ? settings(pg) : go('');
    var m = s.match(/^p\/(\d+)(\/edit)?$/);
    if (m) return m[2] ? edit(pg, +m[1]) : view(pg, +m[1]);
    list(pg);
  }

  function list(pg) {
    wrap(pg, head() + '<p class="kp-note">불러오는 중입니다…</p>');
    Promise.all([
      sb.from(T.posts).select('id,title,author_id,author_name,pinned,created_at').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(100),
      sb.from(T.reads).select('seen_at').maybeSingle(),
      sb.from(T.com).select('post_id').limit(2000)
    ]).then(function (r) {
      if (r[0].error) return fail(pg, r[0].error);
      var rows = r[0].data || [], seen = r[1].data && r[1].data.seen_at, cnt = {};
      ((r[2].data) || []).forEach(function (c) { cnt[c.post_id] = (cnt[c.post_id] || 0) + 1; });
      var perm = window.Notification ? Notification.permission : 'none';
      var tools = '<div class="kb-tools">' + (canWrite() ? '<button type="button" class="kp-btn kp-primary" data-go="new">글쓰기</button>' : '<span class="kp-st">공지 전용 — 관리자만 씁니다</span>') +
        (perm === 'default' ? '<button type="button" class="kp-btn" id="kbPerm">' + icon('bell', 'kit-ic') + '브라우저 알림 켜기</button>' : (perm === 'granted' ? '<span class="kp-st is-active">브라우저 알림 켜짐</span>' : '')) +
        (kit.isAdmin() ? '<button type="button" class="kp-btn kb-right" data-go="settings">설정</button>' : '') + '</div>';
      var body = rows.length ? '<ul class="kb-list">' + rows.map(function (p) {
        var isNew = seen && p.created_at > seen && p.author_id !== uid();
        return '<li><a href="#/' + KEY + '/p/' + p.id + '">' + (p.pinned ? '<span class="kb-pin">공지</span>' : '') + '<span class="kb-t">' + esc(p.title) + '</span>' +
          (cnt[p.id] ? '<span class="kb-c">댓글 ' + cnt[p.id] + '</span>' : '') + (isNew ? '<span class="kb-new">새 글</span>' : '') +
          '<span class="kb-m">' + esc(p.author_name || '') + ' · ' + esc(kit.fmtTime(p.created_at)) + '</span></a></li>';
      }).join('') + '</ul>' : '<p class="kb-empty">아직 글이 없습니다.' + (canWrite() ? ' 「글쓰기」로 첫 글을 남겨 보세요.' : '') + '</p>';
      wrap(pg, head() + tools + '<section class="kp-card kp-flat">' + body + '</section>' +
        ((set || DEF).notify_on === false ? '<p class="kp-note">새 글 알림이 꺼져 있습니다(설정에서 켭니다).</p>' : ''));
      bind(pg);
      var pb = pg.querySelector('#kbPerm'); if (pb) pb.onclick = function () { Notification.requestPermission().then(function () { list(pg); }); };
      sb.rpc(RPC.seen).then(function () { lastCount = 0; badge(0); });
    }).catch(function (e) { fail(pg, e); });
  }

  function view(pg, id) {
    wrap(pg, head() + '<p class="kp-note">불러오는 중입니다…</p>');
    Promise.all([sb.from(T.posts).select('*').eq('id', id).maybeSingle(), sb.from(T.com).select('*').eq('post_id', id).order('created_at')]).then(function (r) {
      if (r[0].error) return fail(pg, r[0].error);
      var p = r[0].data, cs = r[1].data || [];
      if (!p) { wrap(pg, head() + '<section class="kp-card"><p class="kb-empty">지워졌거나 없는 글입니다.</p><button type="button" class="kp-btn" data-go="">목록</button></section>'); return bind(pg); }
      var mine = p.author_id === uid(), adm = kit.isAdmin(), con = (set || DEF).comments_on !== false;
      wrap(pg, head() + '<div class="kb-tools"><button type="button" class="kp-btn" data-go="">← 목록</button>' +
        (adm ? '<button type="button" class="kp-btn kb-right" id="kbPin">' + (p.pinned ? '공지 내리기' : '공지로 올리기') + '</button>' : '') +
        (mine || adm ? '<button type="button" class="kp-btn' + (adm ? '' : ' kb-right') + '" data-go="p/' + id + '/edit">고치기</button><button type="button" class="kp-btn kb-danger" id="kbDel">지우기</button>' : '') + '</div>' +
        '<article class="kp-card kb-post"><h2>' + (p.pinned ? '<span class="kb-pin">공지</span>' : '') + esc(p.title) + '</h2>' +
        '<p class="kb-meta">' + esc(p.author_name || '') + ' · ' + esc(kit.fmtTime(p.created_at)) + (p.updated_at && p.updated_at > p.created_at ? ' · 고침 ' + esc(kit.fmtTime(p.updated_at)) : '') + '</p>' +
        '<div class="kb-body">' + (p.body ? text(p.body) : '<span class="kb-dim">(내용 없음)</span>') + '</div></article>' +
        '<section class="kp-card"><h2>댓글 ' + cs.length + '</h2>' + (cs.length ? '<ul class="kb-coms">' + cs.map(function (c) {
          return '<li><p class="kb-meta"><b>' + esc(c.author_name || '') + '</b> · ' + esc(kit.fmtTime(c.created_at)) +
            (c.author_id === uid() || adm ? ' <button type="button" class="kb-link" data-delc="' + c.id + '">지우기</button>' : '') + '</p><div class="kb-body">' + text(c.body) + '</div></li>';
        }).join('') + '</ul>' : '<p class="kb-dim">아직 댓글이 없습니다.</p>') +
        (con ? '<form class="ag-form kp-form kb-cform" id="kbCom"><label>댓글 쓰기<textarea name="body" rows="3" maxlength="4000" required></textarea></label>' +
          '<button class="kp-btn kp-primary" type="submit">댓글 남기기</button><p class="ag-msg kp-msg" role="status" aria-live="polite"></p></form>' : '<p class="kp-note">댓글 쓰기가 꺼져 있습니다.</p>') + '</section>');
      bind(pg);
      var say = function (t) { var m = pg.querySelector('.kp-msg'); if (m) { m.textContent = t; m.className = 'ag-msg kp-msg is-err'; } else alertLine(pg, t); };
      var pin = pg.querySelector('#kbPin'); if (pin) pin.onclick = function () { kit.busy(pin, true); sb.rpc(RPC.pin, { p_id: id, p_on: !p.pinned }).then(function (x) { if (x.error) { kit.busy(pin, false); return say(x.error.message); } view(pg, id); }); };
      var del = pg.querySelector('#kbDel'); if (del) del.onclick = function () {
        if (del.dataset.sure !== '1') { del.dataset.sure = '1'; del.textContent = '정말 지우기(되돌릴 수 없음)'; return; }
        kit.busy(del, true); sb.from(T.posts).delete().eq('id', id).then(function (x) { if (x.error) { kit.busy(del, false); return say(x.error.message); } go(''); });
      };
      pg.querySelectorAll('[data-delc]').forEach(function (b) { b.onclick = function () { b.disabled = true; sb.from(T.com).delete().eq('id', +b.getAttribute('data-delc')).then(function () { view(pg, id); }); }; });
      var f = pg.querySelector('#kbCom'); if (f) f.onsubmit = function (e) {
        e.preventDefault(); var v = f.body.value.trim(), b = f.querySelector('button'); if (!v) return say('댓글 내용을 적어 주세요.');
        kit.busy(b, true); sb.from(T.com).insert({ post_id: id, body: v }).then(function (x) { kit.busy(b, false); if (x.error) return say(x.error.message); view(pg, id); });
      };
    }).catch(function (e) { fail(pg, e); });
  }
  function alertLine(pg, t) { var p = document.createElement('p'); p.className = 'kb-err'; p.textContent = t; var k = pg.querySelector('.kb'); if (k) k.insertBefore(p, k.children[1] || null); }

  function form(pg, p) {
    wrap(pg, head(p ? '글을 고칩니다.' : '새 글을 씁니다. 올리면 다른 구성원에게 새 글 알림이 갑니다.') +
      '<section class="kp-card"><form class="ag-form kp-form kb-form" id="kbForm" novalidate>' +
      '<label>제목<input name="title" maxlength="200" required value="' + esc(p ? p.title : '') + '"></label>' +
      '<label>내용<textarea name="body" rows="12" maxlength="20000">' + esc(p ? p.body : '') + '</textarea></label>' +
      '<div class="kb-tools"><button class="kp-btn kp-primary" type="submit">' + (p ? '고친 내용 저장' : '올리기') + '</button>' +
      '<button type="button" class="kp-btn" data-go="' + (p ? 'p/' + p.id : '') + '">취소</button></div><p class="ag-msg kp-msg" role="status" aria-live="polite"></p></form></section>');
    bind(pg);
    var f = pg.querySelector('#kbForm'), say = function (t) { var m = f.querySelector('.kp-msg'); m.textContent = t; m.className = 'ag-msg kp-msg is-err'; };
    f.onsubmit = function (e) {
      e.preventDefault(); var row = { title: f.title.value.trim(), body: f.body.value }, b = f.querySelector('button[type=submit]');
      if (!row.title) return say('제목을 적어 주세요.');
      kit.busy(b, true);
      var q = p ? sb.from(T.posts).update(row).eq('id', p.id).select('id') : sb.from(T.posts).insert(row).select('id');
      q.then(function (x) {
        kit.busy(b, false); if (x.error) return say(/row-level security/i.test(x.error.message) ? '글을 쓸 권한이 없습니다(공지 전용이거나 승인 전입니다).' : x.error.message);
        var id = x.data && x.data[0] && x.data[0].id; if (!id) return say('저장되지 않았습니다. 내 글만 고칠 수 있습니다.');
        go('p/' + id);
      });
    };
    f.title.focus();
  }
  function edit(pg, id) {
    sb.from(T.posts).select('*').eq('id', id).maybeSingle().then(function (r) {
      if (r.error) return fail(pg, r.error);
      if (!r.data || !(r.data.author_id === uid() || kit.isAdmin())) return go('p/' + id);
      form(pg, r.data);
    });
  }

  function settings(pg) {
    var s = set || DEF;
    wrap(pg, head('게시판 설정 — 관리자만 고칩니다.') +
      '<section class="kp-card"><form class="ag-form kp-form kb-form" id="kbSet" novalidate>' +
      '<label>게시판 이름<input name="board_name" maxlength="40" required value="' + esc(s.board_name) + '"></label>' +
      '<label>글을 쓸 수 있는 사람<select name="write_role"><option value="member"' + (s.write_role === 'member' ? ' selected' : '') + '>승인된 구성원 모두</option><option value="admin"' + (s.write_role === 'admin' ? ' selected' : '') + '>관리자만(공지 전용)</option></select></label>' +
      '<label class="kb-chk"><input type="checkbox" name="comments_on"' + (s.comments_on !== false ? ' checked' : '') + '> 댓글 쓰기 허용</label>' +
      '<label class="kb-chk"><input type="checkbox" name="notify_on"' + (s.notify_on !== false ? ' checked' : '') + '> 새 글 알림 켜기(메뉴 숫자 · 화면 알림)</label>' +
      '<label>새 글 확인 간격(초) <small>20 ~ 3600</small><input name="poll_seconds" type="number" min="20" max="3600" value="' + esc(s.poll_seconds) + '"></label>' +
      '<div class="kb-tools"><button class="kp-btn kp-primary" type="submit">저장</button><button type="button" class="kp-btn" data-go="">목록</button></div>' +
      '<p class="ag-msg kp-msg" role="status" aria-live="polite"></p></form></section>' +
      '<section class="kp-card"><h2>Supabase 에서 바꾸기</h2><p class="kp-note">같은 값이 Supabase 「Table Editor」의 <code>' + esc(T.set) + '</code> 표 한 줄에 들어 있습니다. 거기서 고쳐도 다음 확인 때 반영됩니다.</p></section>');
    bind(pg);
    var f = pg.querySelector('#kbSet'), say = function (t, k) { var m = f.querySelector('.kp-msg'); m.textContent = t; m.className = 'ag-msg kp-msg is-' + (k || 'err'); };
    f.onsubmit = function (e) {
      e.preventDefault(); var b = f.querySelector('button[type=submit]');
      var row = { board_name: f.board_name.value.trim(), write_role: f.write_role.value, comments_on: f.comments_on.checked, notify_on: f.notify_on.checked, poll_seconds: Math.round(+f.poll_seconds.value) };
      if (!row.board_name) return say('게시판 이름을 적어 주세요.');
      if (!(row.poll_seconds >= 20 && row.poll_seconds <= 3600)) return say('확인 간격은 20 ~ 3600 초로 해 주세요.');
      kit.busy(b, true);
      sb.from(T.set).update(row).eq('id', 1).select('*').then(function (x) {
        kit.busy(b, false); if (x.error) return say(x.error.message);
        if (!x.data || !x.data.length) return say('저장되지 않았습니다. 관리 권한을 확인해 주세요.');
        loadSet().then(function () { start(); say('저장했습니다.', 'ok'); });
      });
    };
  }

  kit.addPage(KEY, '게시판', function (pg) { render(pg); }, {
    icon: 'bell',
    mount: function () { mounted = true; lastCount = 0; loadSet().then(function () { if (!missing) { check(); start(); } }); },
    unmount: function () { mounted = false; stop(); set = null; badge(0); var t = document.getElementById('kbToast'); if (t) t.remove(); }
  });
});
