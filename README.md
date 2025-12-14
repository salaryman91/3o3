# 3o3 E2E Test & CI + Slack Notifications

삼쩜삼(3o3) 로그인 플로우를 Playwright로 자동화하고,  
GitHub Actions + Slack + GitHub Pages까지 연동한 과제용 레포지토리입니다.

- `/login` 페이지 헬스체크
- Kakao OAuth 로그인 진입 및 URL 검증
- 공개/헬스체크용 API + 인증 필요 API의 보안 스모크 테스트
- GitHub Actions에서 정기/이벤트 실행
- Slack 채널로 결과 요약 + 실패 스크린샷 링크 전송
- Playwright HTML 리포트를 GitHub Pages에 호스팅

> 이 프로젝트는 **`.env` 파일을 사용하지 않습니다.**  
> 테스트 대상 URL과 Slack 설정은 코드(`env.ts`)와 GitHub Actions **Secrets**로만 제어합니다.

---

## 1. 빠른 시작

### 1-1. 요구 사항

- Node.js 20+
- npm
- Git

### 1-2. 로컬 실행

```bash
# 1) 레포 클론
git clone https://github.com/salaryman91/3o3.git
cd 3o3

# 2) 의존성 설치
npm install        # 또는 npm ci

# 3) Playwright 브라우저 설치
npx playwright install

# 4) 테스트 실행
npx playwright test

# 5) HTML 리포트 확인
npx playwright show-report
````

테스트가 성공하면 콘솔에 `N passed`가 표시되고,
`playwright-report/` 폴더에서 HTML 리포트를 확인할 수 있습니다.

---

## 2. 프로젝트 구조

```bash
3o3/
├─ .github/
│  └─ workflows/
│     └─ playwright-ci.yml       # GitHub Actions 워크플로우
│
├─ src/
│  ├─ config/
│  │  └─ env.ts                  # BASE_URL, LOGIN_PATH 등 환경값 래퍼
│  ├─ pages/
│  │  └─ LoginPage.ts            # /login 페이지 Page Object
│  └─ utils/
│     ├─ locators.ts             # Kakao/환급 CTA 공통 locator
│     └─ kakao-url.ts            # Kakao OAuth URL 검증 유틸
│
├─ tests/
│  ├─ health_chech.spec.ts       # /login 헬스체크 (타이틀/CTA/JS 에러)
│  ├─ login.click.spec.ts        # Kakao OAuth 진입 + URL 파라미터 검증
│  └─ api/
│     └─ szs-api.spec.ts         # 공개/헬스체크 API + 보안 스모크 테스트
│
├─ scripts/
│  └─ ci/
│     ├─ collect-playwright-summary.mjs   # results.json → 메타 요약
│     ├─ map-failed-screenshots.mjs      # 실패 테스트 ↔ 스크린샷 매핑
│     └─ notify-slack.mjs                # Slack 메시지 전송
│
├─ playwright.config.ts
├─ package.json
└─ README.md
```

---

## 3. 테스트 시나리오

### 3-1. `/login` 헬스체크 – `tests/health_chech.spec.ts`

**검증 항목**

1. **타이틀**

   * 페이지 타이틀에 `삼쩜삼` 또는 `3o3` 문자열 포함 여부 확인

2. **환급 CTA 또는 Kakao 로그인 엔트리**

   * 다양한 UI 버전을 흡수하기 위해 다음 locator를 `.or()`로 묶어 검사

     * Kakao 관련 버튼 텍스트 (`카카오`, `카카오톡`, `카톡`)
     * `[data-provider="kakao"]`
     * Kakao OAuth 링크 (`kauth.kakao.com`, `accounts.kakao.com`)
     * Kakao 로고 이미지가 포함된 버튼/링크
   * **DOM 상 최소 1개 존재**하고, 그 중 첫 번째 요소가 **실제로 화면에 보이는지** 확인

3. **JS 런타임 에러**

   * `page.on('pageerror', ...)`로 진입 중 발생한 에러를 수집
   * 배열이 비어 있지 않으면 테스트 실패

4. **“예상 환급액 계산 기준” 모달 처리**

   * `/login` 상단에 간헐적으로 뜨는 모달(`예상 환급액 계산 기준`)이
     Kakao 버튼을 가리는 문제를 방지하기 위해,
   * `LoginPage.closeExpectedRefundInfoIfOpen()`으로 모달을 최대 5초 동안 감시/닫은 뒤 헬스체크를 진행

---

### 3-2. Kakao OAuth 플로우 – `tests/login.click.spec.ts`

**목적**

* 로그인 페이지에서 Kakao 로그인 엔트리를 클릭했을 때

  * 팝업/새 탭/동일 탭 여부와 관계 없이
  * **Kakao OAuth 로그인 페이지**에 도달하는지
  * OAuth URL이 필수 파라미터를 포함하는지 검증

**핵심 흐름**

1. `/login` 진입 → 모달(`예상 환급액 계산 기준`)이 있으면 먼저 닫기
   (`LoginPage.closeExpectedRefundInfoIfOpen()` 사용)
2. Kakao 엔트리 후보 + 환급 CTA 후보를 찾고

   * Kakao 엔트리가 있으면 우선 클릭
   * 없으면 환급 CTA 중 **가장 큰 버튼**을 클릭
3. 클릭 후:

   * `page.waitForEvent('popup')` (새 탭/팝업)
   * `page.waitForURL(...)` (동일 탭)
     두 경로를 모두 고려하여 **Kakao 로그인 URL 도달 + `load` 이벤트까지** 대기
4. 도달한 URL이 Kakao 로그인 도메인인지 검사
5. `URLSearchParams`로 파라미터 검증

   * `client_id`, `redirect_uri`, `response_type`, `state` 등 필수 파라미터 존재 여부 확인

---

### 3-3. API 테스트 – `tests/api/api.spec.ts`

UI(E2E) 테스트 외에, 삼쩜삼 서비스의 **공개/헬스체크용 API + 인증이 필요한 API의 보안 스모크 테스트**를 한 파일에서 수행합니다.

> 이 API 테스트는 **인증 토큰이 없는 상태**를 전제로 하며,
> 실제 유저 정보나 로그인 상태를 검증하지 않습니다.
> (과제 범위 내에서 “토큰 없이 어떤 응답을 주는지 / 계약이 깨지지는 않는지”에 초점을 둡니다.)

#### (1) 공개/헬스체크 API – `GET https://app.3o3.co.kr/config.json`

테스트 파일: `tests/api/szs-api.spec.ts` 상단
`삼쩜삼 공개/헬스체크 API` 블록

검증 내용:

1. **기본 응답 구조 및 타입**

   * `res.ok()` 가 `true` (상태 코드 200 계열)
   * 응답 JSON 최상위에 `ok`, `data` 필드 존재
   * `ok` 는 `boolean`, `data` 는 `object`
   * `data.notifications` 가 존재하면 `Array` 인지 확인
   * `data.hasClosedSite` 가 존재하면 `boolean` 인지 확인
   * `data.maintenanceInfo.gov24MaintenanceTime` 이 존재할 경우

     * `startedAt`, `endedAt` 가 각각 `string` 인지 확인
       → **프론트 설정/배너/점검 정보** 등을 담는 `config.json`의 **스키마가 깨지지 않는지**를 체크합니다.

2. **응답 시간 SLA**

   * `GET /config.json` 호출에 대해

     * 응답 시간을 직접 측정하여 `1000ms` 이내인지 검증
       (네트워크/환경에 따라 조정 가능한 기본 SLA 예시)

3. **운영 상태 플래그(`hasClosedSite`)**

   * `data.hasClosedSite` 가 `boolean` 인지 확인
   * 과제 시점 기준으로 서비스는 운영 중이라 가정하고 **`false`를 기대값으로 검증**
     → 추후 실제 운영에서는 이 값을 기반으로
     “사이트 강제 종료/폐쇄” 여부를 모니터링할 수 있는 플래그로 활용 가능합니다.

4. **핵심 키 계약(Contract) 검증**

   * `data` 객체의 키 목록을 읽어, 다음 필수 키들이 모두 존재하는지 확인:

     * `notifications`
     * `hasClosedSite`
     * `scrappingAsync`
     * `scrapingAsync`
       → 설정 변경/배포가 반복되더라도,
       **기본 계약(Contract)으로 잡고 싶은 키들이 빠지지 않았는지**를 체크합니다.

#### (2) 인증 필요한 API의 보안 스모크 – `https://web-gw.3o3.co.kr/szs/api/v2/users/personal-info`

테스트 파일: `tests/api/szs-api.spec.ts` 하단
`삼쩜삼 인증 필요한 API의 보안 스모크` 블록

검증 내용:

1. **인증 없이 접근 시 거절**

   * `GET /szs/api/v2/users/personal-info` 를 **토큰 없이** 호출
   * `X-Web-Path: https://app.3o3.co.kr/login` 헤더로 “웹 진입 경로”만 알려줌
   * 응답 status 가 `401`(Unauthorized) 또는 `403`(Forbidden) 중 하나인지 검증
     → 민감한 유저 정보를 제공하는 API가 **무인증 요청을 허용하지 않는지** 확인합니다.

2. **형식만 맞는 가짜 토큰도 거절**

   * 동일 엔드포인트에
     `Authorization: Bearer invalid-token-for-test-only` 헤더를 추가
   * status 가 `401/403` 인지 검증
     → 형식만 맞는 가짜 토큰에 대해 **500 등 서버 에러를 내지 않고**,
     올바르게 인증 실패로 처리하는지 확인합니다.

3. **잘못된 HTTP 메서드 거절**

   * `POST /szs/api/v2/users/personal-info` 에 의미 없는 `data: {}` 를 보내고
   * 응답 status 가 `404`, `405`, `401`, `403` 중 하나인지 검증
     (중요한 것은 **500과 같은 서버 에러가 아닌 것**)
     → 이 엔드포인트가 **지원하지 않는 메서드**에 대해
     적절한 상태 코드로 거절하는지, 최소한 서버 오류로 무너지지 않는지를 확인합니다.

#### (3) 설계 의도 요약

* **토큰 없는 상태**를 기반으로:

  * 공개 설정 엔드포인트(`/config.json`)는

    * 계약(Contract) / 스키마 / 응답 시간 관점에서 헬스체크
  * 민감 정보 엔드포인트(`/users/personal-info`)는

    * “**제대로 막혀 있는지**” / “잘못된 요청에 500이 아니라 적절한 에러 코드를 주는지” 위주로 스모크 테스트
* Postman 컬렉션에서 제공된 전체 API 중,

  * **과제에서 의미 있는 범위**이자
  * 실제 유저 데이터에 영향을 주지 않는(read-only / 보안 스모크) 라인만 선별해서 자동화했습니다.

이를 통해, 이 레포는 UI(E2E) 뿐만 아니라

* 프론트 설정/점검 정보(`config.json`),
* 인증이 필요한 백엔드 엔드포인트의 거절 동작(401/403/405/404)

까지 같이 감시할 수 있는 **간단한 API 헬스 + 보안 스모크 레이어**를 제공합니다.

---

## 4. 환경값 설정 (BASE_URL 등)

테스트 대상 URL은 `src/config/env.ts`에서 관리합니다.

```ts
// src/config/env.ts (요약)

const BASE_URL = process.env.BASE_URL ?? 'https://app.3o3.co.kr';
const LOGIN_PATH = process.env.LOGIN_PATH ?? '/login';

export function getBaseUrl(): string {
  return BASE_URL.replace(/\/$/, '');
}

export function getLoginUrl(): string {
  return `${getBaseUrl()}${LOGIN_PATH}`;
}
```

* **로컬 실행**: 별도의 `.env` 없이 기본값(`https://app.3o3.co.kr/login`)으로 동작합니다.
* **CI (GitHub Actions)**: 필요 시 `playwright-ci.yml`에서 `env`로 오버라이드할 수 있습니다.

```yaml
# .github/workflows/playwright-ci.yml (발췌)
env:
  NODE_ENV: test
  CI: true
  # 필요 시 서비스 URL을 오버라이드할 수 있습니다.
  # BASE_URL: https://app.3o3.co.kr
  # LOGIN_PATH: /login
```

---

## 5. GitHub Actions CI 설정

워크플로우 파일:
`.github/workflows/playwright-ci.yml`

### 5-1. 트리거

```yaml
on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]
  schedule:
    - cron: "0 * * * *"   # 매 정각(UTC 기준) 1시간 간격 실행
  workflow_dispatch:        # 수동 실행
```

* `push` / `pull_request` → 코드 변경 시 자동 테스트
* `schedule` → 정기 헬스체크
* `workflow_dispatch` → GitHub UI에서 수동 실행 가능

> fork 후에는 GitHub 정책상 schedule 트리거가 바로 동작하지 않을 수 있습니다.
> 최소 한 번은 **Actions 탭에서 수동 실행**해 두면 좋습니다.

### 5-2. Job 개요

1. 레포 체크아웃
2. Node.js 20 설치 + npm 캐시
3. `npm ci` 로 의존성 설치
4. `npx playwright install --with-deps` 로 브라우저 설치
5. `npx playwright test` 실행
   → 테스트 결과와 스크린샷/trace가 `test-results/`에 생성
6. `scripts/ci/*.mjs` 스크립트로:

   * Playwright JSON 결과 요약(meta.json)
   * 실패 테스트 ↔ 스크린샷 매핑
   * Slack 메시지 payload 생성 및 전송
7. `playwright-report/`를 `docs/`로 복사해 GitHub Pages에서 HTML 리포트 제공

---

## 6. Slack 연동 (필수 설정)

이 레포의 핵심 포인트 중 하나는
**GitHub Actions 실행 결과를 Slack 채널에 자동으로 전송**하는 부분입니다.

### 6-1. GitHub Secrets

레포에서 아래 **3개의 Secret**을 설정해야 합니다.

경로:
`Repository → Settings → Secrets and variables → Actions`

등록해야 할 키:

* `SLACK_BOT_TOKEN`

  * Slack **Bot User OAuth Token** (`xoxb-...`)
  * 최소 권한:

    * `chat:write`
    * `files:write`
    * `channels:read`
    * `files:read`

* `SLACK_CHANNEL_ID`

  * 알림을 받을 채널 ID (예: `C0123456789`)

* `SLACK_WEBHOOK_URL`

  * Incoming Webhook URL
  * 기본 텍스트/링크 알림에 사용

> 이 값들이 없으면 Slack 알림 단계에서 오류가 발생할 수 있습니다.
> 과제/실사용 환경에서는 반드시 세 개를 모두 설정해 주세요.

### 6-2. Slack App / Bot 설정

1. [https://api.slack.com/apps](https://api.slack.com/apps) 접속 → **Create New App → From scratch**

2. App 이름 예: `3o3-ci-bot`

3. 왼쪽 메뉴 **OAuth & Permissions → Scopes → Bot Token Scopes** 에 다음 권한 추가

   * `channels:read`
   * `chat:write`
   * `files:read`
   * `files:write`
   * `incoming-webhook`

4. 상단의 **Install to Workspace** (또는 Reinstall) 클릭 후
   발급된 **Bot User OAuth Token (`xoxb-...`)** 을 복사 → `SLACK_BOT_TOKEN` 으로 저장

5. Slack에서 **알림을 받을 채널**에 다음 명령 실행

   ```text
   /invite @3o3-ci-bot
   ```

   > 이 단계가 빠지면 `not_in_channel`, `channel_not_found` 등 오류로
   > 메시지/파일 업로드가 실패하거나, 알림이 오지 않습니다.

6. 채널 상세 정보에서 **채널 ID** 확인 → `SLACK_CHANNEL_ID` 로 저장

7. 같은 App에서 **Incoming Webhooks** 활성화

   * “Add New Webhook to Workspace” 클릭
   * 위에서 초대한 채널 선택 후 생성된 URL을 `SLACK_WEBHOOK_URL` 로 저장

---

## 7. GitHub Pages (HTML 리포트 호스팅)

Playwright HTML 리포트를 웹으로 바로 보기 위해 GitHub Pages를 사용합니다.

1. GitHub 레포 → **Settings → Pages**
2. **Source**: `Deploy from a branch`
3. **Branch**: `main`, 폴더: `/docs`
4. 저장 후 Actions 워크플로우를 한 번 실행하면

   ```text
   https://<YOUR_GITHUB_ID>.github.io/3o3/
   ```

   에서 HTML 리포트를 확인할 수 있습니다.

Slack 알림 메시지에는 이 URL이 함께 포함되어,
실패 시 바로 웹 리포트로 이동할 수 있습니다.

---

## 8. Slack 알림 예시

실패 시 메시지 예시 (형식은 변경될 수 있음):

```text
❌ 3o3 Playwright 테스트 실패

Status: `failure`
Branch: `main`
Commit: https://github.com/<USER>/3o3/commit/...
Run URL: https://github.com/<USER>/3o3/actions/runs/...

Tests:
  • Total : 11
  • Passed: 10
  • Failed: 1
  • Flaky : 0
  • Pass rate: 90.9%

HTML Report: https://<USER>.github.io/3o3/

실패 테스트별 스크린샷 링크
Fail #1: login.click Kakao OAuth URL이 올바르게 구성된다
Screenshot: https://<USER>.github.io/3o3/screenshots/failed-1.png
...
```

* Status / Branch / Commit / Run URL 등은 Slack에서 읽기 쉽도록 인라인 코드/링크 형태로 표시됩니다.
* **각 실패 테스트별 스크린샷** 링크가 함께 전송되어,
  개발자가 바로 UI 상태를 확인할 수 있습니다.

---

## 9. 자주 발생할 수 있는 이슈 & 체크리스트

1. **Slack 알림이 오지 않을 때**

   * `SLACK_WEBHOOK_URL` / `SLACK_BOT_TOKEN` / `SLACK_CHANNEL_ID` 값 확인
   * Bot이 채널에 **/invite** 되어 있는지 확인
   * 워크플로우 로그에서 Slack 관련 단계의 에러 메시지 확인

2. **GitHub Pages 404**

   * Settings → Pages 설정이 `Branch: main / Folder: /docs` 인지 확인
   * 최근 Actions 실행에서 `docs/` 폴더가 정상 생성되었는지 확인

3. **로컬/CI 간 테스트 결과 차이**

   * 네트워크 속도나 모달 노출 타이밍에 따라 UI가 미묘하게 달라질 수 있음
   * `/login` 모달(`예상 환급액 계산 기준`)은
     `LoginPage.closeExpectedRefundInfoIfOpen()`에서 최대 5초간 감시/닫기로 처리하여 플래키를 최대한 완화

---

## 데모 스크린샷

### 1) GitHub Actions 실행 화면
![GitHub Actions Run](docs/images/github-actions-run.png)

### 2) Slack 성공 알림 예시
![Slack Success Notification](docs/images/slack-success.png)

### 3) Slack 실패 알림 + 스크린샷 링크
![Slack Failure Notification](docs/images/slack-failure.png)

---
