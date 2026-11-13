/* build-2611 과제용 연결 조각 — 로그인 키트(js/auth.js, 정본 data10-00/kit/auth) 앞에 읽는다.
 * 키트는 #main(본문) · .topbar(계정 표시 자리)를 찾는다. 이 과제들은 여러 쪽짜리 정적 화면이라 그 두 자리를 여기서 마련한다.
 * 정본: build-2611-00/tools/kit/kit-build.js — 과제 리포의 사본을 직접 고치지 말 것. */
(function () {
  'use strict';
  var m = document.querySelector('main');
  if (m && !document.getElementById('main')) m.id = 'main';
  if (!document.querySelector('.topbar')) {
    var bar = document.createElement('div'); bar.className = 'topbar kit-bar'; bar.setAttribute('aria-label', '계정 · 게시판');
    var nav = document.querySelector('nav.topnav') || document.querySelector('header');
    if (nav && nav.parentNode) nav.parentNode.insertBefore(bar, nav.nextSibling); else document.body.insertBefore(bar, document.body.firstChild);
  }
})();
