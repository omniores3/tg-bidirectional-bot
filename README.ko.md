# Telegram 양방향 고객 지원 봇

[中文](README.md) · [English](README.en.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · [Русский](README.ru.md) · [العربية](README.ar.md)

데이터베이스, Google Sheets, KV 또는 영구 메시지 저장소가 필요 없는 Telegram 양방향 고객 지원 봇입니다. 고객은 봇과 개인 대화를 하고, 메시지는 설정된 상담원 또는 일반 그룹으로 전달됩니다. 상담원은 Telegram의 기본 답장 기능으로 고객에게 답할 수 있습니다.

## 중요: 두 배포 방식 중 하나만 선택

이 프로젝트는 **완전히 독립적이며 동일한 기능을 제공하는 두 구현**을 제공합니다. 둘을 함께 배포할 필요가 없습니다.

```text
방식 A: Telegram → Cloudflare Worker → Telegram Bot API / AI API
방식 B: Telegram → Google Apps Script Web App → Telegram Bot API / AI API
```

- Cloudflare Workers만 사용하면 Google 계정과 Apps Script가 필요 없습니다.
- Google Apps Script만 사용하면 Cloudflare 계정과 Worker가 필요 없습니다.
- 양쪽은 서로를 호출하지 않으며 플랫폼 간 공유 비밀 키, 서명 봉투 또는 전달 주소도 없습니다.
- 루트 `config.js`가 두 배포 방식의 유일한 업무 설정 파일입니다.

## 주요 기능

- 상태 저장 없는 `round_robin` 순환 배정 또는 `all` 전체 전달.
- 숫자 ID, 숫자 문자열 또는 `@username`만 사용하는 간단한 대상 목록.
- 고객 이름, 사용자명, 숫자 ID, 메시지 유형, 시간과 내용 표시.
- 텍스트, 사진, 문서, 음성, 스티커 등 지원되는 Telegram 메시지 전달.
- 긴 메시지를 나누어도 서명된 답장 경로 유지.
- Telegram 기본 답장과 `/reply 고객ID 내용` 예비 명령 지원.
- `/start` 환영 문구와 메시지 본문 아래의 Inline Keyboard 설정 가능.
- 순서가 있는 키워드 규칙, 답변과 원문을 상담원에게도 전달.
- 고객이 `/ai 질문`을 명시적으로 전송할 때만 OpenAI 호환 AI를 호출합니다.
- 공개 HTTPS Markdown 지식 파일을 한 시간 동안 임시 캐시하며 대화 기록은 저장하지 않음.
- 그룹 답장 화이트리스트, 상담원 이름 서명, HMAC 경로 보호 지원.
- 명확한 중국어 핵심 코드 주석, 6개 언어 문서, 양쪽 플랫폼 테스트 제공.

## 후원 및 맞춤 개발

- TRC20 후원 주소: `THzYfLHVbEaZ4UXwq5AxuZ9aunxq4m4pQg`
- 봇 맞춤 개발 문의: Telegram `@easSearchs`

## 프로젝트 구조

```text
config.js                    실제 로컬 설정이며 .gitignore에서 제외됨
config.example.js            전체 주석이 포함된 설정 템플릿
CloudflareWorkers/           독립 배포 가능한 완전한 Worker 구현
GoogleScripts/               독립 배포 가능한 완전한 Apps Script 구현
scripts/sync-config.mjs      설정을 검사하고 양쪽 실행 설정 생성
scripts/set-webhook.mjs      선택한 플랫폼의 Telegram Webhook 설정
```

## 1. 공통 준비

### 봇 생성

Telegram에서 `@BotFather`를 열고 `/newbot`을 전송한 뒤 Bot Token을 저장합니다. 고객 메시지를 받을 상담 그룹에 봇을 추가합니다. 개인 대화 상담원은 봇이 먼저 메시지를 전송할 수 있도록 반드시 봇을 열고 `/start`를 전송해야 합니다.

그룹 Privacy Mode는 봇 자신의 메시지에 대한 답장 수신을 막지 않습니다. 추가 그룹 명령이 필요한 경우에만 BotFather에서 설정을 변경하세요.

### 설정 복사

Node.js 20 이상을 설치한 후:

```sh
cp config.example.js config.js
```

Windows PowerShell:

```powershell
Copy-Item config.example.js config.js
```

### 숫자 ID 확인

사용자가 봇에게 `/id`를 전송할 수 있도록 하거나, 봇을 대상 그룹에 임시로 추가하고 `/id`를 전송합니다. 사용자 ID와 채팅 ID가 반환됩니다. 일반 그룹과 슈퍼그룹을 지원하며 토픽 기능은 사용하지 않습니다.

### 두 개의 독립 비밀 키 생성

다음 명령을 두 번 실행합니다.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

- 첫 번째 값은 Webhook 인증용 `telegram.webhookSecret`에 입력합니다.
- 두 번째 값은 상담원 답장 경로 서명용 `replies.routeSecret`에 입력합니다.

Worker와 Apps Script 사이의 세 번째 공유 비밀 키는 존재하지 않습니다.

## 2. 전체 config.js 설정 설명

루트 `config.js`를 수정합니다. 각 줄의 자세한 중국어 주석은 [config.example.js](config.example.js)에 있습니다.

### Telegram과 Worker

| 필드 | 설명 |
| --- | --- |
| `telegram.botToken` | BotFather가 제공한 Token. |
| `telegram.webhookSecret` | 16–256자의 영문자, 숫자, 밑줄 또는 하이픈. Worker는 요청 헤더를, Apps Script는 `/exec?secret=...`을 검사합니다. |
| `telegram.apiBaseUrl` | Telegram API 루트 주소이며 기본값은 `https://api.telegram.org`입니다. |
| `worker.requestTimeoutMs` | Worker의 Telegram, AI, 지식 요청 제한 시간(밀리초)이며 Worker에서만 사용합니다. |
| `worker.maxUpdateBytes` | Update의 최대 UTF-8 바이트 크기이며 Worker에서만 사용합니다. |

### 메시지 분배

| 필드 | 설명 |
| --- | --- |
| `dispatch.mode` | `round_robin` 또는 `all`. 순환 방식은 `update_id % 대상 수`를 사용하며 커서를 저장하지 않습니다. |
| `dispatch.users` | 상담원 사용자 배열(예: `[111111111, "@kefu001"]`). |
| `dispatch.groups` | 일반 상담 그룹 배열(예: `[-1001234567890, "@my_support_group"]`). |

```js
dispatch: {
  mode: "round_robin",
  users: [111111111, "@kefu001"],
  groups: [-1001234567890, "@my_support_group"]
}
```

숫자 문자열은 숫자로 변환되고 사용자명은 대소문자를 구분하지 않습니다. 공개 사용자명은 바뀔 수 있으므로 장기 사용에는 숫자 ID를 권장합니다.

### 환영 메시지와 Inline Keyboard

| 필드 | 설명 |
| --- | --- |
| `welcome.text` | `/start` 환영 본문. |
| `welcome.buttons` | 버튼 행을 담는 2차원 배열. |
| 버튼 `text` | 버튼에 표시할 문구. |
| 버튼 `callbackData` | 1–64바이트 콜백 데이터이며 `url`과 둘 중 하나를 선택합니다. |
| 버튼 `response` | 콜백 버튼 클릭 후 고객에게 전송되는 선택적 답변. |
| 버튼 `url` | HTTPS 링크이며 `callbackData`와 둘 중 하나를 선택합니다. |

```js
welcome: {
  text: "서비스를 선택하거나 질문을 전송할 수 있습니다.",
  buttons: [
    [{ text: "도움말", callbackData: "help", response: "여기에 질문을 전송할 수 있습니다." }],
    [{ text: "웹사이트", url: "https://example.com" }]
  ]
}
```

이 설정은 입력창 아래의 Reply Keyboard가 아니라 `reply_markup.inline_keyboard`를 생성합니다.

### 키워드 자동 답변

| 필드 | 설명 |
| --- | --- |
| `autoReply.enabled` | 고정 규칙 사용 여부. |
| `autoReply.rules` | 순서가 있는 규칙 배열이며 첫 번째 일치 규칙을 사용합니다. |
| 규칙 `keywords` | 비어 있지 않은 키워드 배열이며 하나라도 일치하면 됩니다. |
| 규칙 `reply` | 고객에게 전송되고 상담원에게도 복사되는 답변. |

영문은 대소문자를 구분하지 않고 부분 문자열로 일치합니다. 규칙에 맞지 않는 일반 메시지는 상담원에게만 전달되며 AI를 자동 호출하지 않습니다.

### AI와 온라인 Markdown

| 필드 | 설명 |
| --- | --- |
| `ai.enabled` | 명시적 `/ai` 요청 사용 여부. |
| `ai.apiBaseUrl` | `https://api.openai.com/v1`과 같은 OpenAI 호환 API 루트. |
| `ai.apiKey` | AI 서비스 키. |
| `ai.model` | 모델 이름. |
| `ai.systemPrompt` | 시스템 프롬프트. |
| `ai.knowledgeUrls` | 공개 HTTPS Markdown URL 배열. |
| `ai.maxKnowledgeChars` | 요청 한 번에 사용하는 전체 지식 문자 수 제한. |
| `ai.maxOutputTokens` | 최대 출력 Token 수(1–4096). |
| `ai.temperature` | 샘플링 온도(0–2). |

최대 10개 파일, 파일당 최대 50000자를 읽고 리디렉션을 허용하지 않습니다. Apps Script는 `CacheService`에 한 시간 캐시하고, Worker는 현재 인스턴스 메모리에 한 시간 캐시한 뒤 인스턴스가 회수되면 다시 다운로드합니다. 지식 또는 AI 요청이 실패한 경우에도 고객에게 안내하고 원래 질문은 상담원에게 전달합니다.

### 답장과 표시

| 필드 | 설명 |
| --- | --- |
| `replies.groupPolicy` | `all_members` 또는 `whitelist`. |
| `replies.allowedUserIds` | 화이트리스트 모드에서 답장할 수 있는 상담원 숫자 ID 배열. |
| `replies.showOperatorName` | 고객에게 상담원 이름 표시 여부. `false`이면 `copyMessage`로 출처를 숨깁니다. |
| `replies.linkToOriginal` | 고객 원문에 답장을 연결하며, 원문이 삭제된 경우 연결 없이 재시도합니다. |
| `replies.routeSecret` | 최소 16자의 HMAC 경로 비밀 키. |
| `presentation.timeZone` | `Asia/Shanghai`와 같은 IANA 시간대. |
| `presentation.showLanguage` | 고객의 Telegram 언어 표시 여부. |
| `presentation.showTimestamp` | 고객 메시지 시간 표시 여부. |

### 안내 문구

| 필드 | 용도 |
| --- | --- |
| `messages.customerHelp` | 고객 `/help`와 알 수 없는 명령. |
| `messages.aiHelp` | 질문 없이 `/ai`를 입력한 경우. |
| `messages.aiUnavailable` | AI 또는 지식 파일 사용 불가. |
| `messages.invalidButton` | 잘못되었거나 만료된 버튼 콜백. |
| `messages.adminHelp` | 상담원 도움말. |
| `messages.unsupported` | 지원하지 않는 메시지 유형. |
| `messages.deliveryFailed` | 모든 상담 대상 전달 실패. |
| `messages.routeNotFound` | 잘못된 경로 또는 다른 봇의 메시지. |
| `messages.unauthorized` | 상담원 답장 권한 없음. |
| `messages.replyFailed` | 고객 답장 실패. |
| `messages.replySent` | `/reply` 예비 채널 성공. |
| `messages.invalidReplyCommand` | 잘못된 `/reply` 형식. |

## 3. 방식 A: Cloudflare Workers만 배포

Apps Script 프로젝트가 필요 없습니다.

### 설치, 로그인 및 배포

```sh
npm install --prefix CloudflareWorkers
npm exec --prefix CloudflareWorkers -- wrangler login
npm run sync:config
npm run deploy:worker
```

`CloudflareWorkers/wrangler.jsonc`에서 Worker 이름을 바꿀 수 있으며 묣료 workers.dev 하위 도메인으로 충분합니다. 생성된 `https://NAME.SUBDOMAIN.workers.dev` 주소를 복사합니다.

### Webhook 설정

```sh
npm run webhook:set -- https://NAME.SUBDOMAIN.workers.dev
```

스크립트가 `/webhook`을 추가하고 `telegram.webhookSecret`을 Telegram Secret Token으로 설정합니다. 상태 확인 주소:

```text
https://NAME.SUBDOMAIN.workers.dev/health
```

선택적으로 `wrangler secret put`을 사용해 `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `REPLIES_ROUTE_SECRET`, `AI_API_KEY`를 설정할 수 있습니다. 이 값들은 생성된 비밀 값을 덮어쓰며, 환경 변수 없이도 독립 실행됩니다.

## 4. 방식 B: Google Apps Script만 배포

Cloudflare 계정, Wrangler, Worker가 필요 없습니다.

### clasp 설치 및 로그인

```sh
npm install --prefix GoogleScripts
npm exec --prefix GoogleScripts -- clasp login
```

### 프로젝트 생성 및 업로드

`https://script.google.com/`에서 빈 프로젝트를 만듭니다. 프로젝트 설정이나 브라우저 주소에서 Script ID를 복사하고 `GoogleScripts/.clasp.json`을 만듭니다.

```json
{
  "scriptId": "YOUR_SCRIPT_ID",
  "rootDir": "."
}
```

독립 구현을 업로드합니다.

```sh
npm run sync:config
npm run push:gas
```

`GoogleScripts/config.generated.js`는 직접 수정하지 마세요.

### Web App 게시

Apps Script 편집기에서 **배포 → 새 배포 → 웹 앱**을 선택합니다.

- 실행 사용자: **나**.
- 액세스 권한이 있는 사용자: **모든 사용자**.
- `/dev` 테스트 주소가 아니라 `/exec`로 끝나는 게시 URL을 복사합니다.

### Webhook 설정

```sh
npm run webhook:set -- https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

Apps Script는 Telegram Secret Token 요청 헤더를 읽을 수 없으므로 스크립트가 `/exec`에 `?secret=...`을 추가합니다. `doPost`는 같은 `telegram.webhookSecret`으로 이를 검증합니다. 전체 Webhook URL을 공개하지 마세요.

## 5. 사용 및 검수

1. 고객 계정으로 `/start`를 전송하고 환영 본문과 Inline Keyboard를 확인합니다.
2. 텍스트, 사진, 스티커를 전송하고 설정 대상에서 고객 정보와 내용을 확인합니다.
3. 봇 정보 카드, 경로가 있는 텍스트 또는 미디어 caption에 답장하여 고객 수신을 확인합니다.
4. 상담 채팅에서 `/reply 고객ID 내용`을 시험합니다.
5. `/id` 결과와 `config.js`의 숫자 ID를 비교합니다.
6. 설정한 키워드를 시험하고 고객과 상담원이 모두 답변을 받는지 확인합니다.
7. `/ai 설치 방법은?`을 전송하고 답변과 상담원 사본을 확인합니다. 일반 메시지는 AI를 호출하면 안 됩니다.
8. 화이트리스트 모드에서 허용된 멤버와 허용되지 않은 멤버를 각각 시험합니다.

```text
/start                 고객 환영 메시지
/help                  고객 또는 상담원 도움말
/ai 질문               명시적 AI 질문
/id                    사용자 및 채팅 ID 확인
/reply 고객ID 내용      상담원 예비 답장
```

## 6. 업데이트, 테스트 및 문제 해결

설정 변경 후:

```sh
npm run sync:config
npm run test:worker
npm run test:gas
npm run build:worker
```

선택한 플랫폼만 업데이트합니다.

- Worker: `npm run deploy:worker` 실행.
- Apps Script: `npm run push:gas` 실행 후 **배포 관리**에서 Web App을 편집하고 새 버전을 만들어 배포합니다. 일반적으로 `/exec` URL은 그대로이므로 Webhook을 다시 설정할 필요가 없습니다.

문제 해결:

- **Webhook 401/unauthorized**: `webhook:set`을 다시 실행하고 배포된 `webhookSecret`을 확인합니다.
- **봇이 메시지를 전송하지 못함**: Bot Token, 실행 로그, Telegram Webhook 정보를 확인합니다. 개인 상담원은 먼저 `/start`를 전송해야 합니다.
- **그룹이 메시지를 받지 못함**: 봇의 그룹 가입, 음수 그룹 ID, 공개 `@username`을 확인합니다.
- **상담원 답장이 유효하지 않음**: `R.customerId.messageId.signature`가 포함된 봇 메시지에 답장해야 하며 다른 봇의 메시지는 사용할 수 없습니다.
- **AI 실패**: API URL, 키, 모델, HTTPS 지식 URL과 공개 접근 권한을 확인합니다. 인계는 계속됩니다.
- **Apps Script 변경이 반영되지 않음**: Script ID를 확인하고 Web App 새 버전을 게시합니다.

고객 메시지, 대화, 분배 커서 또는 답장 매핑을 영구 저장하지 않습니다. `config.js`, 생성된 설정 파일과 전체 Apps Script Webhook URL을 안전하게 보호하세요.
