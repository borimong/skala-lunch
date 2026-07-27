# 차주 식단 자동 반영 — Apps Script 브리지

매주 금요일 밤, 이수민(`sumany76@whoneed.co.kr`)님이 개인 Gmail로 보내주는 **차주 식단표 엑셀(.xlsx)** 을
자동으로 찾아 Cloudflare Worker(`/api/ingest/weekly`)로 전송한다. 파싱·검증·발행은 Worker가 담당하고,
이 스크립트는 **파일을 실어 나르기만** 한다.

- 성공하면 조용히 처리 완료(사용자 슬랙 알림은 기존 매일 오전 8시 스케줄에서만 나감).
- **보류/오류/메일 없음**일 때만 관리자 본인에게 알림 메일을 보낸다.

## 파일

- `Code.gs` — 브리지 로직(메일 검색 → `.xlsx` 첨부 → base64 → POST → 응답 처리).
- `appsscript.json` — 프로젝트 매니페스트(시간대 `Asia/Seoul`, OAuth 스코프).

## 셋업 (약 5분)

1. https://script.google.com **에서 "새 프로젝트"** — 반드시 **엑셀을 받는 그 계정으로 로그인**한 상태에서.
2. 기본 `Code.gs` 내용을 지우고 이 폴더의 `Code.gs` 를 붙여넣기.
3. **시간대 확인**: 프로젝트 설정(⚙️) → 시간대를 `(GMT+09:00) 서울`로. (또는 매니페스트를 쓰면 `appsscript.json`의 `timeZone`이 이미 `Asia/Seoul`.)
4. **스크립트 속성 등록**: 프로젝트 설정 → 스크립트 속성 → 아래 3~4개 추가.
   | 키 | 값 |
   |----|----|
   | `WORKER_URL` | `https://skala-lunch.ewkimhyunsu11.workers.dev` |
   | `INGEST_TOKEN` | Worker에 넣을 `INGEST_TOKEN` 시크릿과 **동일한 값** |
   | `SENDER` | `sumany76@whoneed.co.kr` |
   | `NOTIFY_EMAIL` | (선택) 알림 받을 주소. 미설정 시 실행 계정 |
5. **트리거 생성**: 함수 선택 드롭다운에서 `setupTrigger` 선택 → **실행**. 처음 실행 시 권한 승인 창이 뜬다.
   - 승인 항목: Gmail 읽기/라벨, 외부 요청(UrlFetch), 메일 발송.
   - "이 앱은 확인되지 않았습니다" 경고가 뜨면 → 고급 → (안전하니) 계속 진행. **본인이 만든 본인 계정용 스크립트**라 정상이다.
   - 실행 후 트리거 페이지(⏰)에 "매주 금요일 오후 10~11시" 트리거가 생겼는지 확인.

## 동작 확인(트리거 없이 즉시 테스트)

Worker의 `/api/ingest/weekly`가 배포된 뒤:

1. 이수민님 메일(또는 같은 형식 테스트 메일)을 받은 상태에서, 함수 드롭다운 `ingestWeeklyMenu` 선택 → **실행**.
2. **실행 로그**로 결과 확인. 성공이면 조용히 끝나고, 해당 메일 스레드에 `식단자동반영-완료` 라벨이 붙는다.
3. 웹앱 홈에서 차주 메뉴가 반영됐는지 확인.
4. 재테스트하려면 그 스레드에서 `식단자동반영-완료` 라벨을 떼면 다시 처리 대상이 된다.

## Worker 인그레스 계약 (Code.gs ↔ Worker 합의)

**요청** — `POST {WORKER_URL}/api/ingest/weekly`
- 헤더: `Authorization: Bearer {INGEST_TOKEN}`, `Content-Type: application/json`
- 본문:
  ```json
  {
    "filename": "차주식단표.xlsx",
    "contentBase64": "<xlsx 원본 바이트의 표준 base64>",
    "sender": "sumany76@whoneed.co.kr",
    "receivedAt": "2026-07-31T13:05:00.000Z"
  }
  ```

**응답** — `200 OK`, 본문 `{ "status": ..., "reasons": [...], "summary": "..." }`
- `status: "published"` → 검증 통과, 자동 발행됨. 스크립트는 조용히 라벨만 부착.
- `status: "held"` → 검증에서 이상 감지, 보류(draft) 저장됨. 스크립트가 관리자에게 알림 메일.
- 그 외(비200 또는 에러) → 스크립트가 오류 알림 메일(라벨 미부착 → 수동 재실행 가능).

## Workspace 계정 주의

수신 계정이 회사·학교(Workspace) 계정이면, 조직 관리자가 **Apps Script** 또는 **외부 요청(UrlFetch)** 을 막아뒀을 수 있다.
5단계 승인에서 막히면(정책 차단 메시지) 이 방식 대신 **Worker에서 Gmail API 직접 호출**로 전환해야 한다.
→ 승인 단계에서 먼저 확인하는 것을 권장.
