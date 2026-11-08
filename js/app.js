/* 화면 — 계산·판정은 gpr.js 가 한다. 여기서는 읽고, 그리고, 고른 값을 넘길 뿐이다. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var state = {
    cols: [], rows: [],             // 표(글자 그대로)
    roles: null,                    // { runCol, target, inputs }
    data: null,                     // GPR.prepare 결과
    split: null, results: null, chosen: null, evaluation: null,
    final: null, finalInputs: null, finalTarget: null, loaded: null,
    optimum: null,
    type: 'gp',                     // (v1.1) 'gp' | 'rbf' — 왼쪽 메뉴에서 고른 모델 종류
    byType: {}                      // 종류별 마지막 학습 결과(데이터가 바뀌면 비운다)
  };
  var MD = function () { return GPR.modelOf(state.type); };

  /* ---------- 표 ---------- */
  function setTable(cols, rows) {
    state.cols = cols.slice();
    state.rows = rows.map(function (r) { return cols.map(function (c, j) { var v = Array.isArray(r) ? r[j] : r[c]; return v == null ? '' : String(v); }); });
    var g = GPR.guessColumns(objects(), state.cols);
    state.roles = { runCol: g.runCol, target: g.target, inputs: g.inputs };
    renderGrid(); renderRoles(); refreshData();
  }
  function objects() {
    return state.rows.map(function (r) { var o = {}; state.cols.forEach(function (c, j) { o[c] = r[j]; }); return o; });
  }
  function renderGrid() {
    var h = '<table><thead><tr><th class="rn">#</th>' + state.cols.map(function (c, j) {
      return '<th><input class="hc" data-j="' + j + '" value="' + esc(c) + '" aria-label="열 이름 ' + (j + 1) + '"></th>';
    }).join('') + '</tr></thead><tbody>';
    state.rows.forEach(function (r, i) {
      h += '<tr><td class="rn">' + (i + 1) + '</td>' + r.map(function (v, j) {
        return '<td><input data-i="' + i + '" data-j="' + j + '" value="' + esc(v) + '"></td>';
      }).join('') + '</tr>';
    });
    $('grid').innerHTML = h + '</tbody></table>';
  }
  function renderRoles() {
    var r = state.roles, c = state.cols;
    if (!c.length) { $('roles').innerHTML = ''; return; }
    var opt = function (sel, none) { return (none ? '<option value="">(없음)</option>' : '') + c.map(function (x) { return '<option' + (x === sel ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); };
    $('roles').innerHTML =
      '<label>Run 열 <select id="r-run">' + opt(r.runCol, true) + '</select></label>' +
      '<label>목표(결과값) <select id="r-target">' + opt(r.target, true) + '</select></label>' +
      '<fieldset><legend>설계인자</legend>' + c.filter(function (x) { return x !== r.target && x !== r.runCol; }).map(function (x) {
        return '<label class="chk"><input type="checkbox" class="r-in" value="' + esc(x) + '"' + (r.inputs.indexOf(x) >= 0 ? ' checked' : '') + '> ' + esc(x) + '</label>';
      }).join('') + '</fieldset>';
  }
  var timer = null;
  function later() { clearTimeout(timer); timer = setTimeout(refreshData, 250); }

  function refreshData() {
    var r = state.roles;
    if (!state.cols.length) { $('data-status').innerHTML = ''; showFrom(1); return; }
    var d = GPR.prepare(objects(), { header: state.cols, runCol: r.runCol || null, target: r.target, inputs: r.inputs });
    state.data = d;
    var h = '';
    if (!d.errors.length) {
      h += '<div class="stats">' + stat('설계인자', d.inputs.length) + stat('목표', esc(d.target)) + stat('쓸 수 있는 Run', d.y.length) + stat('제외한 행', d.dropped.length) + '</div>';
    }
    if (d.errors.length) h += '<div class="warn">' + d.errors.map(esc).join('<br>') + '</div>';
    if (d.dropped.length) h += '<div class="warn"><b>뺀 행 ' + d.dropped.length + '개</b> — 숫자가 아니거나 빈 칸이 있어 학습에 쓰지 않습니다.<ul>' +
      d.dropped.map(function (x) { return '<li>' + (x.row) + '행(Run ' + esc(x.run) + '): ' + esc(x.reason) + '</li>'; }).join('') + '</ul></div>';
    else if (!d.errors.length) h += '<div class="ok">모든 행을 학습에 쓸 수 있습니다.</div>';
    $('data-status').innerHTML = h;
    // 데이터가 바뀌면 이전 학습 결과는 맞지 않는다 — 불러온 모델만 남긴다
    state.results = null; state.evaluation = null; state.optimum = null; state.byType = {}; renderSideResults();
    if (!state.loaded) state.final = null;
    if (d.errors.length) { showFrom(1); if (state.loaded) showLoaded(); return; }
    $('s-train').hidden = false; showFrom(2);
    renderSplitInfo(); renderHyperCount();
    if (state.loaded) showLoaded();
  }
  function showFrom(n) {   // n 보다 뒤 단계 숨김
    ['s-train', 's-models', 's-opt', 's-surf', 's-out'].forEach(function (id, k) { if (Math.min(k, 3) + 2 > n) $(id).hidden = true; });
  }
  function stat(k, v) { return '<div class="stat"><b>' + v + '</b>' + k + '</div>'; }

  /* ---------- 학습 설정 ---------- */
  function hyperRanges() {
    var rg = {};
    MD().hyper.forEach(function (h) { rg[h.key] = { min: +$('h-' + h.key + '-min').value, max: +$('h-' + h.key + '-max').value, n: +$('h-' + h.key + '-n').value }; });
    return rg;
  }
  var MEAN = { ell: '클수록 완만한 곡면(멀리 떨어진 Run 끼리도 비슷하다고 봄)', sf: '결과값이 평균에서 벗어나는 정도', sn: '같은 조건에서도 생기는 측정 잡음',
    k: '은닉층 중심(뉴런) 수 — 학습 Run 을 k 무리로 묶은 중심. 학습 Run 수 이상이면 학습점 전부', width: '중심 하나가 영향을 미치는 거리 — 클수록 완만한 곡면', lambda: '출력 가중치를 작게 누르는 정도 — 클수록 과적합을 덜 함' };
  var HOW = {
    gp: '입력·출력을 표준화(평균 0 · 표준편차 1)한 뒤의 값입니다. 최소와 최대 사이를 로그 간격으로 나눕니다.',
    rbf: '입력·출력을 표준화(평균 0 · 표준편차 1)한 뒤의 값입니다. 중심 수는 최소~최대를 고르게 나눈 정수, 폭·규제는 로그 간격입니다. RBFNN 은 예측 표준편차(σ)를 내지 않습니다.'
  };
  function renderHyperTable() {
    $('h-model').textContent = '— ' + MD().name;
    $('h-how').textContent = HOW[MD().key];
    $('hyper-tbl').querySelector('tbody').innerHTML = MD().hyper.map(function (h) {
      return '<tr><td><b>' + esc(h.name) + '</b></td><td class="wrap">' + esc(MEAN[h.key]) + '</td>' +
        '<td><input type="number" class="hp" id="h-' + h.key + '-min" value="' + h.def.min + '" step="' + (h.int ? 1 : 'any') + '" min="0"></td>' +
        '<td><input type="number" class="hp" id="h-' + h.key + '-max" value="' + h.def.max + '" step="' + (h.int ? 1 : 'any') + '" min="0"></td>' +
        '<td><input type="number" class="hp" id="h-' + h.key + '-n" value="' + h.def.n + '" step="1" min="1" max="12"></td>' +
        '<td class="mono vals" id="h-' + h.key + '-vals"></td></tr>';
    }).join('');
  }
  function renderHyperCount() {
    if (!$('h-' + MD().hyper[0].key + '-min')) return;
    var rg = hyperRanges(), n = GPR.hyperGrid(rg, state.type).length;
    MD().hyper.forEach(function (h) { $('h-' + h.key + '-vals').textContent = GPR.hyperValues(h, rg[h.key]).map(fmt).join(' · ') || (h.int ? '1 이상의 정수를 적으세요' : '최소·최대는 0보다 커야 합니다'); });
    $('h-count').textContent = '모델 ' + n + '개를 만듭니다';
    $('btn-train').disabled = !n;
  }
  function currentSplit() {
    var d = state.data, ratio = Math.min(0.95, Math.max(0.5, (+$('ratio').value || 80) / 100));
    return GPR.split(d.y.length, ratio, Math.round(+$('seed').value || 0));
  }
  function renderSplitInfo() {
    if (!state.data || state.data.errors.length) return;
    var sp = currentSplit();
    $('split-info').innerHTML = '학습 <b>' + sp.train.length + '</b> · 검증 <b>' + sp.test.length + '</b> Run<br><span class="sub">검증: ' + sp.test.map(function (i) { return esc(state.data.runs[i]); }).join(', ') + '</span>';
  }

  function train() {
    var d = state.data;
    state.split = currentSplit();
    state.results = GPR.searchHyper(d.X, d.y, state.split, hyperRanges(), state.type);
    state.loaded = null;
    choose(state.results[0].id);
    renderSideResults();
    $('s-models').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function choose(id) {
    var d = state.data, r = state.results.filter(function (x) { return x.id === id; })[0];
    state.chosen = id;
    state.evaluation = GPR.evaluate(d.X, d.y, state.split, r.hyper, state.type);
    state.final = state.evaluation.final; state.finalInputs = d.inputs; state.finalTarget = d.target;
    state.optimum = null;
    state.byType[state.type] = { results: state.results, split: state.split, chosen: id };
    $('s-models').hidden = false; $('s-opt').hidden = false; $('s-surf').hidden = false; $('s-out').hidden = false;
    renderModels(); renderOptSetup(); renderSurfaceSetup();
  }
  // 왼쪽 메뉴 — 종류별 마지막 학습의 최고 검증 R² (두 모델을 견주어 보기 위함)
  function renderSideResults() {
    var h = '';
    ['gp', 'rbf'].forEach(function (t) {
      var b = state.byType[t]; if (!b) return;
      var c = b.results.filter(function (x) { return x.id === b.chosen; })[0];
      h += '<div><span>' + GPR.modelOf(t).short + ' 검증 R²</span><b>' + fmt(c.test.r2) + '</b></div>';
    });
    $('side-results').innerHTML = h ? '<div class="side-h" style="margin:6px 0 2px">고른 모델 성능</div>' + h : '';
  }
  // 모델 종류 바꾸기 — 그 종류로 학습한 결과가 있으면 되살리고, 없으면 학습 설정부터
  function setType(t) {
    if (t === state.type && !state.loaded) return;
    state.type = t;
    Array.prototype.forEach.call(document.querySelectorAll('input[name=mtype]'), function (r) { r.checked = r.value === t; });
    renderHyperTable(); renderHyperCount();
    if (state.loaded && state.loaded.type !== t) { state.loaded = null; state.final = null; }
    if (state.loaded) return;
    var b = state.byType[t];
    if (b && state.data && !state.data.errors.length) { state.results = b.results; state.split = b.split; choose(b.chosen); return; }
    state.results = null; state.evaluation = null; state.optimum = null; state.final = null;
    if (state.data && !state.data.errors.length) showFrom(2);
  }

  /* ---------- 모델 비교 ---------- */
  function renderModels() {
    var res = state.results, ev = state.evaluation, r = res.filter(function (x) { return x.id === state.chosen; })[0], d = state.data;
    var auto = res[0].id === state.chosen;
    var md = MD(), rbf = md.key === 'rbf';
    $('chosen').innerHTML = '<div class="pick"><div><b>' + (auto ? '자동 선정 모델' : '직접 고른 모델') + '</b> · ' + esc(md.short) + ' — ' + hyperText(r.hyper, r) +
      (auto ? ' <span class="sub">(검증 R² 최대)</span>' : ' <button class="x" id="btn-auto">자동 선정으로 되돌리기</button>') + '</div>' +
      '<div class="stats">' + stat('검증 R²', fmt(ev.test.r2)) + stat('학습 R²', fmt(ev.train.r2)) + stat('검증 RMSE', fmt(ev.test.rmse)) + stat('검증 MAE', fmt(ev.test.mae)) + (rbf ? stat('실제 중심 수', r.kEff) : stat('로그 주변우도', fmt(r.logML))) + '</div>' +
      GPR.diagnose(ev).map(function (w) { return '<div class="warn">' + esc(w) + '</div>'; }).join('') + '</div>';
    $('models-how').textContent = '검증 R² 큰 순 · 같으면 ' + (rbf ? '실제 중심 수 적은 순(더 단순한 모델)' : '로그 주변우도 큰 순') + ' · 다른 행을 눌러 고를 수 있습니다';
    $('hyper-charts').innerHTML = md.hyper.map(function (h) { return '<div>' + profileChart(GPR.hyperProfile(res, h.key), h.name, r.hyper[h.key]) + '</div>'; }).join('');
    var t = '<table><thead><tr><th>순위</th>' + md.hyper.map(function (h) { return '<th>' + esc(h.name.split(' ').pop()) + '</th>'; }).join('') +
      '<th>학습 R²</th><th>검증 R²</th><th>검증 RMSE</th><th>' + esc(md.tieName) + '</th></tr></thead><tbody>';
    res.forEach(function (x) {
      t += '<tr class="pickrow' + (x.id === state.chosen ? ' sel' : '') + '" data-id="' + x.id + '" tabindex="0"><td class="num">' + x.rank + '</td>' +
        md.hyper.map(function (h) { return '<td class="num">' + fmt(x.hyper[h.key]) + '</td>'; }).join('') +
        '<td class="num">' + fmt(x.train.r2) + '</td><td class="num"><b>' + fmt(x.test.r2) + '</b></td><td class="num">' + fmt(x.test.rmse) + '</td><td class="num">' + (rbf ? (x.kEff == null ? '—' : x.kEff) : fmt(x.logML)) + '</td></tr>';
    });
    $('models').innerHTML = t + '</tbody></table>';
    $('parity').innerHTML = parityChart(ev.rows, d.runs);
    $('resid').innerHTML = residChart(ev.rows, d.runs);
    var bnd = GPR.ranges(d.X), base = bnd.map(function (b) { return b.mean; });
    var par = GPR.pareto(state.final, d.inputs, base, bnd);
    $('pareto').innerHTML = paretoChart(par);
    $('pareto-how').innerHTML = '<b>계산 방법</b><br>고른 하이퍼파라미터로 학습+검증 데이터 전체를 다시 학습한 모델에서, 다른 인자는 데이터 평균(' +
      d.inputs.map(function (n, j) { return esc(n) + ' ' + fmt(base[j]); }).join(' · ') + ')에 고정하고 한 인자만 데이터 최소~최대를 21점으로 바꿉니다. ' +
      '그때 예측 평균이 움직인 폭(최대-최소)을 막대로, 큰 순서로 쌓은 비율을 꺾은선으로 그립니다.<br><span class="sub">인자끼리 함께 작용하는 효과(교호작용)는 이 막대에 다 담기지 않습니다.</span>';
  }
  function hyperText(h, r) {
    if (h.width != null) return '중심 수 k ' + fmt(h.k) + (r && r.kEff != null && r.kEff !== h.k ? '(실제 ' + r.kEff + ')' : '') + ' · 폭 σ ' + fmt(h.width) + ' · 규제 λ ' + fmt(h.lambda);
    return 'ℓ ' + fmt(h.ell) + ' · σf ' + fmt(h.sf) + ' · σn ' + fmt(h.sn);
  }

  /* ---------- 최적화 ---------- */
  function renderOptSetup() {
    var m = state.final, names = state.finalInputs, spec = GPR.defaultSpec(names, m.X), bnd = GPR.ranges(m.X);
    $('opt-model').innerHTML = '탐색 모델: ' + esc(GPR.modelOf(m.type).short) + ' · ' + hyperText(m.hyper, m) + ' — 고른 하이퍼파라미터로 <b>학습+검증 ' + m.y.length + ' Run 전체</b>를 다시 학습했습니다. 목표: <b>' + esc(state.finalTarget) + '</b>';
    $('spec').querySelector('tbody').innerHTML = spec.map(function (f, j) {
      return '<tr><td><b>' + esc(f.name) + '</b></td><td class="mono">' + fmt(bnd[j].min) + ' ~ ' + fmt(bnd[j].max) + '</td>' +
        '<td><input type="number" class="sp" id="g-min-' + j + '" value="' + f.min + '" step="any"></td>' +
        '<td><input type="number" class="sp" id="g-max-' + j + '" value="' + f.max + '" step="any"></td>' +
        '<td><input type="number" class="sp" id="g-step-' + j + '" value="' + f.step + '" step="any" min="0"></td><td class="num" id="g-n-' + j + '"></td></tr>';
    }).join('');
    $('target-val').value = fmt(GPR.ranges(m.y.map(function (v) { return [v]; }))[0].max);
    $('opt-result').innerHTML = ''; $('btn-fix-opt').disabled = true;
    renderGridCount();
  }
  function spec() {
    return state.finalInputs.map(function (n, j) { return { name: n, min: +$('g-min-' + j).value, max: +$('g-max-' + j).value, step: +$('g-step-' + j).value }; });
  }
  function renderGridCount() {
    var s = spec(), gc = GPR.gridCount(s);
    s.forEach(function (f, j) { var a = GPR.axisValues(f); $('g-n-' + j).textContent = a.error ? '—' : (a.values ? a.values.length : a.count); });
    var el = $('g-count');
    if (gc.errors.length) { el.innerHTML = '<span class="bad">' + gc.errors.map(esc).join(' / ') + '</span>'; $('btn-opt').disabled = true; return; }
    if (gc.tooMany) { el.innerHTML = '<span class="bad">조합 ' + gc.count.toLocaleString() + '개 — ' + gc.limit.toLocaleString() + '개를 넘습니다. 간격을 넓혀 주세요.</span>'; $('btn-opt').disabled = true; return; }
    el.textContent = '조합 ' + gc.count.toLocaleString() + '개를 계산합니다';
    $('btn-opt').disabled = false;
  }
  function optimize() {
    var goal = $('goal').value, m = state.final, names = state.finalInputs;
    var o = GPR.gridSearch(m, spec(), goal, { target: +$('target-val').value, top: 10 });
    state.optimum = o;
    if (!o.top.length) { $('opt-result').innerHTML = '<div class="warn">' + (o.errors.join(' / ') || '탐색할 조합이 없습니다') + '</div>'; return; }
    var gl = { max: '최대화', min: '최소화', target: '목표값 ' + fmt(o.target) + ' 에 가깝게' }[goal];
    var hasSd = GPR.modelOf(m.type).hasSd;
    var h = '<div class="warn"><b>예측값은 모델 추정이며 확인 실험이 필요합니다.</b> ' + (hasSd ? '표준편차가 크거나 학습 데이터 범위 밖인 조건은 특히 그렇습니다.' : '학습 데이터 범위 밖인 조건은 특히 그렇습니다. RBFNN 은 예측 표준편차(σ)를 내지 않습니다 — 불확실성은 GP 모델로 확인하세요.') + '</div>' +
      '<p class="sub">' + esc(state.finalTarget) + ' ' + gl + ' · 조합 ' + o.count.toLocaleString() + '개 중 상위 ' + o.top.length + '개</p>' +
      '<div class="tablewrap" id="opt-top"><table><thead><tr><th>순위</th>' + names.map(function (n) { return '<th>' + esc(n) + '</th>'; }).join('') +
      '<th>예측 평균 <span class="calc">모델 추정</span></th><th>예측 표준편차' + (hasSd ? '' : '(GP 전용)') + '</th><th>비고</th></tr></thead><tbody>';
    o.top.forEach(function (k) {
      h += '<tr' + (k.anyOutside ? ' class="flag"' : '') + '><td class="num">' + k.rank + '</td>' + k.x.map(function (v, j) { return '<td class="num">' + fmt(v) + (k.outside[j] ? ' <span class="out">범위 밖</span>' : '') + '</td>'; }).join('') +
        '<td class="num"><b>' + fmt(k.mean) + '</b></td><td class="num">' + (k.sd == null ? '—' : '± ' + fmt(k.sd)) + '</td><td class="wrap">' + (k.anyOutside ? '학습 데이터 범위 밖 — 외삽' : '') + '</td></tr>';
    });
    h += '</tbody></table></div>';
    var best = state.data && !state.data.errors.length && state.data.target === state.finalTarget ? bestRun() : null;
    if (best) h += '<p class="sub" style="margin-top:10px">비교: 데이터에서 가장 ' + (goal === 'min' ? '작은' : goal === 'max' ? '큰' : '목표에 가까운') + ' 실측은 Run ' + esc(best.run) + ' 의 ' + fmt(best.y) + ' 입니다.</p>';
    $('opt-result').innerHTML = h + '<p class="sub" style="margin-top:10px">1순위 조건 주변을 보려면 「5. 반응 곡면」에서 「고정값을 1순위 최적 조건으로」를 누르세요.</p>';
    $('btn-fix-opt').disabled = false;
    if (names.length === 1) renderSurfaceSetup();
  }
  function bestRun() {
    var d = state.data, b = GPR.bestObserved(d.y, $('goal').value, +$('target-val').value);
    return { run: d.runs[b.i], y: b.y };
  }

  /* ---------- 불러온 모델 ---------- */
  function showLoaded() {
    var L = state.loaded;
    state.final = L.model; state.finalInputs = L.inputs; state.finalTarget = L.target;
    $('s-models').hidden = false; $('s-opt').hidden = false; $('s-surf').hidden = false; $('s-out').hidden = false;
    var mt = L.metrics;
    $('chosen').innerHTML = '<div class="pick"><b>불러온 모델</b> · ' + esc(GPR.modelOf(L.type).short) + ' — ' + hyperText(L.model.hyper, L.model) + ' · 학습 ' + L.model.y.length + ' Run' + (L.savedAt ? ' · 저장 ' + esc(L.savedAt.slice(0, 16).replace('T', ' ')) : '') +
      (mt ? '<div class="stats">' + stat('저장 당시 검증 R²', fmt(mt.testR2)) + stat('저장 당시 학습 R²', fmt(mt.trainR2)) + '</div>' : '') +
      '<p class="sub" style="margin-top:8px">모델 비교 표와 그래프는 「모델 학습 · 비교」를 다시 누르면 나옵니다.</p></div>';
    ['hyper-charts', 'models', 'parity', 'resid', 'pareto', 'pareto-how'].forEach(function (id) { $(id).innerHTML = ''; });
    renderOptSetup(); renderSurfaceSetup();
  }
  function loadModel(text) {
    try {
      var L = GPR.fromJSON(text);
      state.loaded = null; state.byType = {}; setType(L.type);
      state.loaded = L;
      setTable(['Run'].concat(L.inputs, [L.target]), L.model.X.map(function (x, i) { return [L.runs[i] || String(i + 1)].concat(x, [L.model.y[i]]); }));
      showLoaded();
      $('s-opt').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { $('data-status').innerHTML = '<div class="warn">모델 파일을 읽지 못했습니다: ' + esc(e.message) + '</div>'; }
  }

  /* ---------- 저장 · 내보내기 ---------- */
  function download(name, blob) {
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function stamp() { var d = new Date(); return d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2); }
  function saveModel() {
    var ev = state.evaluation, d = state.data;
    var meta = state.loaded ? { inputs: state.loaded.inputs, target: state.loaded.target, runs: state.loaded.runs, metrics: state.loaded.metrics }
      : { inputs: d.inputs, target: d.target, runs: d.runs, metrics: ev ? { testR2: ev.test.r2, trainR2: ev.train.r2, testRMSE: ev.test.rmse } : null,
          split: { ratio: +$('ratio').value / 100, seed: +$('seed').value } };
    var js = GPR.toJSON(state.final, meta);
    download((state.final.type === 'rbf' ? 'RBFNN모델_' : 'GP모델_') + stamp() + '.json', new Blob([JSON.stringify(js, null, 1)], { type: 'application/json' }));
  }
  function exportXlsx() {
    var d = state.data, L = state.loaded;
    var src = d && !d.errors.length ? d : { inputs: L.inputs, target: L.target, X: L.model.X, y: L.model.y, runs: L.runs, dropped: [] };
    var sh = GPR.reportSheets({ modelType: state.final.type, inputs: src.inputs, target: src.target, X: src.X, y: src.y, runs: src.runs, dropped: src.dropped,
      split: state.results ? state.split : null, results: state.results, chosen: state.chosen, evaluation: state.evaluation, optimum: state.optimum });
    var wb = XLSX.utils.book_new();
    Object.keys(sh).forEach(function (n) { XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh[n]), n); });
    XLSX.writeFile(wb, (state.final.type === 'rbf' ? 'RBFNN' : 'GP') + '최적화_결과_' + stamp() + '.xlsx');
  }

  /* ---------- 파일 읽기 ---------- */
  // 한국어 엑셀이 저장한 CSV 는 CP949 인 경우가 많다 — UTF-8 로 안 읽히면 EUC-KR 로 다시 읽는다.
  function decode(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { try { return new TextDecoder('euc-kr').decode(buf); } catch (e2) { return new TextDecoder().decode(buf); } }
  }
  function readFile(f) {
    var rd = new FileReader();
    rd.onload = function (e) {
      try {
        state.loaded = null;
        if (/\.(xlsx|xls)$/i.test(f.name)) {
          var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          var aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true });
          aoa = aoa.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
          if (!aoa.length) throw new Error('첫 시트가 비어 있습니다');
          var head = aoa[0].map(function (h, j) { h = String(h).trim(); return h || ('열' + (j + 1)); });
          setTable(head, aoa.slice(1));
        } else {
          var p = GPR.parseCSV(decode(e.target.result));
          if (!p.header.length) throw new Error('내용이 없습니다');
          setTable(p.header, p.rows);
        }
      } catch (err) { $('data-status').innerHTML = '<div class="warn">파일을 읽지 못했습니다: ' + esc(err.message) + '</div>'; }
    };
    rd.readAsArrayBuffer(f);
  }

  /* ---------- SVG 그래프 — 외부 차트 라이브러리 없이 ---------- */
  function fmt(v) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v);
    if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
    return String(+v.toPrecision(a >= 100 ? 5 : 4));
  }
  function ticks(lo, hi, n) {
    if (!(hi > lo)) { hi = lo + 1; lo = lo - 1; }
    var raw = (hi - lo) / (n || 5), e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
    var st = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e, out = [];
    for (var k = Math.ceil(lo / st - 1e-9); k * st <= hi + st * 1e-9; k++) out.push(k === 0 ? 0 : +(k * st).toPrecision(10));
    return out;
  }
  function frame(o) {
    // o: { W, H, x0, x1, y0, y1, xl, yl, xlog }
    var L = 52, R = 14, T = 14, B = 40, W = o.W, H = o.H;
    var lx = o.xlog ? Math.log : function (v) { return v; };
    var X = function (v) { return L + (W - L - R) * (lx(v) - lx(o.x0)) / ((lx(o.x1) - lx(o.x0)) || 1); };
    var Y = function (v) { return T + (H - T - B) * (1 - (v - o.y0) / ((o.y1 - o.y0) || 1)); };
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(o.label || '') + '">';
    ticks(o.y0, o.y1, 4).forEach(function (v) { if (v < o.y0 - 1e-9 || v > o.y1 + 1e-9) return; g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + fmt(v) + '</text>'; });
    if (!o.noXTicks) (o.xticks || ticks(o.x0, o.x1, 5)).forEach(function (v) { if (v < o.x0 - 1e-9 || v > o.x1 + 1e-9) return; g += '<text class="ax" x="' + X(v) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + fmt(v) + '</text>'; });
    g += '<line class="axl" x1="' + L + '" x2="' + L + '" y1="' + T + '" y2="' + (H - B) + '"/><line class="axl" x1="' + L + '" x2="' + (W - R) + '" y1="' + (H - B) + '" y2="' + (H - B) + '"/>';
    if (o.xl) g += '<text class="axt" x="' + ((L + W - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(o.xl) + '</text>';
    if (o.yl) g += '<text class="axt" transform="translate(13 ' + ((T + H - B) / 2) + ') rotate(-90)" text-anchor="middle">' + esc(o.yl) + '</text>';
    return { g: g, X: X, Y: Y, L: L, R: R, T: T, B: B };
  }
  function span(vals, pad) {
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), p = (hi - lo) * (pad || 0.06) || 1;
    return [lo - p, hi + p];
  }
  function parityChart(rows, runs) {
    var all = rows.map(function (r) { return r.actual; }).concat(rows.map(function (r) { return r.pred; })), s = span(all);
    var f = frame({ W: 480, H: 380, x0: s[0], x1: s[1], y0: s[0], y1: s[1], xl: '실측값', yl: '예측값', label: '예측값-실측값 산점도' });
    var g = f.g + '<line class="diag" x1="' + f.X(s[0]) + '" y1="' + f.Y(s[0]) + '" x2="' + f.X(s[1]) + '" y2="' + f.Y(s[1]) + '"/>';
    rows.forEach(function (r) { g += '<circle class="pt ' + r.set + '" cx="' + f.X(r.actual) + '" cy="' + f.Y(r.pred) + '" r="4.5"><title>Run ' + esc(runs[r.i]) + ' — 실측 ' + fmt(r.actual) + ' · 예측 ' + fmt(r.pred) + '</title></circle>'; });
    return g + '</svg><div class="legend"><span class="dot train"></span>학습 <span class="dot test"></span>검증 <span class="lg l-diag">y = x(완벽한 예측)</span></div>';
  }
  function residChart(rows, runs) {
    var sx = span(rows.map(function (r) { return r.pred; })), m = Math.max.apply(null, rows.map(function (r) { return Math.abs(r.resid); })) * 1.15 || 1;
    var f = frame({ W: 480, H: 380, x0: sx[0], x1: sx[1], y0: -m, y1: m, xl: '예측값', yl: '잔차', label: '잔차 그래프' });
    var g = f.g + '<line class="zero" x1="' + f.L + '" x2="' + (480 - f.R) + '" y1="' + f.Y(0) + '" y2="' + f.Y(0) + '"/>';
    rows.forEach(function (r) { g += '<circle class="pt ' + r.set + '" cx="' + f.X(r.pred) + '" cy="' + f.Y(r.resid) + '" r="4.5"><title>Run ' + esc(runs[r.i]) + ' — 잔차 ' + fmt(r.resid) + '</title></circle>'; });
    return g + '</svg><div class="legend"><span class="dot train"></span>학습 <span class="dot test"></span>검증 · 0 주위에 고르게 흩어지면 좋습니다</div>';
  }
  function profileChart(prof, name, chosen) {
    var vals = prof.map(function (p) { return p.value; }), bs = prof.map(function (p) { return p.best; }).filter(function (v) { return v != null; });
    var y0 = Math.max(-1, Math.min(0, Math.min.apply(null, bs.concat([1])))), x0 = Math.min.apply(null, vals), x1 = Math.max.apply(null, vals);
    if (x0 === x1) { x0 = x0 / 2; x1 = x1 * 2; }
    var f = frame({ W: 360, H: 250, x0: x0 / 1.15, x1: x1 * 1.15, y0: y0, y1: 1, xlog: true, xticks: vals, xl: name + ' (로그 눈금)', yl: '검증 R²', label: name + '별 검증 R²' });
    var pts = prof.filter(function (p) { return p.best != null; }).map(function (p) { return f.X(p.value) + ',' + f.Y(Math.max(y0, p.best)); });
    var g = f.g + '<polyline class="l-prof" points="' + pts.join(' ') + '"/>';
    prof.forEach(function (p) { if (p.best == null) return; var on = Math.abs(p.value - chosen) < 1e-12; g += '<circle class="pp' + (on ? ' on' : '') + '" cx="' + f.X(p.value) + '" cy="' + f.Y(Math.max(y0, p.best)) + '" r="' + (on ? 6 : 4) + '"><title>' + esc(name) + ' ' + fmt(p.value) + ' — 최고 검증 R² ' + fmt(p.best) + '</title></circle>'; });
    return g + '</svg>';
  }
  function paretoChart(items) {
    var W = 480, H = 320, L = 52, R = 46, T = 14, B = 56;
    var max = Math.max.apply(null, items.map(function (i) { return i.effect; })) * 1.1 || 1, n = items.length, bw = (W - L - R) / n;
    var Y = function (v) { return T + (H - T - B) * (1 - v / max); }, P = function (p) { return T + (H - T - B) * (1 - p / 100); };
    var g = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="설계인자 영향도 파레토 차트">';
    ticks(0, max, 4).forEach(function (v) { if (v > max) return; g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="ax" x="' + (L - 6) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + fmt(v) + '</text>'; });
    [0, 50, 100].forEach(function (p) { g += '<text class="ax" x="' + (W - R + 6) + '" y="' + (P(p) + 4) + '">' + p + '%</text>'; });
    items.forEach(function (it, k) {
      var x = L + k * bw + bw * 0.18, w = bw * 0.64;
      g += '<rect class="bar" x="' + x + '" y="' + Y(it.effect) + '" width="' + w + '" height="' + (Y(0) - Y(it.effect)) + '" rx="3"><title>' + esc(it.name) + ' — 변화 폭 ' + fmt(it.effect) + ' (' + fmt(it.pct) + '%)</title></rect>';
      g += '<text class="axt" x="' + (x + w / 2) + '" y="' + (H - B + 18) + '" text-anchor="middle">' + esc(it.name) + '</text>';
      g += '<text class="ax" x="' + (x + w / 2) + '" y="' + (H - B + 34) + '" text-anchor="middle">' + fmt(it.effect) + ' · ' + Math.round(it.pct) + '%</text>';
    });
    g += '<polyline class="l-cum" points="' + items.map(function (it, k) { return (L + (k + 0.5) * bw) + ',' + P(it.cum); }).join(' ') + '"/>';
    items.forEach(function (it, k) { g += '<circle class="cum" cx="' + (L + (k + 0.5) * bw) + '" cy="' + P(it.cum) + '" r="3.5"/>'; });
    g += '<line class="axl" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(0) + '" y2="' + Y(0) + '"/>';
    return g + '</svg><div class="legend"><span class="sq"></span>예측 변화 폭 <span class="lg l-cum">누적 %(오른쪽 눈금)</span></div>';
  }
  function curveChart(c, name, at, bnd) {
    var lo = c.mean.map(function (m, i) { return m - (c.sd[i] || 0); }), hi = c.mean.map(function (m, i) { return m + (c.sd[i] || 0); });
    var s = span(lo.concat(hi), 0.08);
    var f = frame({ W: 360, H: 250, x0: c.x[0], x1: c.x[c.x.length - 1], y0: s[0], y1: s[1], xl: name, yl: state.finalTarget, label: name + ' 반응 곡선' });
    var band = c.x.map(function (x, i) { return f.X(x) + ',' + f.Y(hi[i]); }).concat(c.x.slice().reverse().map(function (x, k) { var i = c.x.length - 1 - k; return f.X(x) + ',' + f.Y(lo[i]); }));
    var g = f.g;
    if (bnd.min > c.x[0]) g += '<rect class="outzone" x="' + f.X(c.x[0]) + '" y="' + f.T + '" width="' + (f.X(bnd.min) - f.X(c.x[0])) + '" height="' + (250 - f.T - f.B) + '"/>';
    if (bnd.max < c.x[c.x.length - 1]) g += '<rect class="outzone" x="' + f.X(bnd.max) + '" y="' + f.T + '" width="' + (f.X(c.x[c.x.length - 1]) - f.X(bnd.max)) + '" height="' + (250 - f.T - f.B) + '"/>';
    if (c.sd[0] != null) g += '<polygon class="band" points="' + band.join(' ') + '"/>';
    g += '<polyline class="l-mean" points="' + c.x.map(function (x, i) { return f.X(x) + ',' + f.Y(c.mean[i]); }).join(' ') + '"/>';
    if (at != null) g += '<line class="opt" x1="' + f.X(at) + '" x2="' + f.X(at) + '" y1="' + f.T + '" y2="' + (250 - f.B) + '"/>';
    return g + '</svg>';
  }


  /* ---------- (v1.1) 반응 곡면 — 캔버스에 직접 그린다(외부 3D 라이브러리 없음) ---------- */
  // 계산(격자 예측 · 정사영 · 색)은 GPR.surfaceGrid · project · colormap. 여기서는 받은 값을 칠하고 마우스를 받을 뿐이다.
  var VIEW0 = { yaw: -0.65, pitch: -0.55, zoom: 1 };
  var surf = { view: Object.assign({}, VIEW0), fixed: [], ix: 0, iy: 1, grid: null, quads: [], drag: null, atOpt: false, hover: null };
  window.__surf = surf;
  function renderSurfaceSetup() {
    var m = state.final, names = state.finalInputs;
    if (!m || !names) return;
    var one = names.length < 2;
    $('surf-ui').hidden = one; $('surf-one').hidden = !one;
    $('surf-how').hidden = one;
    if (one) {
      var bnd1 = GPR.ranges(m.X)[0], at = state.optimum && state.optimum.top.length ? state.optimum.top[0].x[0] : null;
      $('curves').innerHTML = '<div>' + curveChart(GPR.response(m, [bnd1.mean], 0, bnd1.min, bnd1.max, 41), names[0], at, bnd1) + '</div>';
      return;
    }
    var bnd = GPR.ranges(m.X);
    surf.fixed = bnd.map(function (b) { return +b.mean.toPrecision(6); });
    surf.ix = 0; surf.iy = 1; surf.atOpt = false;
    // 영향도가 큰 두 인자를 처음 축으로 (영향도는 엔진 계산)
    var par = GPR.pareto(m, names, surf.fixed, bnd);
    if (par.length >= 2) { surf.ix = Math.min(par[0].j, par[1].j); surf.iy = Math.max(par[0].j, par[1].j); }
    var opts = function (sel) { return names.map(function (n, j) { return '<option value="' + j + '"' + (j === sel ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join(''); };
    $('sx').innerHTML = opts(surf.ix); $('sy').innerHTML = opts(surf.iy);
    renderFixed(); computeSurface();
  }
  function renderFixed() {
    var names = state.finalInputs, bnd = GPR.ranges(state.final.X);
    $('surf-fixed').innerHTML = names.map(function (n, j) {
      if (j === surf.ix || j === surf.iy) return '';
      var b = bnd[j], st = (b.max - b.min) / 100 || 1;
      return '<div class="fx"><div class="fx-h"><b>' + esc(n) + '</b><span>고정 · 데이터 ' + fmt(b.min) + ' ~ ' + fmt(b.max) + '</span></div>' +
        '<div class="fx-in"><input type="range" data-fx="' + j + '" min="' + b.min + '" max="' + b.max + '" step="' + st + '" value="' + surf.fixed[j] + '" aria-label="' + esc(n) + ' 고정값 막대">' +
        '<input type="number" data-fxn="' + j + '" step="any" value="' + surf.fixed[j] + '" aria-label="' + esc(n) + ' 고정값"></div></div>';
    }).join('');
  }
  function computeSurface() {
    var m = state.final, bnd = GPR.ranges(m.X);
    surf.grid = GPR.surfaceGrid(m, surf.fixed, surf.ix, surf.iy, bnd[surf.ix], bnd[surf.iy], +$('sn').value || 25);
    surf.hover = null;
    drawSurface(); readout();
  }
  function drawSurface() {
    var cv = $('surf-canvas'), G = surf.grid;
    if (!G || $('s-surf').hidden) return;
    var dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 800, H = cv.clientHeight || 480;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    var FONT = '"Pretendard","Apple SD Gothic Neo","Malgun Gothic",sans-serif', names = state.finalInputs, v = surf.view;
    // 곡면이 돌아가도 캔버스 안에 들도록: 가로는 대각선(√2·2), 세로는 바닥~꼭대기와 대각선 기울기를 넉넉히 2.9 로 잡는다
    var narrow = W < 560, sc = Math.min((W - (narrow ? 30 : 150)) / 2.9, (H - (narrow ? 100 : 80)) / 2.9) * v.zoom;
    var ox = narrow ? W * 0.5 : (W - 60) * 0.5, oy = narrow ? H * 0.5 + 34 : H * 0.5 + 18;
    var x0 = G.xs[0], x1 = G.xs[G.xs.length - 1], y0 = G.ys[0], y1 = G.ys[G.ys.length - 1], z0 = G.zmin, z1 = G.zmax;
    if (!(z1 > z0)) { z0 -= 1; z1 += 1; }
    var nx = function (a) { return ((a - x0) / ((x1 - x0) || 1)) * 2 - 1; }, ny = function (a) { return ((a - y0) / ((y1 - y0) || 1)) * 2 - 1; };
    var nz = function (a) { return (((a - z0) / (z1 - z0)) * 2 - 1) * 0.75; }, cz = function (a) { return (a - z0) / (z1 - z0); };
    var P = function (a, b, c) { var q = GPR.project([a, b, c], v); return { x: ox + q.x * sc, y: oy - q.y * sc, d: q.depth }; };
    var line = function (a, b) { g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); };
    // 바닥 격자 · 축
    g.strokeStyle = '#e1e7ed'; g.lineWidth = 1;
    for (var k = -1; k <= 1.0001; k += 0.5) { line(P(k, -1, -0.75), P(k, 1, -0.75)); line(P(-1, k, -0.75), P(1, k, -0.75)); }
    g.strokeStyle = '#5b6b7b'; line(P(-1, -1, -0.75), P(1, -1, -0.75)); line(P(-1, -1, -0.75), P(-1, 1, -0.75)); line(P(-1, -1, -0.75), P(-1, -1, 0.75));
    g.fillStyle = '#5b6b7b'; g.font = '11px ' + FONT;
    ticks(x0, x1, 4).forEach(function (a) { if (a < x0 - 1e-9 || a > x1 + 1e-9) return; var q = P(nx(a), -1.12, -0.75); g.fillText(fmt(a), q.x - 10, q.y + 12); });
    ticks(y0, y1, 4).forEach(function (a) { if (a < y0 - 1e-9 || a > y1 + 1e-9) return; var q = P(1.1, ny(a), -0.75); g.fillText(fmt(a), q.x + 4, q.y + 4); });
    ticks(z0, z1, 4).forEach(function (a) { if (a < z0 - 1e-9 || a > z1 + 1e-9) return; var q = P(-1, -1, nz(a)); g.textAlign = 'right'; g.fillText(fmt(a), q.x - 6, q.y + 4); g.textAlign = 'left'; });
    g.fillStyle = '#152232'; g.font = 'bold 12px ' + FONT;
    var lx = P(0, -1.34, -0.75), ly = P(1.34, 0, -0.75), lz = P(-1, -1, 0.95);
    var label = function (t, x, y) { var w = g.measureText(t).width; g.fillText(t, Math.max(4, Math.min(W - w - 4, x)), Math.max(48, Math.min(H - 6, y))); };
    label('X ' + names[surf.ix], lx.x - 30, lx.y + 16); label('Y ' + names[surf.iy], ly.x + 6, ly.y + 14); label('Z ' + state.finalTarget, lz.x - 20, lz.y);
    // 곡면 — 먼 칸부터 칠한다(화가 알고리즘)
    var items = [];
    for (var j = 0; j < G.ys.length - 1; j++) for (var i = 0; i < G.xs.length - 1; i++) {
      var z4 = [G.mean[j][i], G.mean[j][i + 1], G.mean[j + 1][i + 1], G.mean[j + 1][i]];
      var q4 = [P(nx(G.xs[i]), ny(G.ys[j]), nz(z4[0])), P(nx(G.xs[i + 1]), ny(G.ys[j]), nz(z4[1])), P(nx(G.xs[i + 1]), ny(G.ys[j + 1]), nz(z4[2])), P(nx(G.xs[i]), ny(G.ys[j + 1]), nz(z4[3]))];
      items.push({ i: i, j: j, q: q4, d: (q4[0].d + q4[1].d + q4[2].d + q4[3].d) / 4, c: GPR.colormap(cz((z4[0] + z4[1] + z4[2] + z4[3]) / 4)) });
    }
    items.sort(function (a, b) { return b.d - a.d; });
    var hv = surf.hover;
    items.forEach(function (it) {
      g.beginPath(); g.moveTo(it.q[0].x, it.q[0].y); for (var r = 1; r < 4; r++) g.lineTo(it.q[r].x, it.q[r].y); g.closePath();
      g.fillStyle = 'rgb(' + it.c.join(',') + ')'; g.fill();
      var on = hv && hv.i === it.i && hv.j === it.j;
      g.strokeStyle = on ? '#c8341f' : 'rgba(21,34,50,.16)'; g.lineWidth = on ? 2 : 0.6; g.stroke();
    });
    surf.quads = items;
    // 1순위 최적 조건(고정값이 그 조건일 때만)
    var o = state.optimum && state.optimum.top.length ? state.optimum.top[0] : null;
    if (o && surf.atOpt) {
      var pp = P(nx(o.x[surf.ix]), ny(o.x[surf.iy]), nz(o.mean)), base = P(nx(o.x[surf.ix]), ny(o.x[surf.iy]), -0.75);
      g.strokeStyle = '#c8341f'; g.setLineDash([4, 3]); g.lineWidth = 1.3; line(base, pp); g.setLineDash([]);
      g.beginPath(); g.arc(pp.x, pp.y, 6, 0, 2 * Math.PI); g.fillStyle = '#c8341f'; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
    }
    // 색 막대
    g.fillStyle = '#152232'; g.font = '11px ' + FONT;
    if (narrow) {   // 좁은 화면은 가로 막대(제목 아래)
      var bw = Math.min(160, W * 0.5), bx = W - bw - 12, by = 46;
      for (var t = 0; t < 100; t++) { g.fillStyle = 'rgb(' + GPR.colormap(t / 99).join(',') + ')'; g.fillRect(bx + bw * t / 100, by, bw / 100 + 1, 10); }
      g.strokeStyle = '#5b6b7b'; g.lineWidth = 1; g.strokeRect(bx, by, bw, 10);
      g.fillStyle = '#152232'; g.fillText(fmt(z0), bx, by + 23); g.textAlign = 'right'; g.fillText(fmt(z1), bx + bw, by + 23); g.textAlign = 'left';
    } else {
      var vx = W - 46, vy = H * 0.24, vh = H * 0.52;
      for (var t2 = 0; t2 < 100; t2++) { g.fillStyle = 'rgb(' + GPR.colormap(1 - t2 / 99).join(',') + ')'; g.fillRect(vx, vy + vh * t2 / 100, 14, vh / 100 + 1); }
      g.strokeStyle = '#5b6b7b'; g.lineWidth = 1; g.strokeRect(vx, vy, 14, vh);
      g.fillStyle = '#152232'; g.textAlign = 'right'; g.fillText(fmt(z1), vx - 4, vy + 9); g.fillText(fmt(z0), vx - 4, vy + vh); g.textAlign = 'left';
    }
    g.font = 'bold 13px ' + FONT; g.fillText('반응 곡면 — ' + state.finalTarget + ' 예측 평균 · ' + GPR.modelOf(state.final.type).short, 14, 20);
    g.font = '11px ' + FONT; g.fillStyle = '#5b6b7b';
    var fx = state.finalInputs.map(function (n, q) { return q === surf.ix || q === surf.iy ? null : n + ' ' + fmt(surf.fixed[q]); }).filter(Boolean);
    g.fillText((fx.length ? '고정: ' + fx.join(' · ') : '') + (o && surf.atOpt ? (fx.length ? ' · ' : '') + '빨간 점 = 1순위 최적 조건' : ''), 14, 36);
  }
  function readout() {
    var G = surf.grid, h = surf.hover, names = state.finalInputs, el = $('surf-read');
    if (!G) { el.textContent = ''; return; }
    if (!h) {
      el.innerHTML = '곡면 위에 마우스를 올리면 그 점의 값이 나옵니다. 예측 범위 ' + fmt(G.zmin) + ' ~ ' + fmt(G.zmax) + '.' +
        (G.hasSd ? '' : ' <span class="sd-na">RBFNN 은 예측 표준편차(σ)를 내지 않습니다 — σ 는 GP 모델에서만 나옵니다.</span>');
      return;
    }
    var i = h.i, j = h.j;
    el.innerHTML = esc(names[surf.ix]) + ' <b>' + fmt(G.xs[i]) + '</b> · ' + esc(names[surf.iy]) + ' <b>' + fmt(G.ys[j]) + '</b> → ' + esc(state.finalTarget) + ' 예측 <b>' + fmt(G.mean[j][i]) + '</b>' +
      (G.hasSd ? ' ± ' + fmt(G.sd[j][i]) + ' (1σ)' : ' <span class="sd-na">(σ 는 GP 모델 전용 — RBFNN 은 없음)</span>') + ' <span class="sub">· 모델 추정</span>';
  }
  function hoverAt(e) {
    var cv = $('surf-canvas'), rc = cv.getBoundingClientRect(), px = e.clientX - rc.left, py = e.clientY - rc.top, hit = null;
    for (var k = surf.quads.length - 1; k >= 0; k--) { if (GPR.pointInPoly(px, py, surf.quads[k].q)) { hit = surf.quads[k]; break; } }   // 가까운 칸부터
    var nh = hit ? { i: hit.i, j: hit.j } : null;
    if (JSON.stringify(nh) !== JSON.stringify(surf.hover)) { surf.hover = nh; drawSurface(); readout(); }
  }
  function setFixed(j, val, from) {
    if (!isFinite(val)) return;
    surf.fixed[j] = val; surf.atOpt = false;
    var r = document.querySelector('[data-fx="' + j + '"]'), n = document.querySelector('[data-fxn="' + j + '"]');
    if (from !== 'range' && r) r.value = val;
    if (from !== 'num' && n) n.value = +val.toPrecision(6);
    computeSurface();
  }

  /* ---------- 이벤트 ---------- */
  renderHyperTable();
  // 예제는 기본 설정으로 학습까지 바로 돌려 결과부터 보여 준다
  $('btn-sample').onclick = function () { state.loaded = null; var rows = GPR.sample(); setTable(Object.keys(rows[0]), rows); train(); };
  $('btn-template').onclick = function () {
    download('GPR_데이터_양식.csv', new Blob(['﻿Run,인자1,인자2,인자3,결과값\nR01,,,,\nR02,,,,\n'], { type: 'text/csv;charset=utf-8' }));
  };
  $('btn-addrow').onclick = function () {
    if (!state.cols.length) state.cols = ['Run', '인자1', '인자2', '결과값'], state.roles = { runCol: 'Run', target: '결과값', inputs: ['인자1', '인자2'] };
    state.rows.push(state.cols.map(function (c, j) { return j === 0 && state.roles.runCol === c ? 'R' + (state.rows.length + 1) : ''; }));
    renderGrid(); renderRoles(); refreshData();
  };
  $('btn-addcol').onclick = function () {
    var n = 1; while (state.cols.indexOf('인자' + n) >= 0) n++;
    var at = state.roles && state.roles.target ? state.cols.indexOf(state.roles.target) : state.cols.length;
    if (at < 0) at = state.cols.length;
    state.cols.splice(at, 0, '인자' + n); state.rows.forEach(function (r) { r.splice(at, 0, ''); });
    if (!state.roles) state.roles = { runCol: null, target: null, inputs: [] };
    state.roles.inputs.push('인자' + n);
    renderGrid(); renderRoles(); refreshData();
  };
  $('btn-clear').onclick = function () { state.loaded = null; state.cols = []; state.rows = []; state.roles = null; renderGrid(); renderRoles(); refreshData(); };
  $('grid').addEventListener('input', function (e) {
    var t = e.target; if (t.tagName !== 'INPUT') return;
    if (t.classList.contains('hc')) {
      var j = +t.dataset.j, old = state.cols[j], nu = t.value.trim() || ('열' + (j + 1));
      if (state.cols.indexOf(nu) >= 0 && nu !== old) return;    // 같은 이름 두 개는 받지 않는다
      state.cols[j] = nu;
      var r = state.roles;
      if (r.runCol === old) r.runCol = nu; if (r.target === old) r.target = nu;
      r.inputs = r.inputs.map(function (x) { return x === old ? nu : x; });
      renderRoles();
    } else state.rows[+t.dataset.i][+t.dataset.j] = t.value;
    later();
  });
  $('grid').addEventListener('paste', function (e) {   // 엑셀에서 여러 칸을 복사해 붙여넣기
    var t = e.target; if (t.tagName !== 'INPUT' || t.classList.contains('hc')) return;
    var txt = (e.clipboardData || window.clipboardData).getData('text');
    if (!/[\t\n]/.test(txt)) return;
    e.preventDefault();
    var lines = txt.replace(/\r/g, '').replace(/\n$/, '').split('\n'), i0 = +t.dataset.i, j0 = +t.dataset.j;
    lines.forEach(function (ln, a) {
      if (!state.rows[i0 + a]) state.rows.push(state.cols.map(function () { return ''; }));
      ln.split('\t').forEach(function (v, b) { if (j0 + b < state.cols.length) state.rows[i0 + a][j0 + b] = v.trim(); });
    });
    renderGrid(); refreshData();
  });
  $('roles').addEventListener('change', function (e) {
    var r = state.roles, id = e.target.id;
    if (id === 'r-run') { r.runCol = e.target.value || null; r.inputs = r.inputs.filter(function (x) { return x !== r.runCol; }); }
    else if (id === 'r-target') { r.target = e.target.value || null; r.inputs = r.inputs.filter(function (x) { return x !== r.target; }); }
    else if (e.target.classList.contains('r-in')) r.inputs = Array.prototype.map.call(document.querySelectorAll('.r-in:checked'), function (x) { return x.value; });
    state.loaded = null;
    renderRoles(); refreshData();
  });
  var drop = $('drop');
  $('file').onchange = function (e) { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach(function (k) { drop.addEventListener(k, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (k) { drop.addEventListener(k, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) { if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
  $('model-file').onchange = function (e) {
    var f = e.target.files[0]; if (!f) return;
    var rd = new FileReader(); rd.onload = function () { loadModel(rd.result); }; rd.readAsText(f); e.target.value = '';
  };
  ['ratio', 'seed'].forEach(function (id) { $(id).addEventListener('input', renderSplitInfo); });
  $('hyper-tbl').addEventListener('input', renderHyperCount);
  $('btn-train').onclick = train;
  $('models').addEventListener('click', function (e) { var tr = e.target.closest('tr.pickrow'); if (tr) choose(+tr.dataset.id); });
  $('models').addEventListener('keydown', function (e) { var tr = e.target.closest('tr.pickrow'); if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choose(+tr.dataset.id); } });
  $('chosen').addEventListener('click', function (e) { if (e.target.id === 'btn-auto') choose(state.results[0].id); });
  $('spec').addEventListener('input', renderGridCount);
  $('goal').onchange = function () { $('f-target').hidden = $('goal').value !== 'target'; };
  $('btn-opt').onclick = optimize;
  $('btn-save').onclick = saveModel;
  $('btn-export').onclick = exportXlsx;
  Array.prototype.forEach.call(document.querySelectorAll('input[name=mtype]'), function (r) { r.addEventListener('change', function () { if (r.checked) setType(r.value); }); });
  ['sx', 'sy'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      var a = +$('sx').value, b = +$('sy').value;
      if (a === b) { if (id === 'sx') { b = surf.ix; $('sy').value = b; } else { a = surf.iy; $('sx').value = a; } }   // 같은 인자를 고르면 둘을 맞바꾼다
      surf.ix = a; surf.iy = b; renderFixed(); computeSurface();
    });
  });
  $('sn').addEventListener('change', computeSurface);
  $('surf-fixed').addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset.fx != null) setFixed(+t.dataset.fx, +t.value, 'range');
    else if (t.dataset.fxn != null && t.value !== '') setFixed(+t.dataset.fxn, +t.value, 'num');
  });
  $('btn-fix-mean').onclick = function () { GPR.ranges(state.final.X).forEach(function (b, j) { surf.fixed[j] = +b.mean.toPrecision(6); }); surf.atOpt = false; renderFixed(); computeSurface(); };
  $('btn-fix-opt').onclick = function () {
    var o = state.optimum && state.optimum.top[0]; if (!o) return;
    surf.fixed = o.x.slice(); renderFixed(); computeSurface(); surf.atOpt = true; drawSurface();
  };
  $('btn-view-reset').onclick = function () { surf.view = Object.assign({}, VIEW0); drawSurface(); };
  $('btn-view-top').onclick = function () { surf.view.yaw = 0; surf.view.pitch = -Math.PI / 2 + 0.001; drawSurface(); };
  $('btn-zoom-in').onclick = function () { surf.view.zoom = Math.min(3, surf.view.zoom * 1.2); drawSurface(); };
  $('btn-zoom-out').onclick = function () { surf.view.zoom = Math.max(0.4, surf.view.zoom / 1.2); drawSurface(); };
  $('btn-surf-png').onclick = function () { $('surf-canvas').toBlob(function (b) { if (b) download('반응곡면_' + stamp() + '.png', b); }); };
  var cvs = $('surf-canvas');
  cvs.addEventListener('pointerdown', function (e) { surf.drag = { x: e.clientX, y: e.clientY, yaw: surf.view.yaw, pitch: surf.view.pitch, moved: false }; cvs.setPointerCapture(e.pointerId); });
  cvs.addEventListener('pointermove', function (e) {
    if (!surf.drag) { hoverAt(e); return; }
    var dx = e.clientX - surf.drag.x, dy = e.clientY - surf.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) surf.drag.moved = true;
    surf.view.yaw = surf.drag.yaw + dx * 0.01;
    surf.view.pitch = Math.max(-1.56, Math.min(0.2, surf.drag.pitch + dy * 0.01));
    drawSurface();
  });
  ['pointerup', 'pointercancel'].forEach(function (t) { cvs.addEventListener(t, function (e) { var tap = surf.drag && !surf.drag.moved; surf.drag = null; if (tap) hoverAt(e); }); });
  cvs.addEventListener('pointerleave', function () { if (!surf.drag && surf.hover) { surf.hover = null; drawSurface(); readout(); } });
  var rz = null;
  window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(drawSurface, 120); });
  renderGrid();
})();
