/* 브라우저에 실제로 띄워 화면이 그려지는지 본다 — node test/smoke.browser.js
 * 규칙 테스트가 다 통과해도 app.js 오타 하나면 빈 화면이 된다. playwright 가 없으면 건너뛴다. */
'use strict';
var http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
var chromium;
try { chromium = require('playwright').chromium; }
catch (e) { console.log('playwright 가 없어 화면 연기 테스트를 건너뜁니다.'); process.exit(0); }
var ROOT = path.join(__dirname, '..');
var MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
var srv = http.createServer(function (q, s) {
  var p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(p, function (e, b) { if (e) { s.writeHead(404); return s.end(); } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(b); });
});
var passed = 0, failed = 0;
function ok(c, label, d) { if (c) passed++; else { failed++; console.log('  X ' + label + (d ? '  ' + d : '')); } }
var count = function (pg, sel) { return pg.$$eval(sel, function (t) { return t.length; }); };
srv.listen(0, async function () {
  var base = 'http://127.0.0.1:' + srv.address().port + '/';
  var br = await chromium.launch(); var ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  var pg = await ctx.newPage();
  var errs = []; pg.on('pageerror', function (e) { errs.push(e.message); });
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gpr-smoke-'));
  try {
    await pg.goto(base);
    await pg.click('#btn-sample');
    await pg.waitForSelector('#s-train:not([hidden])', { timeout: 5000 });
    ok(await count(pg, '#grid tbody tr') === 30, '예제 30 Run 이 표에 들어간다');
    ok(/쓸 수 있는 Run/.test(await pg.textContent('#data-status')), '데이터 요약');
    ok(/모델 45개/.test(await pg.textContent('#h-count')), '하이퍼파라미터 조합 수 표시');
    await pg.waitForSelector('#parity circle', { timeout: 10000 });
    ok(await count(pg, '#models tbody tr') === 45 && await pg.isVisible('#s-opt'), '예제는 기본 설정으로 학습까지 바로 돈다');
    await pg.fill('#seed', '42');
    await pg.click('#btn-train');
    await pg.waitForSelector('#parity circle', { timeout: 10000 });
    ok(await count(pg, '#models tbody tr') === 45, '모델 45개 비교표');
    ok(await count(pg, '#parity circle.test') === 6, '예측-실측 그래프에 검증 6점');
    ok(await count(pg, '#resid circle') === 30, '잔차 그래프 30점');
    ok(await count(pg, '#pareto rect.bar') === 3, '파레토 막대 3개');
    ok(await count(pg, '#hyper-charts svg') === 3, '하이퍼파라미터별 R² 그래프 3개');
    var r2 = parseFloat((await pg.textContent('#chosen .stat b')));
    ok(r2 > 0.9, '자동 선정 모델 검증 R² > 0.9', r2);
    await pg.click('#models tbody tr:nth-child(5)');
    ok(/직접 고른 모델/.test(await pg.textContent('#chosen')), '다른 행을 누르면 그 모델로 바뀐다');
    await pg.click('#btn-auto');
    ok(/자동 선정 모델/.test(await pg.textContent('#chosen')), '자동 선정으로 되돌리기');
    ok(/조합 [\d,]+개를 계산/.test(await pg.textContent('#g-count')), 'Grid Search 조합 수를 먼저 보여 준다');
    await pg.fill('#g-step-0', '0.001');
    ok(/넘습니다/.test(await pg.textContent('#g-count')) && await pg.isDisabled('#btn-opt'), '20만 넘으면 간격을 넓히라고 안내');
    await pg.fill('#g-step-0', '10');
    await pg.click('#btn-opt');
    await pg.waitForSelector('#opt-top tbody tr', { timeout: 10000 });
    ok(await count(pg, '#opt-top tbody tr') === 10, '상위 10개 조건');
    ok(/확인 실험이 필요/.test(await pg.textContent('#opt-result')), '확인 실험 안내');
    ok(await count(pg, '#curves svg polygon.band') === 3, '설계인자별 반응 곡선 ±1σ 띠');
    var top1 = await pg.textContent('#opt-top tbody tr:first-child');
    var dl = await Promise.all([pg.waitForEvent('download'), pg.click('#btn-save')]);
    var mfile = path.join(tmp, 'model.json'); await dl[0].saveAs(mfile);
    ok(/gpr-optimizer-model/.test(fs.readFileSync(mfile, 'utf8')), '모델 JSON 내려받기');
    var dx = await Promise.all([pg.waitForEvent('download'), pg.click('#btn-export')]);
    ok(/\.xlsx$/.test(dx[0].suggestedFilename()), '엑셀 내보내기', dx[0].suggestedFilename());
    // 새로 열고 모델만 불러와도 같은 최적 조건이 나온다
    await pg.goto(base);
    await pg.setInputFiles('#model-file', mfile);
    await pg.waitForSelector('#s-opt:not([hidden])', { timeout: 5000 });
    ok(/불러온 모델/.test(await pg.textContent('#chosen')), '모델 불러오기');
    await pg.fill('#g-step-0', '10');
    await pg.click('#btn-opt');
    await pg.waitForSelector('#opt-top tbody tr');
    ok(await pg.textContent('#opt-top tbody tr:first-child') === top1, '불러온 모델의 최적 조건이 저장 전과 같다');
    // 글자·빈 칸 행은 빼고 사유를 보여 준다
    var csv = path.join(tmp, 'bad.csv');
    fs.writeFileSync(csv, 'Run,A,B,Y\n1,1,2,3\n2,2,,5\n3,x,1,2\n4,3,1,4\n5,4,2,6\n6,5,3,7\n');
    await pg.setInputFiles('#file', csv);
    await pg.waitForFunction(function () { return /뺀 행 2개/.test(document.getElementById('data-status').textContent); }, null, { timeout: 5000 });
    ok(/B 빈 칸/.test(await pg.textContent('#data-status')), '빈 칸 사유');
    // 좁은 화면에서 가로 넘침이 없다
    await pg.setViewportSize({ width: 360, height: 800 });
    await pg.goto(base); await pg.click('#btn-sample'); await pg.waitForSelector('#parity circle');
    var over = await pg.evaluate(function () { return document.documentElement.scrollWidth - document.documentElement.clientWidth; });
    ok(over <= 0, '360px 에서 가로 넘침 없음', over);
    await pg.goto(base + 'guide.html');
    ok(/하이퍼파라미터/.test(await pg.textContent('main')), '사용법 페이지');
  } catch (e) { failed++; console.log('  X 예외: ' + e.message); }
  ok(!errs.length, '페이지 오류 없음', errs.join(' | '));
  await br.close(); srv.close();
  console.log('\n화면 통과 ' + passed + ' · 실패 ' + failed);
  process.exit(failed ? 1 : 0);
});
