/* 머신러닝(GPR) 기반 최적화 툴 — 계산 엔진
 *
 * 화면(app.js)은 계산·판정하지 않는다. 읽기·학습·평가·선정·탐색은 전부 여기서 하고
 * test/logic.test.js 로 고정한다. 브라우저와 node 양쪽에서 읽힌다(전역 GPR).
 *
 * 모델: 가우시안 프로세스 회귀(GPR)
 *   입력 X 와 출력 y 를 각각 평균 0 · 표준편차 1 로 표준화한 뒤
 *   RBF 커널 k(x,x') = σf² · exp(-|x-x'|² / (2ℓ²)) 에 관측 노이즈 σn² I 를 더한다.
 *   하이퍼파라미터 3종(길이 척도 ℓ · 신호 크기 σf · 노이즈 σn)은 **표준화된 단위**다.
 *   ℓ = 1 이면 "입력이 표준편차 하나만큼 떨어지면 상관이 크게 줄어든다"는 뜻이다.
 *
 * 예측 표준편차는 잠재 함수 f 의 불확실성(노이즈 제외)이다.
 */
(function (root) {
  'use strict';

  /* ---------- 난수 (시드 고정) ---------- */
  // mulberry32 — 같은 시드면 같은 수열. 학습/검증 분할을 다시 해도 같아야 결과를 대조할 수 있다.
  function rng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r) { var u = 1 - r(), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  /* ---------- 숫자 읽기 ---------- */
  // 빈 칸 → { ok:false, why:'빈 칸' } · 글자 → { ok:false, why:'숫자가 아님' }
  function parseNum(v) {
    if (typeof v === 'number') return isFinite(v) ? { ok: true, v: v } : { ok: false, why: '숫자가 아님' };
    if (v == null) return { ok: false, why: '빈 칸' };
    var s = String(v).trim();
    if (s === '') return { ok: false, why: '빈 칸' };
    if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');   // 1,234.5
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return { ok: false, why: '숫자가 아님' };
    return { ok: true, v: parseFloat(s) };
  }

  /* ---------- CSV ---------- */
  // 따옴표 칸·칸 안 쉼표·BOM 을 처리한다. 구분자는 첫 줄에서 쉼표 · 세미콜론 · 탭 중 많은 것.
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var cand = [',', ';', '\t'], d = ',', best = -1;
    cand.forEach(function (c) { var n = first.split(c).length; if (n > best) { best = n; d = c; } });
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === d) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    if (!rows.length) return { header: [], rows: [] };
    var header = rows[0].map(function (h, j) { h = String(h).trim(); return h || ('열' + (j + 1)); });
    return { header: header, rows: rows.slice(1).map(function (r) {
      var o = {}; header.forEach(function (h, j) { o[h] = r[j] == null ? '' : r[j]; }); return o;
    }) };
  }

  /* ---------- 열 고르기 · 데이터 정리 ---------- */
  var RUN_NAME = /^(run|runs|no\.?|#|번호|순번|실험\s*번호|run\s*no\.?)$/i;
  function columnsOf(rows) {
    var h = [];
    rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (h.indexOf(k) < 0) h.push(k); }); });
    return h;
  }
  // 숫자 칸이 절반 이상인 열만 후보. Run 같은 번호 열은 뺀다. 목표는 마지막 숫자 열.
  function guessColumns(rows, header) {
    header = header || columnsOf(rows);
    var runCol = header.filter(function (h) { return RUN_NAME.test(String(h).trim()); })[0] || null;
    var numeric = header.filter(function (h) {
      if (h === runCol) return false;
      var n = 0, t = 0;
      rows.forEach(function (r) { var v = r[h]; if (v == null || String(v).trim() === '') return; t++; if (parseNum(v).ok) n++; });
      return t > 0 && n / t >= 0.5;
    });
    var target = numeric.length ? numeric[numeric.length - 1] : null;
    return { runCol: runCol, target: target, inputs: numeric.filter(function (h) { return h !== target; }) };
  }
  // 숫자 아닌 칸·빈 칸이 하나라도 있으면 그 행을 빼고 사유를 남긴다 — 조용히 빠지면 아무도 모른다.
  function prepare(rows, opt) {
    opt = opt || {};
    var g = guessColumns(rows, opt.header);
    var inputs = opt.inputs || g.inputs, target = opt.target || g.target;
    var runCol = opt.runCol !== undefined ? opt.runCol : g.runCol;
    var out = { inputs: inputs, target: target, runCol: runCol, X: [], y: [], runs: [], rowNo: [], dropped: [], errors: [] };
    if (!target) out.errors.push('목표(결과값) 열이 없습니다. 숫자로 된 결과 열을 하나 고르세요.');
    if (!inputs.length) out.errors.push('설계인자 열이 없습니다. 숫자로 된 인자 열을 하나 이상 고르세요.');
    if (inputs.indexOf(target) >= 0) out.errors.push('목표 열은 설계인자로 함께 쓸 수 없습니다.');
    if (out.errors.length) return out;
    var cols = inputs.concat([target]);
    rows.forEach(function (r, i) {
      var run = runCol && r[runCol] != null && String(r[runCol]).trim() !== '' ? String(r[runCol]).trim() : String(i + 1);
      if (cols.every(function (c) { return r[c] == null || String(r[c]).trim() === ''; })) return;   // 완전히 빈 줄은 줄로 세지 않는다
      var why = [], vals = [];
      cols.forEach(function (c) { var p = parseNum(r[c]); if (p.ok) vals.push(p.v); else why.push(c + ' ' + (p.why === '빈 칸' ? '빈 칸' : '숫자가 아님(' + String(r[c]).trim() + ')')); });
      if (why.length) { out.dropped.push({ row: i + 1, run: run, reason: why.join(', ') }); return; }
      out.X.push(vals.slice(0, inputs.length)); out.y.push(vals[inputs.length]); out.runs.push(run); out.rowNo.push(i + 1);
    });
    if (out.y.length < 4) out.errors.push('쓸 수 있는 행이 ' + out.y.length + '개입니다. 학습·검증을 나누려면 4행 이상 필요합니다.');
    return out;
  }
  function ranges(X) {
    var d = X[0] ? X[0].length : 0, r = [];
    for (var j = 0; j < d; j++) {
      var lo = Infinity, hi = -Infinity, s = 0;
      X.forEach(function (x) { if (x[j] < lo) lo = x[j]; if (x[j] > hi) hi = x[j]; s += x[j]; });
      r.push({ min: lo, max: hi, mean: s / X.length });
    }
    return r;
  }

  /* ---------- 학습/검증 분할 ---------- */
  // ratio = 학습 비율. 학습 2개 이상 · 검증 1개 이상을 보장한다. 같은 seed → 같은 분할.
  function split(n, ratio, seed) {
    var idx = []; for (var i = 0; i < n; i++) idx.push(i);
    var r = rng(seed == null ? 42 : seed);
    for (var k = n - 1; k > 0; k--) { var j = Math.floor(r() * (k + 1)); var t = idx[k]; idx[k] = idx[j]; idx[j] = t; }
    var nt = Math.round(n * ratio);
    nt = Math.max(2, Math.min(n - 1, nt));
    var asc = function (a, b) { return a - b; };
    return { train: idx.slice(0, nt).sort(asc), test: idx.slice(nt).sort(asc) };
  }

  /* ---------- 선형대수 ---------- */
  function cholesky(A) {
    var n = A.length, L = [];
    for (var i = 0; i < n; i++) L.push(new Float64Array(n));
    for (i = 0; i < n; i++) {
      for (var j = 0; j <= i; j++) {
        var s = A[i][j];
        for (var k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) {
          if (!(s > 0)) throw new Error('양의 정부호가 아닙니다');
          L[i][i] = Math.sqrt(s);
        } else L[i][j] = s / L[j][j];
      }
    }
    return L;
  }
  function solveL(L, b) {   // L z = b
    var n = L.length, z = new Float64Array(n);
    for (var i = 0; i < n; i++) { var s = b[i]; for (var k = 0; k < i; k++) s -= L[i][k] * z[k]; z[i] = s / L[i][i]; }
    return z;
  }
  function solveLT(L, z) {  // Lᵀ x = z
    var n = L.length, x = new Float64Array(n);
    for (var i = n - 1; i >= 0; i--) { var s = z[i]; for (var k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
    return x;
  }
  // 수치적으로 겨우 양의 정부호가 아닐 때(같은 조건을 두 번 잰 Run 등) 대각에 아주 작은 값을 더해 다시 해 본다.
  function cholJitter(K) {
    var n = K.length, scale = 0;
    for (var i = 0; i < n; i++) scale += K[i][i];
    scale = scale / Math.max(1, n) || 1;
    var jit = 0;
    for (var t = 0; t < 8; t++) {
      try {
        var A = K;
        if (jit) { A = K.map(function (row, r) { var c = row.slice(); c[r] += jit; return c; }); }
        return { L: cholesky(A), jitter: jit };
      } catch (e) { jit = jit ? jit * 10 : scale * 1e-10; }
    }
    throw new Error('커널 행렬을 분해하지 못했습니다(노이즈를 조금 키워 보세요)');
  }

  /* ---------- 커널 · 핵심 GP ---------- */
  function sqdist(a, b) { var s = 0; for (var j = 0; j < a.length; j++) { var d = a[j] - b[j]; s += d * d; } return s; }
  function kern(a, b, h) { return h.sf * h.sf * Math.exp(-sqdist(a, b) / (2 * h.ell * h.ell)); }
  // 표준화된 공간에서의 GP. 로그 주변우도 = -½yᵀα - Σlog Lii - n/2·log 2π
  function core(Xs, ys, h) {
    var n = Xs.length, K = [];
    for (var i = 0; i < n; i++) {
      var row = new Array(n);
      for (var j = 0; j < n; j++) row[j] = kern(Xs[i], Xs[j], h) + (i === j ? h.sn * h.sn : 0);
      K.push(row);
    }
    var c = cholJitter(K);
    var alpha = solveLT(c.L, solveL(c.L, ys));
    var fit = 0, logdet = 0;
    for (i = 0; i < n; i++) { fit += ys[i] * alpha[i]; logdet += Math.log(c.L[i][i]); }
    return { L: c.L, alpha: alpha, jitter: c.jitter, logML: -0.5 * fit - logdet - 0.5 * n * Math.log(2 * Math.PI) };
  }

  /* ---------- 표준화 ---------- */
  function scalerOf(X, y) {
    var d = X[0].length, xm = [], xs = [];
    for (var j = 0; j < d; j++) {
      var m = 0; X.forEach(function (x) { m += x[j]; }); m /= X.length;
      var v = 0; X.forEach(function (x) { v += (x[j] - m) * (x[j] - m); }); v = Math.sqrt(v / X.length);
      xm.push(m); xs.push(v > 1e-12 ? v : 1);     // 값이 모두 같은 열은 나누지 않는다
    }
    var ym = 0; y.forEach(function (v) { ym += v; }); ym /= y.length;
    var ys = 0; y.forEach(function (v) { ys += (v - ym) * (v - ym); }); ys = Math.sqrt(ys / y.length);
    return { xm: xm, xs: xs, ym: ym, ys: ys > 1e-12 ? ys : 1 };
  }
  function sx(sc, x) { return x.map(function (v, j) { return (v - sc.xm[j]) / sc.xs[j]; }); }

  /* ---------- 학습 · 예측 ---------- */
  // hyper = { ell, sf, sn } (표준화 단위). scaler 를 주면 그 계수를 그대로 쓴다(저장한 모델 되살리기).
  function fit(X, y, hyper, scaler) {
    if (!X.length) throw new Error('학습 데이터가 없습니다');
    var sc = scaler || scalerOf(X, y);
    var Xs = X.map(function (x) { return sx(sc, x); });
    var ys = y.map(function (v) { return (v - sc.ym) / sc.ys; });
    var h = { ell: +hyper.ell, sf: +hyper.sf, sn: +hyper.sn };
    if (!(h.ell > 0 && h.sf > 0 && h.sn >= 0)) throw new Error('하이퍼파라미터는 양수여야 합니다');
    var c = core(Xs, ys, h);
    return { hyper: h, scaler: sc, X: X.map(function (x) { return x.slice(); }), y: y.slice(), Xs: Xs, L: c.L, alpha: c.alpha, jitter: c.jitter, logML: c.logML };
  }
  function predictMean(m, x) {
    var z = sx(m.scaler, x), s = 0;
    for (var i = 0; i < m.Xs.length; i++) s += kern(z, m.Xs[i], m.hyper) * m.alpha[i];
    return s * m.scaler.ys + m.scaler.ym;
  }
  function predict(m, Xnew) {
    var mean = [], sd = [];
    Xnew.forEach(function (x) {
      var z = sx(m.scaler, x), n = m.Xs.length, ks = new Float64Array(n), s = 0;
      for (var i = 0; i < n; i++) { ks[i] = kern(z, m.Xs[i], m.hyper); s += ks[i] * m.alpha[i]; }
      var v = solveL(m.L, ks), vv = 0;
      for (i = 0; i < n; i++) vv += v[i] * v[i];
      var varz = Math.max(0, m.hyper.sf * m.hyper.sf - vv);
      mean.push(s * m.scaler.ys + m.scaler.ym);
      sd.push(Math.sqrt(varz) * m.scaler.ys);
    });
    return { mean: mean, sd: sd };
  }

  /* ---------- 지표 ---------- */
  // R² = 1 - SS잔차 / SS전체. 실측이 모두 같으면 정의되지 않아 null.
  function metrics(yt, yp) {
    var n = yt.length; if (!n) return { r2: null, rmse: null, mae: null, n: 0 };
    var m = 0; yt.forEach(function (v) { m += v; }); m /= n;
    var ssr = 0, sst = 0, ae = 0;
    for (var i = 0; i < n; i++) { var e = yt[i] - yp[i]; ssr += e * e; ae += Math.abs(e); sst += (yt[i] - m) * (yt[i] - m); }
    return { r2: sst > 1e-12 ? 1 - ssr / sst : null, rmse: Math.sqrt(ssr / n), mae: ae / n, n: n };
  }

  /* ---------- 하이퍼파라미터 탐색 ---------- */
  function logspace(lo, hi, n) {
    lo = +lo; hi = +hi; n = Math.max(1, Math.round(+n));
    if (!(lo > 0 && hi > 0)) return [];
    if (n === 1 || lo === hi) return [lo];
    var a = Math.log(lo), b = Math.log(hi), out = [];
    for (var i = 0; i < n; i++) out.push(+Math.exp(a + (b - a) * i / (n - 1)).toPrecision(6));
    return out;
  }
  var HYPER = [
    { key: 'ell', name: '길이 척도 ℓ', def: { min: 0.3, max: 3, n: 5 } },
    { key: 'sf', name: '신호 크기 σf', def: { min: 0.5, max: 2, n: 3 } },
    { key: 'sn', name: '노이즈 σn', def: { min: 0.01, max: 0.3, n: 3 } }
  ];
  function hyperGrid(rg) {
    var a = logspace(rg.ell.min, rg.ell.max, rg.ell.n), b = logspace(rg.sf.min, rg.sf.max, rg.sf.n), c = logspace(rg.sn.min, rg.sn.max, rg.sn.n), out = [];
    a.forEach(function (ell) { b.forEach(function (sf) { c.forEach(function (sn) { out.push({ ell: ell, sf: sf, sn: sn }); }); }); });
    return out;
  }
  function pick(arr, idx) { return idx.map(function (i) { return arr[i]; }); }
  // 검증 R² 큰 순, 같으면 로그 주변우도 큰 순. 정의 안 된 R² 는 맨 뒤.
  function rank(a, b) {
    var ra = a.test.r2 == null ? -Infinity : a.test.r2, rb = b.test.r2 == null ? -Infinity : b.test.r2;
    if (Math.abs(ra - rb) > 1e-9) return rb - ra;
    return b.logML - a.logML;
  }
  function searchHyper(X, y, sp, rg) {
    var Xtr = pick(X, sp.train), ytr = pick(y, sp.train), Xte = pick(X, sp.test), yte = pick(y, sp.test);
    var res = [];
    hyperGrid(rg).forEach(function (h, i) {
      try {
        var m = fit(Xtr, ytr, h);
        var ptr = predict(m, Xtr).mean, pte = predict(m, Xte).mean;
        res.push({ id: i, hyper: m.hyper, train: metrics(ytr, ptr), test: metrics(yte, pte), logML: m.logML, jitter: m.jitter });
      } catch (e) { res.push({ id: i, hyper: h, train: metrics([], []), test: { r2: null }, logML: -Infinity, error: e.message }); }
    });
    res.sort(rank);
    res.forEach(function (r, k) { r.rank = k + 1; });
    return res;
  }
  // 하이퍼파라미터 하나의 값마다, 나머지 둘을 어떻게 골랐을 때든 가장 좋았던 검증 R².
  function hyperProfile(results, key) {
    var vals = [];
    results.forEach(function (r) { if (vals.indexOf(r.hyper[key]) < 0) vals.push(r.hyper[key]); });
    vals.sort(function (a, b) { return a - b; });
    return vals.map(function (v) {
      var best = null;
      results.forEach(function (r) { if (r.hyper[key] === v && r.test.r2 != null && (best == null || r.test.r2 > best)) best = r.test.r2; });
      return { value: v, best: best };
    });
  }
  // 고른 하이퍼파라미터로 학습 모델(평가용) · 학습+검증 전체 모델(최적화·저장용)을 만든다.
  function evaluate(X, y, sp, hyper) {
    var mTr = fit(pick(X, sp.train), pick(y, sp.train), hyper);
    var p = predict(mTr, X);
    var rows = X.map(function (x, i) {
      return { i: i, set: sp.test.indexOf(i) >= 0 ? 'test' : 'train', actual: y[i], pred: p.mean[i], sd: p.sd[i], resid: y[i] - p.mean[i] };
    });
    var tr = rows.filter(function (r) { return r.set === 'train'; }), te = rows.filter(function (r) { return r.set === 'test'; });
    return {
      model: mTr, rows: rows,
      train: metrics(tr.map(function (r) { return r.actual; }), tr.map(function (r) { return r.pred; })),
      test: metrics(te.map(function (r) { return r.actual; }), te.map(function (r) { return r.pred; })),
      final: fit(X, y, hyper)
    };
  }

  // 고른 모델을 믿기 전에 볼 것. 기준: 검증 R² < 0.7 · 학습-검증 R² 차 > 0.2(과적합 가능)
  var WARN_R2 = 0.7, WARN_GAP = 0.2;
  function diagnose(ev) {
    var w = [];
    if (ev.test.r2 == null) w.push('검증 Run 의 실측이 모두 같아 검증 R² 를 계산할 수 없습니다. 시드나 비율을 바꿔 보세요.');
    else {
      if (ev.test.r2 < WARN_R2) w.push('검증 R² 가 ' + WARN_R2 + ' 보다 낮습니다. 최적 조건을 믿기 전에 Run 을 늘리거나 탐색 범위를 넓혀 보세요.');
      if (ev.train.r2 != null && ev.train.r2 - ev.test.r2 > WARN_GAP) w.push('학습 R² 와 검증 R² 차이가 ' + WARN_GAP + ' 보다 큽니다(과적합 가능). 노이즈 σn 을 키우거나 길이 척도 ℓ 를 늘려 보세요.');
    }
    return w;
  }
  // 데이터에서 목표에 가장 맞는 실측 Run (최적 조건과 견주어 보기 위함)
  function bestObserved(y, goal, target) {
    var k = 0;
    y.forEach(function (v, i) {
      var better = goal === 'min' ? v < y[k] : goal === 'target' ? Math.abs(v - target) < Math.abs(y[k] - target) : v > y[k];
      if (better) k = i;
    });
    return { i: k, y: y[k] };
  }

  /* ---------- 영향도(파레토) · 반응 곡선 ---------- */
  function sweep(lo, hi, n) { var out = []; for (var k = 0; k < n; k++) out.push(n === 1 ? lo : lo + (hi - lo) * k / (n - 1)); return out; }
  // 다른 인자를 base 에 고정하고 인자 하나만 [min,max] 에서 흔들 때 예측 평균이 움직이는 폭.
  function pareto(m, names, base, bnd, n) {
    n = n || 21;
    var items = names.map(function (nm, j) {
      var lo = Infinity, hi = -Infinity;
      sweep(bnd[j].min, bnd[j].max, n).forEach(function (v) { var x = base.slice(); x[j] = v; var p = predictMean(m, x); if (p < lo) lo = p; if (p > hi) hi = p; });
      return { name: nm, j: j, effect: hi - lo };
    });
    var tot = items.reduce(function (s, it) { return s + it.effect; }, 0);
    items.sort(function (a, b) { return b.effect - a.effect; });
    var cum = 0;
    items.forEach(function (it) { it.pct = tot > 0 ? it.effect / tot * 100 : 0; cum += it.pct; it.cum = cum; });
    return items;
  }
  function response(m, base, j, lo, hi, n) {
    var xs = sweep(lo, hi, n || 41), X = xs.map(function (v) { var x = base.slice(); x[j] = v; return x; });
    var p = predict(m, X);
    return { x: xs, mean: p.mean, sd: p.sd };
  }

  /* ---------- Grid Search ---------- */
  var GRID_LIMIT = 200000;
  function axisValues(f) {
    var lo = +f.min, hi = +f.max, st = +f.step;
    if (!(isFinite(lo) && isFinite(hi))) return { error: '최소·최대를 숫자로 적으세요' };
    if (hi < lo) return { error: '최대가 최소보다 작습니다' };
    if (hi === lo) return { values: [lo] };
    if (!(st > 0)) return { error: '간격은 0보다 커야 합니다' };
    var n = Math.floor((hi - lo) / st + 1e-9) + 1, out = [];
    if (n > GRID_LIMIT) return { count: n, values: null };
    for (var k = 0; k < n; k++) out.push(+(lo + k * st).toPrecision(12));
    if (out[out.length - 1] < hi - (hi - lo) * 1e-9) out.push(hi);   // 간격이 딱 떨어지지 않으면 최대를 덧붙인다
    return { values: out };
  }
  function gridCount(spec) {
    var c = 1, errs = [];
    spec.forEach(function (f, j) {
      var a = axisValues(f);
      if (a.error) errs.push((f.name || ('인자' + (j + 1))) + ': ' + a.error);
      else c *= a.values ? a.values.length : a.count;
    });
    return { count: errs.length ? 0 : c, errors: errs, tooMany: !errs.length && c > GRID_LIMIT, limit: GRID_LIMIT };
  }
  // goal: 'max' | 'min' | 'target'. 예측 평균만으로 순위를 매기고, 상위 후보만 표준편차를 계산한다.
  function gridSearch(m, spec, goal, opt) {
    opt = opt || {};
    var top = opt.top || 10, tgt = +opt.target;
    var gc = gridCount(spec);
    if (gc.errors.length || gc.tooMany) return { count: gc.count, errors: gc.errors, tooMany: gc.tooMany, top: [] };
    var axes = spec.map(function (f) { return axisValues(f).values; });
    var score = goal === 'min' ? function (v) { return -v; } : goal === 'target' ? function (v) { return -Math.abs(v - tgt); } : function (v) { return v; };
    var bnd = ranges(m.X), keep = [], idx = axes.map(function () { return 0; }), d = axes.length;
    for (var c = 0; c < gc.count; c++) {
      var x = idx.map(function (k, j) { return axes[j][k]; });
      var mu = predictMean(m, x), s = score(mu);
      if (keep.length < top || s > keep[keep.length - 1].score) {
        keep.push({ x: x, mean: mu, score: s });
        keep.sort(function (a, b) { return b.score - a.score; });
        if (keep.length > top) keep.pop();
      }
      for (var j = d - 1; j >= 0; j--) { idx[j]++; if (idx[j] < axes[j].length) break; idx[j] = 0; }
    }
    var p = predict(m, keep.map(function (k) { return k.x; }));
    keep.forEach(function (k, i) {
      k.sd = p.sd[i]; k.rank = i + 1;
      k.outside = k.x.map(function (v, j) { return v < bnd[j].min - 1e-9 || v > bnd[j].max + 1e-9; });
      k.anyOutside = k.outside.some(Boolean);
    });
    return { count: gc.count, errors: [], tooMany: false, top: keep, goal: goal, target: goal === 'target' ? tgt : null };
  }
  // 범위의 1/10 근처에서 1 · 2 · 5 × 10ⁿ 꼴의 간격
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
    return +((f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e).toPrecision(6);
  }
  function defaultSpec(names, X) {
    return ranges(X).map(function (r, j) {
      return { name: names[j], min: r.min, max: r.max, step: niceStep((r.max - r.min) / 10) };
    });
  }

  /* ---------- 모델 저장 · 불러오기 ---------- */
  var FORMAT = 'gpr-optimizer-model';
  function toJSON(m, meta) {
    meta = meta || {};
    return {
      format: FORMAT, version: 1, savedAt: meta.savedAt || new Date().toISOString(),
      inputs: meta.inputs || [], target: meta.target || '', runs: meta.runs || [],
      hyper: m.hyper, scaler: m.scaler, X: m.X, y: m.y, logML: m.logML,
      metrics: meta.metrics || null, split: meta.split || null,
      note: '하이퍼파라미터는 표준화 단위입니다. X·y 는 학습에 쓴 원래 단위 데이터입니다.'
    };
  }
  function fromJSON(o) {
    if (typeof o === 'string') o = JSON.parse(o);
    if (!o || o.format !== FORMAT) throw new Error('이 도구에서 저장한 모델 파일이 아닙니다');
    if (!Array.isArray(o.X) || !Array.isArray(o.y) || o.X.length !== o.y.length || !o.X.length) throw new Error('학습 데이터가 비어 있거나 맞지 않습니다');
    var d = o.X[0].length;
    if (o.inputs && o.inputs.length !== d) throw new Error('설계인자 수와 데이터 열 수가 다릅니다');
    var m = fit(o.X, o.y, o.hyper, o.scaler);
    return { model: m, inputs: o.inputs || [], target: o.target || '', runs: o.runs || [], metrics: o.metrics || null, split: o.split || null, savedAt: o.savedAt };
  }

  /* ---------- 엑셀 보고 (시트별 2차원 배열) ---------- */
  function r4(v) { return v == null || !isFinite(v) ? '' : +(+v).toPrecision(6); }
  function reportSheets(s) {
    var out = {};
    var head = ['Run'].concat(s.inputs, [s.target, '구분']);
    var data = [head];
    s.X.forEach(function (x, i) {
      var set = s.split ? (s.split.test.indexOf(i) >= 0 ? '검증' : '학습') : '';
      data.push([s.runs[i]].concat(x, [s.y[i], set]));
    });
    (s.dropped || []).forEach(function (d) { data.push([d.run].concat(s.inputs.map(function () { return ''; }), ['', '제외 — ' + d.reason])); });
    out['데이터'] = data;
    var cmp = [['순위', '길이 척도 ℓ', '신호 크기 σf', '노이즈 σn', '학습 R²', '검증 R²', '검증 RMSE', '검증 MAE', '로그 주변우도', '선택']];
    (s.results || []).forEach(function (r) {
      cmp.push([r.rank, r.hyper.ell, r.hyper.sf, r.hyper.sn, r4(r.train.r2), r4(r.test.r2), r4(r.test.rmse), r4(r.test.mae), r4(r.logML), s.chosen === r.id ? '선택' : '']);
    });
    out['모델비교'] = cmp;
    var ev = [['Run', '구분', '실측', '예측', '잔차(실측-예측)', '예측 표준편차']];
    if (s.evaluation) s.evaluation.rows.forEach(function (r) { ev.push([s.runs[r.i], r.set === 'test' ? '검증' : '학습', r.actual, r4(r.pred), r4(r.resid), r4(r.sd)]); });
    out['검증예측'] = ev;
    var op = [];
    if (s.optimum && s.optimum.top.length) {
      var gl = { max: '최대화', min: '최소화', target: '목표값 ' + s.optimum.target }[s.optimum.goal];
      op.push(['목표', s.target + ' ' + gl], ['탐색 조합 수', s.optimum.count], ['주의', '예측값은 모델 추정이며 확인 실험이 필요합니다.'], []);
      op.push(['순위'].concat(s.inputs, ['예측 평균', '예측 표준편차', '학습 데이터 범위 밖']));
      s.optimum.top.forEach(function (k) {
        op.push([k.rank].concat(k.x, [r4(k.mean), r4(k.sd), k.anyOutside ? s.inputs.filter(function (n, j) { return k.outside[j]; }).join(', ') : '']));
      });
    } else op.push(['최적 조건 탐색을 아직 하지 않았습니다.']);
    out['최적조건'] = op;
    return out;
  }

  /* ---------- 예제 (가짜 실험 데이터) ---------- */
  // 알려진 함수 + 잡음. 강도 = 60 - 0.004(온도-210)² - 0.6(압력-6.5)² + 8(1-e^(-시간/20)) + N(0, 0.6²)
  // 참 최대점: 온도 210 · 압력 6.5 · 시간 60(범위 끝). 실제 사내 데이터가 아닙니다.
  function truth(T, P, t) { return 60 - 0.004 * (T - 210) * (T - 210) - 0.6 * (P - 6.5) * (P - 6.5) + 8 * (1 - Math.exp(-t / 20)); }
  function sample() {
    var r = rng(2611), n = 30, rows = [];
    var lhs = function (lo, hi) {       // 라틴 하이퍼큐브 — 구간마다 한 점
      var cuts = []; for (var i = 0; i < n; i++) cuts.push(i);
      for (var k = n - 1; k > 0; k--) { var j = Math.floor(r() * (k + 1)); var t = cuts[k]; cuts[k] = cuts[j]; cuts[j] = t; }
      return cuts.map(function (c) { return lo + (hi - lo) * (c + r()) / n; });
    };
    var T = lhs(150, 250), P = lhs(2, 10), t = lhs(10, 60);
    for (var i = 0; i < n; i++) {
      var a = Math.round(T[i]), b = Math.round(P[i] * 10) / 10, c = Math.round(t[i]);
      rows.push({ Run: 'R' + (i + 1 < 10 ? '0' : '') + (i + 1), '온도(℃)': a, '압력(bar)': b, '시간(분)': c, '강도(MPa)': Math.round((truth(a, b, c) + 0.6 * gauss(r)) * 100) / 100 });
    }
    return rows;
  }

  var api = {
    rng: rng, parseNum: parseNum, parseCSV: parseCSV, columnsOf: columnsOf, guessColumns: guessColumns, prepare: prepare, ranges: ranges,
    split: split, cholesky: cholesky, solveL: solveL, solveLT: solveLT, cholJitter: cholJitter, core: core, kern: kern,
    scalerOf: scalerOf, fit: fit, predict: predict, predictMean: predictMean, metrics: metrics,
    logspace: logspace, HYPER: HYPER, hyperGrid: hyperGrid, searchHyper: searchHyper, rank: rank, hyperProfile: hyperProfile, evaluate: evaluate, diagnose: diagnose, bestObserved: bestObserved,
    pareto: pareto, response: response, axisValues: axisValues, gridCount: gridCount, gridSearch: gridSearch, defaultSpec: defaultSpec, niceStep: niceStep, GRID_LIMIT: GRID_LIMIT,
    toJSON: toJSON, fromJSON: fromJSON, reportSheets: reportSheets, sample: sample, truth: truth
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GPR = api;
})(this);
