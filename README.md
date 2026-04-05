# Instagram DM 자동 응답 봇

Instagram 비공식 API(`instagram-private-api`)와 Google Gemini를 사용해 DM에 자동으로 답하는 Node.js 봇입니다.

## 준비물

- Node.js 18 이상 권장
- Instagram 계정 (2단계 인증·보안 절차에 따라 로그인이 막힐 수 있음)
- Gemini API 키 ([Google AI Studio](https://aistudio.google.com/) 등에서 발급)

## 설치

```bash
git clone https://github.com/mickievely/instagram-dm-auto-reply.git
cd instagram-dm-auto-reply
npm install
```

루트에 `.env` 파일을 만들고 아래 변수를 채웁니다. 예시는 `.env.example`을 복사해 사용하면 됩니다.

```bash
copy .env.example .env
```

Windows PowerShell에서는 `Copy-Item .env.example .env` 를 사용할 수 있습니다.

## 환경 변수

| 변수 | 필수 | 설명 |
|------|------|------|
| `IG_USERNAME` | 예 | Instagram 사용자명 |
| `IG_PASSWORD` | 예 | Instagram 비밀번호 |
| `MENTION_TARGET` | 아니오 | 멘션 감지 대상 (비우면 `IG_USERNAME`과 동일) |
| `GEMINI_API_KEY` | AI 사용 시 | Gemini API 키 (단일) |
| `GEMINI_API_KEYS` | 아니오 | 키 여러 개일 때 쉼표로 구분 (`key1,key2`) |
| `CHECK_INTERVAL_MS` | 아니오 | 인박스 폴링 주기(ms), 기본 `1000` |
| `MAX_CALLS_PER_HOUR` | 아니오 | 시간당 API 호출 상한(설정용), 기본 `180` |
| `MIN_DELAY_MS` / `MAX_DELAY_MS` | 아니오 | 지연 범위(ms), 기본 `1000` ~ `3000` |
| `MIN_REQUEST_INTERVAL_MS` | 아니오 | Gemini 요청 최소 간격(ms), 기본 `3000` |
| `USE_AI` | 아니오 | `true`/`false`, 기본 `true` |
| `AI_TRIGGER_MODE` | 아니오 | `all`(모든 DM) 또는 `mention`(멘션만), 기본 `all` |
| `GEMINI_MODEL` | 아니오 | 기본 `gemini-2.5-flash-lite` |
| `AI_SYSTEM_PROMPT` | 아니오 | 시스템 프롬프트. 줄바꿈은 `\n`으로 적을 수 있음 |
| `MENTION_RESPONSE` | 아니오 | AI 끄거나 실패 시 쓰는 짧은 답, 기본 `ㅇㅇ` |
| `AUTO_RESPONSE_MESSAGE` | 아니오 | 자동 응답 문구(템플릿), 미설정 시 기본 문구 |

불리언은 `true`/`false`, `1`/`0`, `yes`/`no` 등으로 줄 수 있습니다.

## 실행

```bash
npm start
```

기타 스크립트:

- `npm run extract` — DM 추출 도구 (`extractDMs.js`)
- `node index.js` — 특정 스레드 미디어 다운로드 예제
- `node test-api.js` — 로그인·인박스 API 간단 테스트

## 주의사항

- Instagram 공식 API가 아니므로 계정 제한·차단·Checkpoint가 발생할 수 있습니다. 이용 정책과 위험은 본인 책임입니다.
- `.env`와 `sessions/` 폴더는 Git에 올리지 마세요. 저장소에는 `.env.example`만 공유합니다.
- API 키와 비밀번호는 절대 커밋하지 마세요.

## 라이선스

MIT (`package.json` 기준)
