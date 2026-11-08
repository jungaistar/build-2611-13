/* 계산 규칙 고정 — node test/logic.test.js
 * 화면이 아니라 숫자가 틀리면 안 되는 도구다. 분해·예측·지표·분할·탐색·저장을 손으로 셀 수 있는 값과 대조한다. */
'use strict';
var G = require('../js/gpr.js');
var passed = 0, failed = 0;
function ok(c, label, detail) { if (c) passed++; else { failed++; console.log('  X ' + label + (detail ? '\n      ' + detail : '')); } }
function eq(g, w, label) { ok(JSON.stringify(g) === JSON.stringify(w), label, '기대: ' + JSON.stringify(w) + '  실제: ' + JSON.stringify(g)); }
function near(g, w, tol, label) { ok(Math.abs(g - w) <= tol, label, '기대: ' + w + ' ± ' + tol + '  실제: ' + g); }

// 숫자 읽기
eq(G.parseNum(' 12.5 '), { ok: true, v: 12.5 }, '앞뒤 공백 숫자');
eq(G.parseNum('1,234.5'), { ok: true, v: 1234.5 }, '천 단위 쉼표');
eq(G.parseNum('1e-3').v, 0.001, '지수 표기');
eq(G.parseNum('').why, '빈 칸', '빈 칸');
eq(G.parseNum('12mm').why, '숫자가 아님', '단위가 붙은 글자');

// CSV
var csv = G.parseCSV('﻿Run,온도,"메모, 비고",강도\r\n1,200,"따옴표 ""안""",50\n2,210,,51\n\n');
eq(csv.header, ['Run', '온도', '메모, 비고', '강도'], 'CSV 머리줄(BOM·따옴표 안 쉼표)');
eq(csv.rows.length, 2, '빈 줄은 행이 아니다');
eq(csv.rows[0]['메모, 비고'], '따옴표 "안"', '따옴표 이스케이프');
eq(G.parseCSV('a;b\n1;2').rows[0], { a: '1', b: '2' }, '세미콜론 구분자');
eq(G.parseCSV('a\tb\n1\t2').rows[0].b, '2', '탭 구분자');

// 열 고르기 · 행 제외
var raw = [
  { Run: 'R1', A: 1, B: 2, Y: 3 }, { Run: 'R2', A: 2, B: 3, Y: 5 }, { Run: 'R3', A: '', B: 1, Y: 2 },
  { Run: 'R4', A: 'abc', B: 1, Y: 2 }, { Run: 'R5', A: 3, B: 1, Y: 4 }, { Run: 'R6', A: 4, B: 2, Y: 6 }, { Run: '', A: '', B: '', Y: '' }
];
var g = G.guessColumns(raw);
eq([g.runCol, g.inputs, g.target], ['Run', ['A', 'B'], 'Y'], 'Run 열 제외 · 마지막 숫자 열이 목표');
var pr = G.prepare(raw);
eq(pr.y, [3, 5, 4, 6], '쓸 수 있는 행만 남는다');
eq(pr.dropped.map(function (d) { return d.run; }), ['R3', 'R4'], '빈 칸·글자 행 제외(완전히 빈 줄은 세지 않음)');
ok(/A 빈 칸/.test(pr.dropped[0].reason) && /A 숫자가 아님\(abc\)/.test(pr.dropped[1].reason), '제외 사유에 열 이름과 값', JSON.stringify(pr.dropped));
ok(G.prepare(raw, { inputs: ['A', 'Y'], target: 'Y' }).errors.length > 0, '목표를 인자로 같이 쓰면 오류');
ok(/4행 이상/.test(G.prepare(raw.slice(0, 2)).errors.join()), '행이 너무 적으면 오류');

// 분할 — 같은 시드면 같은 분할, 겹침 없음
var s1 = G.split(30, 0.8, 7), s2 = G.split(30, 0.8, 7), s3 = G.split(30, 0.8, 8);
eq(s1, s2, '같은 시드 → 같은 분할');
ok(JSON.stringify(s1) !== JSON.stringify(s3), '다른 시드 → 다른 분할');
eq([s1.train.length, s1.test.length], [24, 6], '80% = 학습 24 · 검증 6');
eq(s1.train.concat(s1.test).sort(function (a, b) { return a - b; }), Array.from({ length: 30 }, function (_, i) { return i; }), '학습·검증은 겹치지 않고 전부 덮는다');
eq(G.split(5, 0.99, 1).test.length, 1, '검증은 최소 1개');

// 촐레스키
var A = [[4, 12, -16], [12, 37, -43], [-16, -43, 98]];
var L = G.cholesky(A);
eq([[L[0][0], 0, 0], [L[1][0], L[1][1], 0], [L[2][0], L[2][1], L[2][2]]].map(function (r) { return Array.from(r); }), [[2, 0, 0], [6, 1, 0], [-8, 5, 3]], '촐레스키 교과서 예제');
var maxErr = 0;
for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) { var s = 0; for (var k = 0; k < 3; k++) s += L[i][k] * L[j][k]; maxErr = Math.max(maxErr, Math.abs(s - A[i][j])); }
ok(maxErr < 1e-12, 'L·Lᵀ = A', maxErr);
var xs = G.solveLT(L, G.solveL(L, [1, 2, 3]));
var back = A.map(function (r) { return r[0] * xs[0] + r[1] * xs[1] + r[2] * xs[2]; });
ok(Math.max.apply(null, back.map(function (v, i) { return Math.abs(v - [1, 2, 3][i]); })) < 1e-10, 'A x = b 풀이');
var thrown = false; try { G.cholesky([[1, 2], [2, 1]]); } catch (e) { thrown = true; }
ok(thrown, '양의 정부호가 아니면 멈춘다');
var cj = { jitter: 0 }; try { cj = G.cholJitter([[1, 1], [1, 1]]); } catch (e) { cj.err = e.message; }
ok(cj.jitter > 0, '특이 행렬은 지터를 더해 분해한다', cj.jitter);

// 커널 — σf²·exp(-|x-x'|²/(2ℓ²))
near(G.kern([0, 0], [1, 1], { ell: 2, sf: 1.5 }), 2.25 * Math.exp(-2 / 8), 1e-12, 'RBF 커널 값');
near(G.kern([3], [3], { ell: 0.1, sf: 2 }), 4, 1e-12, '같은 점의 커널 = σf²');

// 로그 주변우도 — 점 하나면 손으로 계산 가능: -y²/(2K) - ½log K - ½log 2π
var c1 = G.core([[0]], [1.5], { ell: 1, sf: 1.2, sn: 0.5 }), K1 = 1.44 + 0.25;
near(c1.logML, -1.5 * 1.5 / (2 * K1) - 0.5 * Math.log(K1) - 0.5 * Math.log(2 * Math.PI), 1e-12, '로그 주변우도 공식');

// 노이즈가 작으면 학습점을 지난다
var X1 = [[0], [1], [2], [3], [4]], y1 = [1, 3, 2, 5, 4];
var mi = G.fit(X1, y1, { ell: 0.6, sf: 1, sn: 1e-4 });
var pi = G.predict(mi, X1);
ok(Math.max.apply(null, pi.mean.map(function (v, i) { return Math.abs(v - y1[i]); })) < 1e-3, '노이즈가 작으면 학습점 보간', pi.mean.join(','));
ok(Math.max.apply(null, pi.sd) < 0.01, '학습점에서 예측 표준편차가 작다');
ok(G.predict(mi, [[20]]).sd[0] > G.predict(mi, [[2.5]]).sd[0] * 5, '데이터에서 멀면 불확실성이 커진다');
near(G.predict(mi, [[60]]).mean[0], 3, 1e-6, '아주 멀면 예측은 평균으로 돌아간다');

// 알려진 1차원 함수 sin(x)
var Xs = [], ys = [], Xt = [], yt = [];
for (i = 0; i < 20; i++) { var x = 2 * Math.PI * i / 19; Xs.push([x]); ys.push(Math.sin(x)); }
for (i = 0; i < 50; i++) { x = 0.1 + 6 * i / 49; Xt.push([x]); yt.push(Math.sin(x)); }
var ms = G.fit(Xs, ys, { ell: 0.5, sf: 1, sn: 0.01 });
var r2s = G.metrics(yt, G.predict(ms, Xt).mean).r2;
ok(r2s > 0.95, 'sin(x) 처음 보는 점 R² > 0.95', r2s);

// 지표
var mt = G.metrics([1, 2, 3, 4], [1, 2, 3, 5]);
near(mt.r2, 1 - 1 / 5, 1e-12, 'R² = 1 - SS잔차/SS전체');
near(mt.rmse, 0.5, 1e-12, 'RMSE');
near(mt.mae, 0.25, 1e-12, 'MAE');
eq(G.metrics([2, 2, 2], [1, 2, 3]).r2, null, '실측이 모두 같으면 R² 정의 안 함');
ok(G.metrics([1, 2, 3], [3, 2, 1]).r2 < 0, '평균보다 못하면 R² 음수');

// 하이퍼파라미터 탐색
eq(G.logspace(0.1, 10, 3), [0.1, 1, 10], '로그 간격');
eq(G.logspace(0, 1, 3), [], '0 이하는 로그 간격 불가');
var rg = { ell: { min: 0.3, max: 3, n: 5 }, sf: { min: 0.5, max: 2, n: 3 }, sn: { min: 0.01, max: 0.3, n: 3 } };
eq(G.hyperGrid(rg).length, 45, '조합 수 5×3×3');
var smp = G.prepare(G.sample());
eq([smp.inputs.length, smp.y.length, smp.dropped.length], [3, 30, 0], '예제: 인자 3 · Run 30 · 제외 0');
eq(JSON.stringify(G.sample()), JSON.stringify(G.sample()), '예제는 시드 고정');
var sp = G.split(smp.y.length, 0.8, 42);
var res = G.searchHyper(smp.X, smp.y, sp, rg);
eq(res.length, 45, '모든 조합을 학습');
ok(res.every(function (r, k) { return k === 0 || r.test.r2 <= res[k - 1].test.r2 + 1e-9; }), '검증 R² 큰 순 정렬');
ok(res[0].test.r2 > 0.9, '예제 최적 모델 검증 R² > 0.9', res[0].test.r2);
var tie = [{ test: { r2: 0.9 }, logML: -10 }, { test: { r2: 0.9 }, logML: -3 }, { test: { r2: null }, logML: 0 }];
var sorted = tie.slice().sort(G.rank);
eq(sorted.map(function (r) { return r.logML; }), [-3, -10, 0], '동률이면 로그우도 큰 쪽 · R² 없음은 맨 뒤');
var prof = G.hyperProfile(res, 'ell');
eq(prof.length, 5, '길이 척도 값마다 최고 R²');
near(Math.max.apply(null, prof.map(function (p) { return p.best; })), res[0].test.r2, 1e-12, '프로필 최고값 = 전체 최고');

// 평가 · 영향도
var ev = G.evaluate(smp.X, smp.y, sp, res[0].hyper);
near(ev.test.r2, res[0].test.r2, 1e-12, '평가 R² = 탐색 표의 R²');
eq(ev.rows.filter(function (r) { return r.set === 'test'; }).length, 6, '검증 행 6');
near(ev.rows[0].resid, ev.rows[0].actual - ev.rows[0].pred, 1e-12, '잔차 = 실측 - 예측');
var bnd = G.ranges(smp.X), base = bnd.map(function (b) { return b.mean; });
var par = G.pareto(ev.final, smp.inputs, base, bnd);
eq(par.map(function (p) { return p.name; })[2], '시간(분)', '영향도: 시간이 가장 작다(참 함수에서 폭 4.5 < 12)');
near(par[2].cum, 100, 1e-9, '누적 % 는 100 에서 끝난다');
var rc = G.response(ev.final, base, 0, 150, 250, 41);
eq([rc.x.length, rc.x[0], rc.x[40]], [41, 150, 250], '반응 곡선 점 41');
var top = rc.x[rc.mean.indexOf(Math.max.apply(null, rc.mean))];
ok(Math.abs(top - 210) <= 15, '온도 반응 곡선 꼭대기가 참 최적(210) 근처', top);

// 진단 · 실측 최고
eq(G.diagnose({ train: { r2: 0.99 }, test: { r2: 0.95 } }), [], '좋은 모델은 경고 없음');
eq(G.diagnose({ train: { r2: 0.99 }, test: { r2: 0.6 } }).length, 2, '낮은 검증 R² + 과적합 경고');
eq(G.bestObserved([3, 9, 1, 5], 'max').i, 1, '실측 최대 Run');
eq(G.bestObserved([3, 9, 1, 5], 'min').i, 2, '실측 최소 Run');
eq(G.bestObserved([3, 9, 1, 5], 'target', 4.6).i, 3, '목표값에 가장 가까운 실측');

// Grid Search
eq(G.axisValues({ min: 0, max: 1, step: 0.25 }).values, [0, 0.25, 0.5, 0.75, 1], '간격 0.25 → 5점');
eq(G.axisValues({ min: 0, max: 1, step: 0.3 }).values, [0, 0.3, 0.6, 0.9, 1], '딱 떨어지지 않으면 최대를 덧붙인다');
eq(G.axisValues({ min: 5, max: 5, step: 0 }).values, [5], '최소=최대면 한 점');
ok(G.gridCount([{ name: 'a', min: 1, max: 0, step: 1 }]).errors.length === 1, '최대 < 최소는 오류');
eq(G.gridCount([{ min: 0, max: 9, step: 1 }, { min: 0, max: 4, step: 1 }]).count, 50, '조합 수 = 10 × 5');
var huge = G.gridCount([{ min: 0, max: 999, step: 1 }, { min: 0, max: 999, step: 1 }]);
ok(huge.tooMany && huge.count === 1e6, '20만 넘으면 멈춘다', JSON.stringify(huge));
eq(G.gridSearch(ev.final, [{ min: 0, max: 999, step: 1 }, { min: 0, max: 999, step: 1 }, { min: 0, max: 1, step: 1 }], 'max').top, [], '너무 많으면 탐색하지 않는다');
eq(G.niceStep(9.7), 10, '보기 좋은 간격');
var spec = [{ name: '온도', min: 150, max: 250, step: 5 }, { name: '압력', min: 2, max: 10, step: 0.5 }, { name: '시간', min: 10, max: 60, step: 5 }];
var opt = G.gridSearch(ev.final, spec, 'max');
eq([opt.count, opt.top.length], [21 * 17 * 11, 10], '조합 수와 상위 10');
var b1 = opt.top[0].x;
ok(Math.abs(b1[0] - 210) <= 15 && Math.abs(b1[1] - 6.5) <= 1.5 && b1[2] >= 45, 'Grid Search 가 참 최대점(210 · 6.5 · 60) 근처를 찾는다', b1.join(','));
near(G.truth(b1[0], b1[1], b1[2]), G.truth(210, 6.5, 60), 1.5, '찾은 조건의 참값이 참 최대에 가깝다');
ok(opt.top.every(function (t, k) { return k === 0 || t.mean <= opt.top[k - 1].mean; }), '최대화: 예측 큰 순');
var lo = G.gridSearch(ev.final, spec, 'min');
ok(lo.top[0].mean < opt.top[9].mean, '최소화는 작은 값을 찾는다');
var tg = G.gridSearch(ev.final, spec, 'target', { target: 60 });
ok(Math.abs(tg.top[0].mean - 60) < 0.5, '목표값 60 에 가까운 조건', tg.top[0].mean);
var out = G.gridSearch(ev.final, [{ min: 100, max: 100, step: 1 }, { min: 6, max: 6, step: 1 }, { min: 30, max: 30, step: 1 }], 'max');
eq(out.top[0].outside, [true, false, false], '학습 범위 밖 인자를 표시');

// 저장 → 불러오기
var js = JSON.stringify(G.toJSON(ev.final, { inputs: smp.inputs, target: smp.target, runs: smp.runs }));
var back = G.fromJSON(js);
var probe = [[200, 6, 40], [160, 9, 15], [240, 3, 55]];
var p1 = G.predict(ev.final, probe), p2 = G.predict(back.model, probe);
ok(p1.mean.every(function (v, i) { return Math.abs(v - p2.mean[i]) < 1e-9 && Math.abs(p1.sd[i] - p2.sd[i]) < 1e-9; }), '저장 → 불러오기 예측 동일');
eq(back.inputs, smp.inputs, '불러온 모델의 인자 이름');
var bad = false; try { G.fromJSON('{"format":"other"}'); } catch (e) { bad = /저장한 모델 파일이 아닙니다/.test(e.message); }
ok(bad, '다른 파일은 거절');

// 엑셀 보고
var rep = G.reportSheets({ inputs: smp.inputs, target: smp.target, X: smp.X, y: smp.y, runs: smp.runs, split: sp, dropped: [{ run: 'R99', reason: '온도 빈 칸' }],
  results: res, chosen: res[0].id, evaluation: ev, optimum: opt });
eq(Object.keys(rep), ['데이터', '모델비교', '검증예측', '최적조건'], '시트 4장');
eq([rep['데이터'].length, rep['모델비교'].length, rep['검증예측'].length], [32, 46, 31], '시트 행 수(머리줄 포함)');
ok(rep['최적조건'].some(function (r) { return /확인 실험이 필요/.test(r.join(' ')); }), '최적조건 시트에 주의 문장');
eq(rep['모델비교'][1][9], '선택', '선택 모델 표시');

// (v1.1) Case 열도 Run 이름 열로 본다
eq(G.guessColumns([{ Case: 'Case1', A: 1, Y: 2 }, { Case: 'Case2', A: 2, Y: 3 }]).runCol, 'Case', 'Case 열 = Run 열');

// (v1.1) RBFNN
eq(G.linInts(4, 30, 4), [4, 13, 21, 30], '중심 수 후보는 정수로 고르게');
eq(G.linInts(3, 4, 5), [3, 4], '정수 후보는 겹치지 않는다');
var rrg = { k: { min: 4, max: 30, n: 4 }, width: { min: 0.3, max: 3, n: 5 }, lambda: { min: 1e-6, max: 0.1, n: 3 } };
eq(G.hyperGrid(rrg, 'rbf').length, 60, 'RBFNN 조합 수 4×5×3');
eq(G.hyperGrid(rg, 'gp'), G.hyperGrid(rg), 'GP 조합 순서는 v1.0 과 같다');
var km = G.kmeans([[0, 0], [0.1, 0], [0, 0.1], [5, 5], [5.1, 5], [5, 5.1]], 2, 1).map(function (c) { return Math.round(c[0] + c[1]); }).sort();
eq(km, [0, 10], 'k-평균이 두 무리의 중심을 찾는다');
var mr = G.rbfFit(Xs, ys, { k: 20, width: 0.6, lambda: 1e-8 });
eq([mr.type, mr.kEff, mr.w.length], ['rbf', 20, 21], 'RBFNN: 중심 20 + 절편');
var r2r = G.metrics(yt, G.predict(mr, Xt).mean).r2;
ok(r2r > 0.95, 'RBFNN sin(x) 처음 보는 점 R² > 0.95', r2r);
eq(G.predict(mr, [[1]]).sd, [null], 'RBFNN 은 예측 표준편차가 없다');
near(G.predictMean(mr, [1.3]), G.predict(mr, [[1.3]]).mean[0], 1e-12, 'RBFNN predictMean = predict');
var mr2 = G.rbfFit(Xs, ys, { k: 8, width: 0.8, lambda: 1e-6 });
ok(mr2.kEff === 8 && G.metrics(yt, G.predict(mr2, Xt).mean).r2 > 0.9, 'k-평균 중심 8개로도 sin(x) R² > 0.9', G.metrics(yt, G.predict(mr2, Xt).mean).r2);
var lamBig = G.rbfFit(Xs, ys, { k: 20, width: 0.6, lambda: 1e3 });
ok(Math.max.apply(null, G.predict(lamBig, Xt).mean.map(Math.abs)) < 0.2, '규제 λ 가 아주 크면 예측이 평균(0) 쪽으로 눌린다');
var kerr = false; try { G.rbfFit(Xs, ys, { k: 0, width: 1, lambda: 0 }); } catch (e) { kerr = true; }
ok(kerr, '중심 수 0 은 거절');
var rres = G.searchHyper(smp.X, smp.y, sp, rrg, 'rbf');
eq([rres.length, rres[0].type, rres[0].logML], [60, 'rbf', null], 'RBFNN 모델 60개 · 로그우도 없음');
ok(rres[0].test.r2 > 0.9, '예제 RBFNN 최적 모델 검증 R² > 0.9', rres[0].test.r2);
ok(rres.every(function (r) { return r.kEff <= sp.train.length; }), '실제 중심 수는 학습 Run 수를 넘지 않는다');
var rtie = [{ test: { r2: 0.9 }, logML: null, kEff: 20, hyper: { lambda: 1e-3 } }, { test: { r2: 0.9 }, logML: null, kEff: 8, hyper: { lambda: 1e-6 } }, { test: { r2: 0.9 }, logML: null, kEff: 8, hyper: { lambda: 1e-2 } }];
eq(rtie.slice().sort(G.rank).map(function (r) { return r.kEff + '/' + r.hyper.lambda; }), ['8/0.01', '8/0.000001', '20/0.001'], 'RBFNN 동률이면 중심 수 적은 쪽 · 규제 큰 쪽');
var rev = G.evaluate(smp.X, smp.y, sp, rres[0].hyper, 'rbf');
near(rev.test.r2, rres[0].test.r2, 1e-12, 'RBFNN 평가 R² = 탐색 표의 R²');
eq([rev.type, rev.final.type, rev.final.y.length], ['rbf', 'rbf', 30], 'RBFNN 최종 모델은 전체 30 Run');
ok(/규제 λ/.test(G.diagnose({ type: 'rbf', train: { r2: 0.99 }, test: { r2: 0.6 } }).join()), 'RBFNN 과적합 안내는 λ·k 로');
var ropt = G.gridSearch(rev.final, spec, 'max');
var rb1 = ropt.top[0].x;
ok(Math.abs(rb1[0] - 210) <= 20 && Math.abs(rb1[1] - 6.5) <= 2, 'RBFNN Grid Search 도 참 최대점 근처', rb1.join(','));
eq(ropt.top[0].sd, null, 'RBFNN 최적 조건에는 표준편차가 없다');
var rpar = G.pareto(rev.final, smp.inputs, base, bnd);
eq(rpar.map(function (p) { return p.name; })[2], '시간(분)', 'RBFNN 영향도도 시간이 가장 작다');

// (v1.1) 반응 곡면 — 격자 값은 그 점의 predict 와 같다
var sg = G.surfaceGrid(ev.final, base, 0, 1, bnd[0], bnd[1], 11);
eq([sg.xs.length, sg.ys.length, sg.mean.length, sg.mean[0].length, sg.hasSd], [11, 11, 11, 11, true], '곡면 11×11');
eq([sg.xs[0], sg.xs[10], sg.ys[0], sg.ys[10]], [bnd[0].min, bnd[0].max, bnd[1].min, bnd[1].max], '곡면 축은 범위 끝에서 끝까지');
var gmax = 0;
[[0, 0], [3, 7], [10, 10], [5, 2]].forEach(function (q) {
  var x = base.slice(); x[0] = sg.xs[q[0]]; x[1] = sg.ys[q[1]];
  var pq = G.predict(ev.final, [x]);
  gmax = Math.max(gmax, Math.abs(pq.mean[0] - sg.mean[q[1]][q[0]]), Math.abs(pq.sd[0] - sg.sd[q[1]][q[0]]));
});
ok(gmax < 1e-12, '곡면 mean[j][i]·sd[j][i] = (xs[i], ys[j]) 의 predict', gmax);
var flat = [].concat.apply([], sg.mean);
eq([sg.zmin, sg.zmax], [Math.min.apply(null, flat), Math.max.apply(null, flat)], '곡면 z 범위');
var fixed = base.slice(); fixed[2] = 15;
var sg2 = G.surfaceGrid(ev.final, fixed, 0, 1, bnd[0], bnd[1], 11), x2 = fixed.slice(); x2[0] = sg2.xs[4]; x2[1] = sg2.ys[6];
near(sg2.mean[6][4], G.predictMean(ev.final, x2), 1e-12, '고르지 않은 인자는 고정값으로 계산');
ok(sg2.zmax < sg.zmax, '시간을 15분에 고정하면 곡면이 낮아진다(참 함수 시간 증가 → 강도 증가)', sg2.zmax + ' < ' + sg.zmax);
var sgr = G.surfaceGrid(rev.final, base, 2, 0, bnd[2], bnd[0], 5);
eq([sgr.hasSd, sgr.sd], [false, null], 'RBFNN 곡면은 σ 없음');
x2 = base.slice(); x2[2] = sgr.xs[3]; x2[0] = sgr.ys[1];
near(sgr.mean[1][3], G.predictMean(rev.final, x2), 1e-12, 'RBFNN 곡면 값 = predict');
var serr = false; try { G.surfaceGrid(ev.final, base, 1, 1, bnd[1], bnd[1]); } catch (e) { serr = true; }
ok(serr, '가로·세로가 같은 인자면 거절');
var pv = G.project([1, 0, 0], { yaw: 0, pitch: 0 });
eq([pv.x, pv.y], [1, 0], '정사영: 정면에서 x 축은 오른쪽');
pv = G.project([0, 0, 1], { yaw: 0, pitch: 0 });
eq([pv.x, pv.y], [0, 1], '정사영: z 는 위');
pv = G.project([0, 1, 0], { yaw: Math.PI / 2, pitch: 0 });
near(pv.x, -1, 1e-12, '정사영: yaw 90° 면 y 축이 왼쪽으로');
eq([G.colormap(0), G.colormap(1)], [[68, 1, 84], [253, 231, 37]], '색: 낮음 보라 · 높음 노랑');
ok(G.pointInPoly(0.5, 0.5, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]) && !G.pointInPoly(2, 0.5, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]), '다각형 안·밖 판정');

// (v1.1) 저장 파일의 사용법 — 적힌 코드로 실제 예측이 나와야 한다
[['gp', ev.final], ['rbf', rev.final]].forEach(function (pr) {
  var o = JSON.parse(JSON.stringify(G.toJSON(pr[1], { inputs: smp.inputs, target: smp.target, runs: smp.runs })));
  var u = o._사용법;
  eq(Object.keys(o)[0], '_사용법', pr[0] + ': 사용법이 파일 맨 앞');
  eq(o.modelType, pr[0], pr[0] + ': 모델 종류 기록');
  ok(u.입력_순서.length === 3 && /^1\. 온도\(℃\) — 원래 단위/.test(u.입력_순서[0]) && /^3\. 시간\(분\)/.test(u.입력_순서[2]), pr[0] + ': 입력 이름·순서·단위 안내', JSON.stringify(u.입력_순서));
  ok(/강도\(MPa\)/.test(u.출력), pr[0] + ': 출력 이름');
  var jsPred = new Function('m', 'x', u.JavaScript.join('\n') + '\nreturn predict(m, x);');
  var worst = 0;
  probe.concat([u.예시.입력]).forEach(function (x) { worst = Math.max(worst, Math.abs(jsPred(o, x) - G.predictMean(pr[1], x))); });
  ok(worst < 1e-9, pr[0] + ': 사용법 JavaScript 코드 = 엔진 예측', worst);
  near(u.예시.결과, G.predictMean(pr[1], u.예시.입력), 1e-6, pr[0] + ': 사용법 예시 결과');
  ok(/print\(predict\(\[/.test(u.Python.join('\n')), pr[0] + ': Python 예시');
  ok(pr[0] === 'gp' ? /저장한 모델 불러오기/.test(u.표준편차) : /표준편차\(σ\)를 내지 않습니다/.test(u.표준편차), pr[0] + ': 표준편차 안내');
  var bk = G.fromJSON(JSON.stringify(o)), q1 = G.predict(pr[1], probe), q2 = G.predict(bk.model, probe);
  ok(bk.type === pr[0] && q1.mean.every(function (v, i) { return Math.abs(v - q2.mean[i]) < 1e-9 && (q1.sd[i] == null ? q2.sd[i] == null : Math.abs(q1.sd[i] - q2.sd[i]) < 1e-9); }), pr[0] + ': 사용법을 넣어도 저장 → 불러오기 예측 동일');
});
var v10 = JSON.parse(js); delete v10.modelType; delete v10._사용법; delete v10.alpha;
eq(G.fromJSON(v10).type, 'gp', 'v1.0 모델 파일(종류 없음)은 GP 로 읽는다');
var broken = JSON.parse(JSON.stringify(G.toJSON(rev.final, { inputs: smp.inputs }))); broken.weights.pop();
var berr = false; try { G.fromJSON(broken); } catch (e) { berr = /중심·가중치/.test(e.message); }
ok(berr, 'RBFNN 가중치 수가 맞지 않으면 거절');
var rrep = G.reportSheets({ modelType: 'rbf', inputs: smp.inputs, target: smp.target, X: smp.X, y: smp.y, runs: smp.runs, split: sp, results: rres, chosen: rres[0].id, evaluation: rev, optimum: ropt });
eq(rrep['모델비교'][0].slice(1, 4).concat([rrep['모델비교'][0][8]]), ['중심 수 k', '폭 σ', '규제 λ', '실제 중심 수'], 'RBFNN 모델비교 시트 머리줄');
ok(/GP 전용/.test(rrep['검증예측'][0][5]) && rrep['검증예측'][1][5] === '', 'RBFNN 검증예측 시트는 σ 칸이 비고 GP 전용이라 적는다');
ok(rrep['최적조건'].some(function (r) { return /RBFNN 모델/.test(r.join(' ')); }), '최적조건 시트에 모델 종류');

console.log('\n통과 ' + passed + ' · 실패 ' + failed);
process.exit(failed ? 1 : 0);
