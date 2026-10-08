// 요리명 -> 탄수화물/단백질/지방/칼로리 추정치를 만드는 모듈.

import { isOutlier } from "./foodHeuristics";
import { fetchWithRetry } from "./gemini";
import { z } from "zod";
import { getLatestWeek } from "./menus";
import { lookupCached, type DbLookupResult } from "./nutritionDb";

export type Reliability = "high" | "medium" | "low";
export type Source = "food_safety_db" | "llm_estimate";

export interface DishNutrition {
  serving_g: number;
  carb_g: number;
  protein_g: number;
  fat_g: number;
  kcal: number;
  source: Source;
  reliability: Reliability;
  outlier: boolean; // foodHeuristics로 코드가 독립 검증
  excludedReason?: string; // 다른 메뉴에 이미 포함돼 총합에서 제외된 이유
}

export interface DishRef {
  name: string;
  isMain: boolean;
}

export interface MealGroup {
  date: string; // YYYY-MM-DD
  mealType: "lunch" | "dinner";
  dishes: DishRef[];
}

function cacheKey(date: string, mealType: string, name: string): string {
  return `${date}|${mealType}|${name}`;
}

function kcalFromMacros(carb_g: number, protein_g: number, fat_g: number): number {
  return Math.round(carb_g * 4 + protein_g * 4 + fat_g * 9);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// 100g당 값 × 섭취량 / 100. DB 값을 썼다면 AI가 옮겨 적은 숫자 대신 실제 도구 응답을 쓴다.
export function scaleToServing(
  a: AgentDishResult,
  lookups: Map<string, DbLookupResult>,
): { serving_g: number; carb_g: number; protein_g: number; fat_g: number; kcal: number } {
  const db = a.db_match ? lookups.get(a.db_match) : undefined;
  const per100 = db
    ? { carb: db.carbPer100g, protein: db.proteinPer100g, fat: db.fatPer100g }
    : { carb: a.carb_per100g, protein: a.protein_per100g, fat: a.fat_per100g };
  const ratio = a.serving_g / 100;
  const carb_g = round1(per100.carb * ratio);
  const protein_g = round1(per100.protein * ratio);
  const fat_g = round1(per100.fat * ratio);
  return { serving_g: a.serving_g, carb_g, protein_g, fat_g, kcal: kcalFromMacros(carb_g, protein_g, fat_g) };
}

// Gemini tools.functionDeclarations 스펙 (OpenAI tools와 달리 type이 대문자).
const LOOKUP_TOOL_GEMINI = {
  functionDeclarations: [
    {
      name: "lookup_food_db",
      description:
        "식약처 식품영양성분DB에서 음식/재료명을 검색해서 100g당 칼로리·탄수화물·단백질·지방과 " +
        "검색어 유사도를 반환한다. 정확한 이름이 아니어도 비슷한 항목을 찾아준다. " +
        "필요하면 같은 끼니 안에서 여러 번, 다른 검색어로도 호출해도 된다.",
      parameters: {
        type: "OBJECT",
        properties: {
          query: { type: "STRING", description: "검색할 음식 또는 재료명" },
        },
        required: ["query"],
      },
    },
  ],
};

// role은 "user"(입력/도구 결과) 또는 "model"(응답)만 존재.
interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

// Gemini 무료 할당량 중 "하루" 한도를 다 쓴 429. 기다려도 내일까지 안 풀리므로 재시도하지 않는다.
export class GeminiDailyQuotaError extends Error {}

// 429 응답 본문의 quotaId에 "PerDay"가 들어 있으면 하루 한도 초과(분당 한도는 "PerMinute").
export function isDailyQuotaBody(body: string): boolean {
  return /PerDay/i.test(body);
}

async function throwIfDailyQuota(resp: Response): Promise<void> {
  if (resp.status === 429 && isDailyQuotaBody(await resp.clone().text())) {
    throw new GeminiDailyQuotaError("Gemini 하루 할당량을 다 썼어요(내일 다시 계산됨).");
  }
}

// 실제 Gemini generateContent 호출 한 번.
// 일시적인 503/429는 메뉴 추출과 같은 공용 fetchWithRetry로 재시도하고, 하루 할당량 초과는 바로 포기한다.
// forceAnswer=true면 도구 호출을 막아(mode NONE) 지금까지 모은 정보로 최종 답만 내게 한다.
async function callGemini(
  apiKey: string,
  model: string,
  systemInstruction: string,
  contents: GeminiContent[],
  forceAnswer = false,
): Promise<GeminiContent> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents,
      tools: [LOOKUP_TOOL_GEMINI],
      toolConfig: { functionCallingConfig: { mode: forceAnswer ? "NONE" : "AUTO" } },
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: { temperature: 0 },
    }),
  };
  const first = await fetch(url, init);
  await throwIfDailyQuota(first);
  const isTemporary = first.status === 429 || first.status >= 500;
  const resp = isTemporary ? await fetchWithRetry(url, init) : first;
  if (isTemporary) await throwIfDailyQuota(resp);
  if (!resp.ok) {
    throw new Error(`Gemini 호출 실패 (${resp.status}): ${await resp.text()}`);
  }
  const data = (await resp.json()) as { candidates?: { content?: GeminiContent }[] };
  // 안전 필터 등으로 candidates가 비어 올 수 있어서 바로 꺼내지 않고 확인한다.
  const content = data.candidates?.[0]?.content;
  if (!content?.parts) {
    throw new Error(`Gemini 응답에 후보가 없음: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return content;
}

// Gemini가 최종 답변에서 ```json ... ``` 코드펜스로 감싸서 줄 때가 있어서 벗겨낸다.
function stripCodeFence(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return m ? m[1].trim() : text.trim();
}

// AI는 100g당 값과 섭취량만 준다. 곱셈(실제 섭취량 환산)은 코드가 한다.
const agentDishSchema = z.object({
  serving_g: z.number().positive(), // 0g이면 합계에서 조용히 빠지므로 잘못된 답으로 본다
  carb_per100g: z.number().nonnegative(),
  protein_per100g: z.number().nonnegative(),
  fat_per100g: z.number().nonnegative(),
  db_match: z.string().optional(), // DB 값을 썼다면 lookup 결과의 matchedName
  source: z.enum(["food_safety_db", "llm_estimate"]),
  reliability: z.enum(["high", "medium", "low"]),
});
export type AgentDishResult = z.infer<typeof agentDishSchema>;

// dishes는 요리별로 따로 검증한다(한 요리가 이상해도 나머지는 살림).
const agentAnswerSchema = z.object({
  dishes: z.record(z.string(), z.unknown()),
  exclude: z.array(z.object({ dish: z.string(), reason: z.string() })).optional(),
});
type AgentAnswer = z.infer<typeof agentAnswerSchema>;

export function parseDish(raw: unknown): AgentDishResult | undefined {
  const r = agentDishSchema.safeParse(raw);
  return r.success ? r.data : undefined;
}

const SYSTEM_PROMPT = `너는 한국 구내식당 영양 분석 에이전트야. 아래 경향성을 참고해서 판단해:

1) 끼니 목록에서 처음 1~2개(isMain=true)는 메인메뉴로, 보통 그 양을 기준으로 식사한다.
   나머지는 반찬으로, 메인메뉴보다 훨씬 적은 양만 먹는다. 정확한 비율은 네가 요리 특성에 맞게 판단해.
2) 메인메뉴가 "국밥" 또는 "비빔밥" 계열이면 이미 밥이 포함된 완전식이다. 같은 끼니에 "쌀밥" 같은
   밥이 별도로 있으면, 총 칼로리 계산에서 중복될 가능성이 높으니 exclude에 포함시켜라.
3) "쌀밥", "잡곡밥" 같은 공깃밥은 메인메뉴가 아니어도 반찬처럼 줄이지 말고 한 공기(약 200g)로 잡아라.

입력의 db_results에는 요리명 그대로 식약처 실측 DB를 미리 조회한 결과가 들어 있다(null이면 못 찾음).
매칭이 적절하면 도구를 부르지 말고 그 값을 바로 써라. 못 찾았거나 엉뚱한 음식에 매칭됐을 때만
lookup_food_db 도구로 다른 검색어(예: 핵심 재료명)를 조회해라. 그래도 없으면 일반 지식으로 추정해도 된다.

모든 요리에 대해 최종적으로 아래 JSON 형식으로만 답해(도구 호출이 다 끝난 마지막 응답에서):
{
  "dishes": {
    "요리명": {
      "serving_g": 숫자(실제 섭취량, g. 0보다 커야 함),
      "carb_per100g": 숫자, "protein_per100g": 숫자, "fat_per100g": 숫자 (전부 100g당 값. 섭취량으로 곱하지 마라 — 환산은 코드가 한다),
      "db_match": "DB 값을 썼다면 lookup_food_db 응답의 matchedName을 그대로, 아니면 생략",
      "source": "food_safety_db" 또는 "llm_estimate" (DB 조회 결과를 썼는지 여부),
      "reliability": "high" | "medium" | "low"
    }
  },
  "exclude": [{"dish": "요리명", "reason": "왜 중복인지"}]
}`;

// lookup_food_db 도구 요청 하나를 실행해서 Gemini에게 돌려줄 응답을 만든다. 실패해도 에러 대신 응답으로 알려준다.
async function runLookupTool(
  args: Record<string, unknown>,
  lookup: (query: string) => Promise<DbLookupResult | null>,
  dataGoKrKey: string | undefined,
): Promise<Record<string, unknown>> {
  if (!dataGoKrKey) return { found: false, reason: "DATA_GO_KR_API_KEY 미설정" };
  try {
    const found = await lookup(String(args.query ?? ""));
    return found ? { found: true, ...found } : { found: false };
  } catch (err) {
    return { found: false, error: String(err) };
  }
}

// 끼니 하나를 도구 호출을 반복하며 계산. transcript는 추적로그용.
// 도구를 계속 부르기만 하면 마지막 턴에서 도구를 막아 그때까지 모은 정보로 답하게 한다.
async function runMealAgent(
  db: D1Database,
  meal: MealGroup,
  geminiApiKey: string,
  geminiModel: string,
  dataGoKrKey: string | undefined,
): Promise<{ answer: AgentAnswer; transcript: GeminiContent[]; lookups: Map<string, DbLookupResult> }> {
  // AI가 db_match로 가리킨 값을 원본 그대로 쓰려고, 실제 DB 조회 결과를 matchedName으로 모아둔다.
  const lookups = new Map<string, DbLookupResult>();
  const lookup = async (query: string): Promise<DbLookupResult | null> => {
    if (!dataGoKrKey) return null;
    const found = await lookupCached(db, query, dataGoKrKey);
    if (found) lookups.set(found.matchedName, found);
    return found;
  };

  // 요리명 그대로의 DB 조회는 코드가 먼저 해서 첫 질문에 넣는다(Gemini가 도구를 부르는 턴을 줄임).
  const prefetched = await Promise.all(meal.dishes.map((d) => lookup(d.name).catch(() => null)));
  const contents: GeminiContent[] = [
    {
      role: "user",
      parts: [
        {
          text: JSON.stringify({
            dishes: meal.dishes.map((d) => ({ name: d.name, isMain: d.isMain })),
            db_results: Object.fromEntries(meal.dishes.map((d, i) => [d.name, prefetched[i]])),
          }),
        },
      ],
    },
  ];
  const maxTurns = 8;
  for (let turn = 0; turn < maxTurns; turn++) {
    const isLastTurn = turn === maxTurns - 1;
    const modelTurn = await callGemini(geminiApiKey, geminiModel, SYSTEM_PROMPT, contents, isLastTurn);
    contents.push(modelTurn);

    const functionCalls = modelTurn.parts.flatMap((p) => (p.functionCall ? [p.functionCall] : []));
    if (functionCalls.length > 0) {
      // 도구 요청이 여러 개면 동시에 처리한다.
      const responseParts = await Promise.all(
        functionCalls.map(async (call): Promise<GeminiPart> => ({
          functionResponse: { name: call.name, response: await runLookupTool(call.args, lookup, dataGoKrKey) },
        })),
      );
      contents.push({ role: "user", parts: responseParts });
      continue;
    }

    const text = modelTurn.parts.map((p) => p.text ?? "").join("");
    const answer = agentAnswerSchema.parse(JSON.parse(stripCodeFence(text)));
    return { answer, transcript: contents, lookups };
  }
  // 마지막 턴은 도구가 막혀 있어 여기까지 오지 않는다. 타입상 필요한 안전망.
  throw new Error(`끼니 에이전트가 최종 답변을 못 냄: ${meal.date} ${meal.mealType}`);
}

function formatTracePart(role: GeminiContent["role"], p: GeminiPart): string[] {
  if (p.functionCall) return [`## ${role} -> tool 호출: ${p.functionCall.name}(${JSON.stringify(p.functionCall.args)})`, ""];
  if (p.functionResponse) return [`## tool 응답 (${p.functionResponse.name})`, `\`${JSON.stringify(p.functionResponse.response)}\``, ""];
  if (p.text) return [`## ${role}`, "```", p.text, "```", ""];
  return [];
}

function buildTraceMarkdown(meal: MealGroup, transcript: GeminiContent[]): string {
  const lines: string[] = [
    `# ${meal.date} ${meal.mealType === "lunch" ? "중식" : "석식"} 영양정보 추적 로그 (Gemini 에이전트)`,
    "",
    "Gemini 에이전트가 이 끼니를 계산하며 주고받은 대화를 가공 없이 그대로 기록.",
    "(끼니 요리 목록, 도구 호출/응답, 최종 답변 순서)",
    "",
  ];
  const body = transcript.flatMap((c) => c.parts.flatMap((p) => formatTracePart(c.role, p)));
  return [...lines, ...body].join("\n");
}

function saveStatement(db: D1Database, date: string, mealType: string, name: string, n: DishNutrition): D1PreparedStatement {
  return db
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
    .bind(date, mealType, name, n.serving_g, n.carb_g, n.protein_g, n.fat_g, n.kcal, n.source, n.reliability, n.outlier ? 1 : 0, n.excludedReason ?? null);
}

type CachedRow = {
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
};

function rowToNutrition(row: CachedRow): DishNutrition {
  return {
    serving_g: row.serving_g,
    carb_g: row.carb_g,
    protein_g: row.protein_g,
    fat_g: row.fat_g,
    kcal: row.kcal,
    source: row.source,
    reliability: row.reliability,
    outlier: !!row.outlier,
    excludedReason: row.excluded_reason ?? undefined,
  };
}

// 끼니마다 쿼리를 하나씩 기다리지 않고 D1 batch로 한 번에 보낸다.
async function loadCached(db: D1Database, meals: MealGroup[]): Promise<Map<string, DishNutrition>> {
  const targets = meals.filter((m) => m.dishes.length > 0);
  if (targets.length === 0) return new Map();
  const statements = targets.map((m) =>
    db
      .prepare(
        `SELECT food_name, serving_g, carb_g, protein_g, fat_g, kcal, source, reliability, outlier, excluded_reason
         FROM dish_nutrition
         WHERE date = ? AND meal_type = ? AND food_name IN (${m.dishes.map(() => "?").join(",")})`,
      )
      .bind(m.date, m.mealType, ...m.dishes.map((d) => d.name)),
  );
  const results = await db.batch<CachedRow>(statements);
  return new Map(
    targets.flatMap((m, i) =>
      (results[i].results ?? []).map((row) => [cacheKey(m.date, m.mealType, row.food_name), rowToNutrition(row)] as const),
    ),
  );
}

// /api/nutrition용: 한 끼니의 저장된 영양정보를 { 요리명: 영양정보 } 형태로.
export async function getMealNutrition(
  db: D1Database,
  date: string,
  mealType: "lunch" | "dinner",
): Promise<Record<string, DishNutrition>> {
  const rows = await db
    .prepare(
      `SELECT food_name, serving_g, carb_g, protein_g, fat_g, kcal, source, reliability, outlier, excluded_reason
       FROM dish_nutrition WHERE date = ? AND meal_type = ?`,
    )
    .bind(date, mealType)
    .all<CachedRow>();
  return Object.fromEntries((rows.results ?? []).map((row) => [row.food_name, rowToNutrition(row)]));
}

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

function mealFullyCached(meal: MealGroup, cache: Map<string, DishNutrition>): boolean {
  return meal.dishes.every((d) => cache.has(cacheKey(meal.date, meal.mealType, d.name)));
}

export async function ensureNutrition(
  db: D1Database,
  geminiApiKey: string,
  meals: MealGroup[],
  dataGoKrKey?: string,
  geminiModel = "gemini-3.5-flash", // wrangler.jsonc의 GEMINI_MODEL과 동일한 검증된 모델명 사용
): Promise<Map<string, DishNutrition>> {
  const result = await loadCached(db, meals);
  // 이번에 새로 계산한 것만 따로 모아 저장한다(DB에서 꺼낸 건 이미 저장돼 있음).
  const fresh: { meal: MealGroup; name: string; n: DishNutrition }[] = [];

  // 끼니는 일부러 하나씩 차례로 계산한다(동시에 보내면 Gemini 분당 한도에 바로 걸림).
  for (const m of meals) {
    if (m.dishes.length === 0 || mealFullyCached(m, result)) continue;
    try {
      const { answer, transcript, lookups } = await runMealAgent(db, m, geminiApiKey, geminiModel, dataGoKrKey);
      const excludeMap = new Map((answer.exclude ?? []).map((e) => [e.dish, e.reason]));

      // 검사(parseDish)를 통과한 요리만 곱셈(scaleToServing)과 이상치 검사를 거쳐 결과가 된다.
      const computed = m.dishes.flatMap((d) => {
        const a = parseDish(answer.dishes[d.name]);
        if (!a) return [];
        const scaled = scaleToServing(a, lookups);
        const n: DishNutrition = {
          ...scaled,
          source: a.source,
          reliability: a.reliability,
          outlier: isOutlier(d.name, (scaled.kcal / scaled.serving_g) * 100),
          excludedReason: excludeMap.get(d.name),
        };
        return [{ meal: m, name: d.name, n }];
      });
      computed.forEach(({ name, n }) => result.set(cacheKey(m.date, m.mealType, name), n));
      fresh.push(...computed);

      await saveTrace(db, m.date, m.mealType, buildTraceMarkdown(m, transcript));
    } catch (err) {
      console.error(`끼니 에이전트 실패: ${m.date} ${m.mealType}`, err);
      // 하루 할당량이 끝났으면 남은 끼니도 전부 실패하니 더 부르지 않는다(다음 계산 때 이어서 함).
      if (err instanceof GeminiDailyQuotaError) break;
    }
  }

  if (fresh.length > 0) {
    await db.batch(fresh.map(({ meal, name, n }) => saveStatement(db, meal.date, meal.mealType, name, n)));
  }

  return result;
}

// 매일 새벽 크론(wrangler.jsonc "0 20 * * *")이 부른다. 수동 발행 뒤 계산만으로는
// 자동 발행(ingest) 주가 빠지므로, 최신 발행 주를 매일 한 번 확인해서 빈 끼니를 채운다.
// 이미 계산된 끼니는 ensureNutrition이 건너뛰니 바뀐 게 없는 날은 Gemini를 부르지 않는다.
export async function runNutritionCron(env: Env): Promise<void> {
  if (!env.GEMINI_NUTRITION_API_KEY) return;
  const week = await getLatestWeek(env.DB);
  if (!week) return;
  try {
    await ensureNutrition(env.DB, env.GEMINI_NUTRITION_API_KEY, collectMeals(week.days), env.DATA_GO_KR_API_KEY);
  } catch (err) {
    console.error("영양정보 크론 실패:", err);
  }
}

export function collectMeals(days: {
  date: string;
  lunch?: { dishes: { name: string; isMain: boolean }[] };
  dinner?: { dishes: { name: string; isMain: boolean }[] };
}[]): MealGroup[] {
  return days.flatMap((day) =>
    (["lunch", "dinner"] as const).flatMap((mealType) => {
      const meal = day[mealType];
      if (!meal || meal.dishes.length === 0) return [];
      return [{ date: day.date, mealType, dishes: meal.dishes.map((d) => ({ name: d.name, isMain: d.isMain })) }];
    }),
  );
}
