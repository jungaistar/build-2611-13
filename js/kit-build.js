/* build-2611 과제용 연결 조각 — 로그인 키트(js/auth.js, 정본 data10-00/kit/auth) 앞에 읽는다.
 * 키트는 왼쪽 메뉴(#nav) · 본문(#main) · 위쪽 계정 줄(.topbar)을 찾는다. 이 과제들은 위쪽 메뉴를 쓰는 여러 쪽짜리 정적 화면이라
 * 마산(data10) 과제와 같은 틀이 되도록 여기서 자리를 마련한다: 위쪽 메뉴를 왼쪽 메뉴로 옮기고, 그 아래에 키트가 「도움 · 관리」 묶음을 붙인다.
 * 요소를 새로 만들지 않고 옮기기만 하므로 과제의 메뉴 동작(지금 화면 표시 · 해시 이동)은 그대로다.
 * 정본: build-2611-00/tools/kit/kit-build.js — 과제 리포의 사본을 직접 고치지 말 것. */
(function () {
  'use strict';
  // 과제가 첫 진입 쪽을 따로 정했으면(plan.json landing.entry) 사이트 주소로 들어왔을 때 그 쪽으로 보낸다. 내 PC(시험)와 ?home=1 은 그대로 둔다
  (function () {
    var C0 = window.AUTH_CONFIG || {}, ent = C0.site && C0.site.landing && C0.site.landing.entry;
    var local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    if (ent && !local && /(^|\/)(index\.html)?$/.test(location.pathname) && !/[?&]home=1/.test(location.search) && !location.hash) location.replace(ent + location.search);
  })();
  var m = document.querySelector('main');
  if (m && !document.getElementById('main')) m.id = 'main';
  // 키트 스타일은 .side · .sidebar 를 왼쪽 메뉴로 보고 남색을 칠한다. 과제 본문 안에 같은 이름의 칸이 있으면 원래 색을 지킨다.
  [].forEach.call(document.querySelectorAll('main .side, main .sidebar'), function (el) {
    var cs = getComputedStyle(el);
    el.style.setProperty('background-color', cs.backgroundColor, 'important'); el.style.setProperty('background-image', cs.backgroundImage, 'important'); el.style.setProperty('color', cs.color, 'important');
  });
  var tn = document.querySelector('nav.topnav'), ul = tn && tn.querySelector('.topnav-links'), brand = tn && tn.querySelector('.topnav-brand');
  // 과제가 왼쪽 메뉴를 원하지 않으면(plan.json landing.kitSide: false) 위쪽 메뉴를 그대로 둔다 — 게시판 · 관리는 계정 줄에서 연다
  var C = window.AUTH_CONFIG || {}, noSide = !!(C.site && C.site.landing && C.site.landing.kitSide === false);
  if (noSide) document.documentElement.classList.add('kit-no-side');
  if (ul && !noSide && !document.querySelector('aside #nav')) {
    var side = document.createElement('aside'); side.className = 'sidebar kit-side'; side.setAttribute('aria-label', '주요 메뉴');
    if (brand) side.appendChild(brand);
    if (!document.getElementById('nav')) ul.id = 'nav';
    side.appendChild(ul);
    document.body.insertBefore(side, document.body.firstChild);
    document.documentElement.classList.add('kit-has-side');
  }
  if (!document.querySelector('.topbar')) {
    var bar = document.createElement('div'); bar.className = 'topbar kit-bar'; bar.setAttribute('aria-label', '계정 · 게시판');
    var after = document.querySelector('.kit-side') || tn || document.querySelector('header');
    if (after && after.parentNode && after.parentNode === document.body) document.body.insertBefore(bar, after.nextSibling); else document.body.insertBefore(bar, document.body.firstChild);
  }
})();
