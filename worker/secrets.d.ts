// 시크릿 타입. `wrangler types`는 .dev.vars에서만 시크릿을 읽어서, .dev.vars가 없는 CI에서는
// worker-configuration.d.ts에 빠진다(빌드 실패). 여기서 직접 선언해 두면 Env에 합쳐진다.
// 새 시크릿을 추가하면 이 목록에도 넣는다.
interface Env {
  ADMIN_TOKEN: string;
  INGEST_TOKEN: string;
  GEMINI_API_KEY: string;
  SLACK_WEBHOOK_URL: string;
  SLACK_WEBHOOK_URL_INNOVALLEY: string;
  ADMIN_SLACK_WEBHOOK_URL: string;
  // 영양정보(worker/nutrition.ts) 전용 Gemini 키. 메뉴 추출용 GEMINI_API_KEY와 할당량을 나누려고 별도 키를 쓴다.
  GEMINI_NUTRITION_API_KEY?: string;
  // 식약처 식품영양성분DB(worker/nutritionDb.ts) 조회용 data.go.kr 인증키.
  DATA_GO_KR_API_KEY?: string;
}
