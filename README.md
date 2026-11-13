# build-2611-13 · 머신러닝 기반 최적화 툴

생성형 AI 업무자동화 전문가과정 **2차수** 수강생 프로젝트 13 — 기획 원광재.

**바로 쓰기: https://build-2611-13.jobability.co.kr/**

실험·해석 데이터(행=Run, 열=설계인자·결과값)를 넣으면 왼쪽 메뉴에서 고른 모델 — GP(가우시안 프로세스 회귀)
또는 RBFNN(방사 기저 함수 신경망) — 을 하이퍼파라미터 3종 조합마다 만들어 검증 R² 로 비교·선정하고,
고른 모델로 Grid Search 를 돌려 최적 설계조건을 찾고, 두 인자를 골라 3D 반응 곡면을 돌려 봅니다.
모델 JSON 맨 앞 `_사용법` 칸에 입력 이름·순서·단위와 JavaScript·Python 예측 코드를 적어 둡니다.
파일은 브라우저 안에서만 처리하며 서버로 올라가지 않습니다.

| 파일 | 역할 |
|---|---|
| `js/gpr.js` | 계산 엔진(읽기·표준화·GP·RBFNN·지표·하이퍼파라미터 탐색·영향도·Grid Search·반응 곡면·정사영·저장과 사용법) — 계산은 전부 여기 |
| `js/app.js` | 화면(왼쪽 메뉴·편집 표·SVG 그래프·캔버스 반응 곡면·엑셀/JSON 내려받기) |
| `test/logic.test.js` | 계산 규칙 테스트 `node test/logic.test.js` |
| `test/smoke.browser.js` | 화면 연기 테스트(playwright) |
| `CLAUDE.md` | 작업 지시서 + 기획서 원문 |

예제 데이터는 실제 사내 데이터가 아닙니다(알려진 함수 + 잡음으로 만든 가짜 실험 30 Run).

## 기획서 · 버전

- 사이트 「기획서」 페이지: https://build-2611-13.jobability.co.kr/plan.html — 워드 판 내려받기
- 워드 판: `docs/기획서/build-2611-13_원광재_머신러닝기반최적화툴_기획서_v<버전>.docx` (버전마다 남김)
- 원본: `docs/plan.json` → 생성기 `build-2611-00/tools/plandoc/make_plan.py` 로 워드·그림·plan.html·CHANGELOG.md 를 다시 만든다
- 버전을 올릴 때: `plan.json` 의 `version` 을 바꾸고 `versions` 맨 앞에 바뀐 점을 적은 뒤 생성기를 다시 돌린다
- 사이트 주소는 `plan.json` 의 `url` 칸(생성기가 이 값을 쓴다 — 없으면 옛 github.io 기본값)
