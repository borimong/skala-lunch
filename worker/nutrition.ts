// 요리명 -> 탄수화물/단백질/지방/칼로리 추정치를 만드는 모듈.
// 설계 배경/의사결정 히스토리는 인수인계.md의 "코딩기록" 참고.

import { isOutlier } from "./foodHeuristics";
import { lookupBest } from "./nutritionDb";

export type Reliability = "high" | "medium" | "low"; // 합집합 타입
export type Source = "food_safety_db" | "llm_estimate"; // DB에서 찾았는지 AI가 추정했는지

export interface DishNutrition { //interface가 붙으면 아래와 같은 모양이여야한다는거임 데이터 구조정의임
  serving_g: number; // 실제 섭취량(g) — 100g당이 아니라 실섭취 기준값
  carb_g: number;
  protein_g: number;
  fat_g: number;
  kcal: number; // 저장 시점에 kcalFromMacros()로 재계산한 값(LLM이 준 kcal는 안 씀)
  source: Source;
  reliability: Reliability;
  outlier: boolean; // foodHeuristics.isOutlier()로 코드가 독립 검증한 결과
  excludedReason?: string; // 다른 메뉴에 이미 포함돼 총합에서 제외된 이유(있으면)
}

export interface DishRef { //이름+메인메뉴여부를 한번에 답는 데이터 구조정의임
  name: string;
  isMain: boolean; // true면 메인메뉴(에이전트가 섭취량 판단할 때 기준)
}

export interface MealGroup {
  date: string; // YYYY-MM-DD
  mealType: "lunch" | "dinner";
  dishes: DishRef[];
}

// D1 캐시/Map 조회에 쓰는 복합키. dish_nutrition 테이블의 PK와 동일한 조합.
// DB에서 값을 검색하기 위해 세 값을 문자열 하나로 뭉쳐서 키로 사용
function cacheKey(date: string, mealType: string, name: string): string {
  return `${date}|${mealType}|${name}`;
}

// 탄단지 → kcal 환산(탄4/단4/지9). LLM이 준 kcal는 안 믿고 항상 이걸로 재계산.
function kcalFromMacros(carb_g: number, protein_g: number, fat_g: number): number {
  return Math.round(carb_g * 4 + protein_g * 4 + fat_g * 9);
}
//그냥 "n밀리초만큼 기다리기" 함수, Call Gemini에서 레이트리밋/쿼터 초과(429) 시 재시도 전에 잠깐 기다리기 위해 사용
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Gemini tools.functionDeclarations 스펙 (OpenAI tools와 달리 type이 대문자).
// 이 한 개 도구만 에이전트에게 쥐어줌 — 식약처 DB 검색.
// 여러번 우리한테 요청을 보내도됨(호출)
// callGemini 함수의 tools 
const LOOKUP_TOOL_GEMINI = {
  functionDeclarations: [
    // 제공하는 함수목록 근데 한개임
    {
      name: "lookup_food_db",
      description:
        "식약처 식품영양성분DB에서 음식/재료명을 검색해서 100g당 칼로리·탄수화물·단백질·지방과 " +
        "검색어 유사도를 반환한다. 정확한 이름이 아니어도 비슷한 항목을 찾아준다. " +
        "필요하면 같은 끼니 안에서 여러 번, 다른 검색어로도 호출해도 된다.",
      parameters: {
        type: "OBJECT",
        properties: { // 이 함수를 부를 때 필요한 인자(파라미터) 스펙
          query: { type: "STRING", description: "검색할 음식 또는 재료명" },
        },
        required: ["query"], //query는 필수값
      },
    },
  ],
};

// role은 "user"(입력/도구 결과) 또는 "model"(응답)만 존재.
interface GeminiPart {
  //interface : 이 데이터는 이런 모양(어떤 필드들이 있는지)이어야 한다
  //GeminiPart는 타입 이름
  //아래 셋중 하나만 가져온다 
  text?: string; // 텍스트
  functionCall?: { name: string; args: Record<string, unknown> }; // 모델이 도구를 부를 때
  functionResponse?: { name: string; response: Record<string, unknown> }; // 도구 실행 결과를 돌려줄 때
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
  //parts가 GeminiPart 틀에 맞는 값들의 배열([])이라는 뜻
}

//GeminiContent형태 

// [
//   { "role": "user", "parts": [{ "text": "[{\"name\":\"돈사태김치찜\",\"isMain\":true}, ...]" }] }
// ]

// Gemini가 도구를 부르고 싶어함 → contents.push(modelTurn)으로 2번째 항목 추가:
// [
//   { "role": "user", "parts": [{ "text": "[{...}]" }] },
//   { "role": "model", "parts": [{ "functionCall": { "name": "lookup_food_db", "args": { "query": "돈사태김치찜" } } }] }
// ]

// 우리가 DB 조회해서 결과 줌 → 3번째 항목 추가:
// [
//   { "role": "user", "parts": [...] },
//   { "role": "model", "parts": [{ "functionCall": {...} }] },
//   { "role": "user", "parts{ "name": "lookup_food_db","response": { "found": true, "kcalPer100g": 250, ... } } }] }
// ]

// Gemini가 최종 답변 → 4번째
// [
//   { "role": "user", "parts": [...] },
//   { "role": "model", "part}}] },
//   { "role": "user", "parts...}}] },
//   { "role": "model", "parts": [{ "text": "{\"dishes\": {...}}" }] }
// ]

// 실제 Gemini generateContent 호출 한 번(=대화 한 턴).
async function callGemini(
  apiKey: string,
  model: string,
  systemInstruction: string,
  contents: GeminiContent[], // GeminiContent에 맞는 데이터값을 넣으라는거임, 그리고 배열이라서 이 타입 여러 개를 담은 배열임
): Promise<GeminiContent> {
  //이 함수(callGemini)가 결국 GeminiContent 타입의 값을 (비동기로) 반환한다는 선언부의 끝부분임
  const maxAttempts = 3; //재시도 루프 
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch( // 응답 올때까지 기다린다는 뜻 // fetch는 HTTP 요청을 보내는 JS 내장 함수 결과(응답)를 resp라는 변수에 저장
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      //요청을 보낼 주소 
      {
        method: "POST",
        //  POST(서버에 데이터를 보내서 처리를 요청하는 방식) 
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents, //지금까지 대화 내용 전체
          tools: [LOOKUP_TOOL_GEMINI], // 사용가능한 도구 제공
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: { temperature: 0 }, // 항상 같은 입력엔 같은 판단 나오게
        }),
      }, 
    );
    if (resp.ok) {
      //resp.ok는 HTTP 응답 코드가 200번대(성공)일 때 true가 되는 built-in 속성
      const data = (await resp.json()) as { candidates: { content: GeminiContent }[] };
      return data.candidates[0].content; // 후보 중 1번째만 씀
      //candidates는 배열이라 여러 개 응답 버전이 올 수 있는데(예: "답변 3개 후보 중 골라써"), 우리는 그냥 0번째(첫 번째)만 꺼내 씀.
  
      //generationConfig: { temperature: 0 }, 이라서 따로 candidates는 설정안함. 그래서 원래도 한개 답변온다. 
    }
    if (resp.status === 429 && attempt < maxAttempts) {
      // 429 = 레이트리밋 또는 일일 쿼터 초과. 1초 → 2초로 backoff 후 재시도.
      // 레이트리밋 : "일정 시간 안에 너무 많이 요청하면 막는다"는 제한
      const waitMs = 1000 * 2 ** (attempt - 1);
      console.error(`Gemini 레이트리밋/쿼터(429), ${waitMs}ms 후 재시도 (${attempt}/${maxAttempts})`);
      await sleep(waitMs);
      continue;
    }
    // 429 외 에러(503 과부하 등)는 재시도 안 하고 바로 던짐 — 호출부(ensureNutrition)에서 그 끼니만 실패 처리.
    throw new Error(`Gemini 호출 실패 (${resp.status}): ${await resp.text()}`);
  }
  throw new Error("Gemini 호출 실패: 재시도 횟수 초과");
}

// Gemini가 최종 답변에서 ```json ... ``` 코드펜스로 감싸서 줄 때가 있어서 벗겨낸다.
function stripCodeFence(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return m ? m[1].trim() : text.trim();
}

// 에이전트 최종 답변(dishes 하나) 원본 형태 — DishNutrition으로 변환하기 전 단계.
interface AgentDishResult {
  // 요리 하나(하나의 값)가 어떤 모양인지 정의한 interface 
  serving_g: number;
  carb_g: number;
  protein_g: number;
  fat_g: number;
  source: Source;
  reliability: Reliability;
}
//여기서 agentAnswer에서 데이터 타입을 정의함, 근데 exclude?는 옵션임을 명시함
interface AgentAnswer { 
  dishes: Record<string, AgentDishResult>; // key = 요리명, 복수로 저장되기도함, key-value형태로 여러개 저장도 됨

//   "dishes": {
//   "돈사태김치찜": { "serving_g": 150, "carb_g": 9, ... },
//   "쌀밥": { "serving_g": 200, "carb_g": 74.7, ... },
//   "콩나물무침": { "serving_g": 40, "carb_g": 1.3, ... }
// }
  exclude?: { dish: string; reason: string }[]; // 중복이라 총합에서 뺄 요리들
}

// 에이전트에게 주는 시스템 지침. 숫자 규칙이 아니라 "경향성"만 줌 —
// 정확한 섭취 비율/판단은 LLM이 lookup_food_db 결과를 보고 스스로 정한다.
const SYSTEM_PROMPT = `너는 한국 구내식당 영양 분석 에이전트야. 아래 경향성을 참고해서 판단해:

1) 끼니 목록에서 처음 1~2개(isMain=true)는 메인메뉴로, 보통 그 양을 기준으로 식사한다.
   나머지는 반찬으로, 메인메뉴보다 훨씬 적은 양만 먹는다. 정확한 비율은 네가 요리 특성에 맞게 판단해.
2) 메인메뉴가 "국밥" 또는 "비빔밥" 계열이면 이미 밥이 포함된 완전식이다. 같은 끼니에 "쌀밥" 같은
   밥이 별도로 있으면, 총 칼로리 계산에서 중복될 가능성이 높으니 exclude에 포함시켜라.

lookup_food_db 도구로 식약처 실측 DB를 조회할 수 있다 — 정확도를 높이려면 적극 활용해라(같은 끼니
안에서 요리마다, 필요하면 여러 검색어로 여러 번 호출해도 된다). DB에서 못 찾은 요리는 네가 알고
있는 일반 지식으로 직접 추정해도 된다.

모든 요리에 대해 최종적으로 아래 JSON 형식으로만 답해(도구 호출이 다 끝난 마지막 응답에서):
{
  "dishes": {
    "요리명": {
      "serving_g": 숫자(실제 섭취량, g),
      "carb_g": 숫자, "protein_g": 숫자, "fat_g": 숫자,
      "source": "food_safety_db" 또는 "llm_estimate" (DB 조회 결과를 썼는지 여부),
      "reliability": "high" | "medium" | "low"
    }
  },
  "exclude": [{"dish": "요리명", "reason": "왜 중복인지"}]
}`;
// functionCall 구조는 딱히 지정안해줘도됨. 원래 잘 지킴/ 
// 끼니 하나를 계산하는 메인 루프. 최대 8턴까지 "도구 호출 → 결과 반영 → 재질문"을 반복.
// 반환하는 transcript는 buildTraceMarkdown()이 그대로 추적로그로 만듦.
async function runMealAgent(
  meal: MealGroup,
  geminiApiKey: string,
  geminiModel: string,
  dataGoKrKey: string | undefined,
): Promise<{ answer: AgentAnswer; transcript: GeminiContent[] }> {
  // 결과가 나중에 비동기로 anser, transcript로 반환됨(각각)
  // 첫 입력: 이 끼니의 요리명+isMain 목록만 JSON으로 던짐(다른 맥락 없음).
  const contents: GeminiContent[] = [
    //geminiContent 데이터 형식으로, 대화기록인 contents를 담는다는곳임
    {
      role: "user",
      parts: [{ text: JSON.stringify(meal.dishes.map((d) => ({ name: d.name, isMain: d.isMain }))) }],
    },
  ];

  const maxTurns = 8; // 요리 수가 많으면 도구를 여러 번 불러야 해서 여유 있게 캡
  for (let turn = 0; turn < maxTurns; turn++) {
    const modelTurn = await callGemini(geminiApiKey, geminiModel, SYSTEM_PROMPT, contents);
    // 위에서 정의한 callGemini()를 호출해서 GeminiContent형태의 modelTurn을 받아옴
    contents.push(modelTurn); // 이번 턴 응답을 대화 이력에 추가(다음 턴 컨텍스트로 씀) 응답을 대화 기록 배열(contents)의 맨 뒤에 추가.

    const functionCalls = modelTurn.parts.filter((p) => p.functionCall);
    //filter함수로 "functionCall 필드가 있는 파트만" 골라냄.
    if (functionCalls.length > 0) {
      // 이번 턴에 도구 호출이 있으면: 실제 DB 조회를 우리 코드가 대신 실행하고,
      // 결과를 functionResponse로 만들어 다음 턴 입력에 넣는다(AI는 직접 조회 못 함).
      const responseParts: GeminiPart[] = [];
      for (const p of functionCalls) {
        const call = p.functionCall!;
        let response: Record<string, unknown>;
        if (!dataGoKrKey) {
          response = { found: false, reason: "DATA_GO_KR_API_KEY 미설정" };
        } else {
          try {
            const query = String(call.args.query ?? "");
            //call.args.quer는 재미나이가 준 단서임. ?? "" : 근데 없으면 빈칸으로 대체한다는 말임
            const db = await lookupBest(query, dataGoKrKey); // lookupBest는 nutritionDb.ts통해서  — 실제 HTTP 조회하는 매써드
            response = db ? { found: true, ...db } : { found: false };
          } catch (err) {
            response = { found: false, error: String(err) }; // 조회 실패도 에이전트에게 알려서 스스로 판단하게 함
          }
        }
        responseParts.push({ functionResponse: { name: call.name, response } });
      }
      contents.push({ role: "user", parts: responseParts }); // 도구 결과 반영해서 다음 턴 진행
      continue;
    }

    // 도구 호출이 없다 = 최종 답변으로 간주하고 루프 종료.
    const text = modelTurn.parts.map((p) => p.text ?? "").join("");
    const answer = JSON.parse(stripCodeFence(text)) as AgentAnswer;
    return { answer, transcript: contents };
  }
  // 8턴 안에 최종 답을 못 내면 이 끼니는 실패 처리(ensureNutrition에서 catch됨).
  throw new Error(`끼니 에이전트가 ${maxTurns}턴 안에 최종 답변을 못 냄: ${meal.date} ${meal.mealType}`);
}

// transcript(에이전트와 주고받은 대화 원본)를 사람이 읽을 markdown으로 변환.
// /api/nutrition/trace가 이 결과를 그대로 내려줌 — 가공 없이 원본 그대로가 원칙.
function buildTraceMarkdown(meal: MealGroup, transcript: GeminiContent[]): string {
  //  목적: runMealAgent가 반환한 transcript(대화 전체 배열)를 
  // 사람이 읽기 좋은 markdown 문서로 바꾸는 함수. 이게 /api/nutrition/trace가 내려주는 그 원본 로그예
  const lines: string[] = [
    `# ${meal.date} ${meal.mealType === "lunch" ? "중식" : "석식"} 영양정보 추적 로그 (Gemini 에이전트)`,
    "",
    "Gemini 에이전트가 이 끼니를 계산하며 주고받은 대화를 가공 없이 그대로 기록.",
    "(끼니 요리 목록, 도구 호출/응답, 최종 답변 순서)",
    "",
  ];
  for (const c of transcript) {
    for (const p of c.parts) {
      if (p.functionCall) {
        lines.push(`## ${c.role} -> tool 호출: ${p.functionCall.name}(${JSON.stringify(p.functionCall.args)})`, "");
      } else if (p.functionResponse) {
        lines.push(`## tool 응답 (${p.functionResponse.name})`, `\`${JSON.stringify(p.functionResponse.response)}\``, "");
      } else if (p.text) {
        lines.push(`## ${c.role}`, "```", p.text, "```", "");
      }
    }
  }
  return lines.join("\n");
}

// 요리 하나의 최종 결과를 D1에 upsert. (date, meal_type, food_name)이 PK라서
// 같은 요리라도 끼니가 다르면 별도 행으로 저장됨(중복 방지 로직 참고).
// ?가 잔뜩 있는 부분은 SQL 인젝션(악의적인 값 주입) 막으려고 값을 직접 문자열에 끼워넣는 대신 자리표시자로 비워두고,
//  그 아래 .bind(...)에서 실제 값들을 순서대로 채워넣는 방식
async function saveToCache(db: D1Database, date: string, mealType: string, name: string, n: DishNutrition): Promise<void> {
  await db
    .prepare(
      `INSERT INTO dish_nutrition
         (date, meal_type, food_name, serving_g, carb_g, protein_g, fat_g, kcal, source, reliability, outlier, excluded_reason, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(date, meal_type, food_name) DO UPDATE SET
         serving_g = excluded.serving_g, carb_g = excluded.carb_g, protein_g = excluded.protein_g,
         fat_g = excluded.fat_g, kcal = excluded.kcal, source = excluded.source,
         reliability = excluded.reliability, outlier = excluded.outlier,
         excluded_reason = excluded.excluded_reason, updated_at = excluded.updated_at`,
    )
    .bind(date, mealType, name, n.serving_g, n.carb_g, n.protein_g, n.fat_g, n.kcal, n.source, n.reliability, n.outlier ? 1 : 0, n.excludedReason ?? null)
    .run();
}

// 주어진 끼니들에 대해 이미 D1에 있는 값을 한 번에 읽어옴(끼니마다 쿼리 1번 — IN절로 요리들을 한꺼번에).
async function loadCached(db: D1Database, meals: MealGroup[]): Promise<Map<string, DishNutrition>> {
  //  목적: meals 배열에 있는 끼니들에 대해 D1 DB에서 이미 저장된 영양정보를 한 번에 읽어와 Map으로 반환
  // MAP : key-value 쌍으로 저장하는 구조, 딕셔너리와는 약간 다르며 캐시데이터를 볼때 편함
  const result = new Map<string, DishNutrition>();
  for (const m of meals) {
    if (m.dishes.length === 0) continue;
    const placeholders = m.dishes.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT food_name, serving_g, carb_g, protein_g, fat_g, kcal, source, reliability, outlier, excluded_reason
         FROM dish_nutrition
         WHERE date = ? AND meal_type = ? AND food_name IN (${placeholders})`,
      )
      //"이 날짜, 이 끼니이면서, 요리명이 이 목록(placeholders) 중 하나인 행들을 다 가져와" 라고 SQL 쿼리 준비
      .bind(m.date, m.mealType, ...m.dishes.map((d) => d.name))
      .all<{
        food_name: string;
        serving_g: number;
        carb_g: number;
        protein_g: number;
        fat_g: number;
        kcal: number;
        source: Source;
        reliability: Reliability;
        outlier: number;
        excluded_reason: string | null;
      }>();
    for (const row of rows.results ?? []) {
      result.set(cacheKey(m.date, m.mealType, row.food_name), {
        serving_g: row.serving_g,
        carb_g: row.carb_g,
        protein_g: row.protein_g,
        fat_g: row.fat_g,
        kcal: row.kcal,
        source: row.source,
        reliability: row.reliability,
        outlier: !!row.outlier, // SQLite는 boolean이 없어서 0/1로 저장 → JS boolean으로 변환
        excludedReason: row.excluded_reason ?? undefined,
      });
    }
  }
  return result;
}

// 끼니 하나의 추적로그를 D1에 upsert(끼니당 최신 1개만 유지).
async function saveTrace(db: D1Database, date: string, mealType: string, markdown: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO nutrition_trace (date, meal_type, trace_md, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(date, meal_type) DO UPDATE SET trace_md = excluded.trace_md, updated_at = excluded.updated_at`,
    )
    .bind(date, mealType, markdown)
    .run();
}

// 이 끼니의 요리가 전부 이미 캐시에 있으면 true → 에이전트 재호출 안 하고 건너뜀(쿼터 절약).
function mealFullyCached(meal: MealGroup, cache: Map<string, DishNutrition>): boolean {
  return meal.dishes.every((d) => cache.has(cacheKey(meal.date, meal.mealType, d.name)));
}

// 이 모듈의 진입점. worker/index.ts의 POST /api/menus(발행) 직후 딱 한 번 호출됨.
// 흐름: 캐시 조회 → 캐시에 없는 끼니만 에이전트 호출 → 결과 정리 → 추적로그 저장 → D1에 upsert.
// export가 붙어있으니 다른 파일(worker/index.ts)에서 가져다 쓴다는 뜻. 
// 지금까지 봤던 작은 함수들(loadCached, runMealAgent, saveTrace, saveToCache)을 전부 순서대로 조립
export async function ensureNutrition(
  db: D1Database,
  geminiApiKey: string,
  meals: MealGroup[],
  dataGoKrKey?: string,
  geminiModel = "gemini-3.5-flash", // wrangler.jsonc의 GEMINI_MODEL과 동일한 검증된 모델명 사용
): Promise<Map<string, DishNutrition>> {
  // ensureNutrition 라는 함수는 결과적으로 요리 이름'을
  // 열쇠(Key)로 삼아, 위와 같은 '상세 영양 성분 데이터(DishNutrition)'를
  // 값(Value)으로 가지는 보관함(Map)을 반환한다. 
  const result = await loadCached(db, meals);

  for (const m of meals) {
    if (m.dishes.length === 0 || mealFullyCached(m, result)) continue; // 캐시로 충분하면 스킵
    try {
      const { answer, transcript } = await runMealAgent(m, geminiApiKey, geminiModel, dataGoKrKey);
      const excludeMap = new Map((answer.exclude ?? []).map((e) => [e.dish, e.reason]));

      for (const d of m.dishes) {
        const a = answer.dishes[d.name];
        if (!a) continue; // 에이전트가 이 요리를 답변에서 빼먹었으면 그냥 스킵(값 유지 안 함)
        const kcal = kcalFromMacros(a.carb_g, a.protein_g, a.fat_g); // LLM이 준 kcal는 버리고 재계산
        const nutrition: DishNutrition = {
          serving_g: a.serving_g,
          carb_g: a.carb_g,
          protein_g: a.protein_g,
          fat_g: a.fat_g,
          kcal,
          source: a.source,
          reliability: a.reliability,
          outlier: isOutlier(d.name, a.serving_g > 0 ? (kcal / a.serving_g) * 100 : 0), // 코드가 독립적으로 한 번 더 검증
          excludedReason: excludeMap.get(d.name),
        };
        result.set(cacheKey(m.date, m.mealType, d.name), nutrition);
      }

      await saveTrace(db, m.date, m.mealType, buildTraceMarkdown(m, transcript));
    } catch (err) {
      // 이 끼니만 실패 처리하고 다음 끼니는 계속 진행 — 발행 자체를 막지 않음.
      console.error(`끼니 에이전트 실패: ${m.date} ${m.mealType}`, err);
    }
  }

  // 방금 새로 계산된 것 + 원래 캐시에 있던 것 전부 다시 D1에 저장(원래 캐시분은 사실상 no-op upsert).
  for (const m of meals) {
    for (const d of m.dishes) {
      const key = cacheKey(m.date, m.mealType, d.name);
      const n = result.get(key);
      if (n) await saveToCache(db, m.date, m.mealType, d.name, n);
    }
  }

  return result;
}

// 긁어온 payload(WeeklyMenu.days)를 끼니(날짜×lunch/dinner) 단위 배열로 평탄화. => 쓰기 편하게
// 주의: 인자로 넘긴 days에 담긴 날짜를 전부 처리한다 — 하루만 계산하고 싶으면
// 호출하는 쪽(worker/index.ts)에서 days를 미리 그 하루로 잘라서 넘겨야 함.
export function collectMeals(days: {
  date: string;
  lunch?: { dishes: { name: string; isMain: boolean }[] };
  dinner?: { dishes: { name: string; isMain: boolean }[] };
}[]): MealGroup[] {
  const meals: MealGroup[] = [];
  for (const day of days) {
    for (const mealType of ["lunch", "dinner"] as const) {
      const meal = day[mealType];
      if (!meal || meal.dishes.length === 0) continue;
      meals.push({ date: day.date, mealType, dishes: meal.dishes.map((d) => ({ name: d.name, isMain: d.isMain })) });
    }
  }
  return meals;
}
