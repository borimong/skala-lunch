// 요리명 -> 탄수화물/단백질/지방/칼로리 추정치를 만드는 모듈.
// 설계 배경/의사결정 히스토리는 인수인계.md의 "코딩기록" 참고.

import { isOutlier } from "./foodHeuristics";
import { lookupBest } from "./nutritionDb";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// 실제 Gemini generateContent 호출 한 번. 429(레이트리밋/쿼터초과)면 짧게 재시도.
async function callGemini(
  apiKey: string,
  model: string,
  systemInstruction: string,
  contents: GeminiContent[],
): Promise<GeminiContent> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents,
          tools: [LOOKUP_TOOL_GEMINI],
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: { temperature: 0 },
        }),
      },
    );
    if (resp.ok) {
      const data = (await resp.json()) as { candidates: { content: GeminiContent }[] };
      return data.candidates[0].content;
    }
    if (resp.status === 429 && attempt < maxAttempts) {
      const waitMs = 1000 * 2 ** (attempt - 1);
      console.error(`Gemini 레이트리밋/쿼터(429), ${waitMs}ms 후 재시도 (${attempt}/${maxAttempts})`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`Gemini 호출 실패 (${resp.status}): ${await resp.text()}`);
  }
  throw new Error("Gemini 호출 실패: 재시도 횟수 초과");
}

// Gemini가 최종 답변에서 ```json ... ``` 코드펜스로 감싸서 줄 때가 있어서 벗겨낸다.
function stripCodeFence(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return m ? m[1].trim() : text.trim();
}

interface AgentDishResult {
  serving_g: number;
  carb_g: number;
  protein_g: number;
  fat_g: number;
  source: Source;
  reliability: Reliability;
}

interface AgentAnswer {
  dishes: Record<string, AgentDishResult>;
  exclude?: { dish: string; reason: string }[];
}

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

// 끼니 하나를 최대 8턴까지 도구 호출 반복하며 계산. transcript는 추적로그용.
async function runMealAgent(
  meal: MealGroup,
  geminiApiKey: string,
  geminiModel: string,
  dataGoKrKey: string | undefined,
): Promise<{ answer: AgentAnswer; transcript: GeminiContent[] }> {
  const contents: GeminiContent[] = [
    {
      role: "user",
      parts: [{ text: JSON.stringify(meal.dishes.map((d) => ({ name: d.name, isMain: d.isMain }))) }],
    },
  ];

  const maxTurns = 8;
  for (let turn = 0; turn < maxTurns; turn++) {
    const modelTurn = await callGemini(geminiApiKey, geminiModel, SYSTEM_PROMPT, contents);
    contents.push(modelTurn);

    const functionCalls = modelTurn.parts.filter((p) => p.functionCall);
    if (functionCalls.length > 0) {
      const responseParts: GeminiPart[] = [];
      for (const p of functionCalls) {
        const call = p.functionCall!;
        let response: Record<string, unknown>;
        if (!dataGoKrKey) {
          response = { found: false, reason: "DATA_GO_KR_API_KEY 미설정" };
        } else {
          try {
            const query = String(call.args.query ?? "");
            const db = await lookupBest(query, dataGoKrKey);
            response = db ? { found: true, ...db } : { found: false };
          } catch (err) {
            response = { found: false, error: String(err) };
          }
        }
        responseParts.push({ functionResponse: { name: call.name, response } });
      }
      contents.push({ role: "user", parts: responseParts });
      continue;
    }

    const text = modelTurn.parts.map((p) => p.text ?? "").join("");
    const answer = JSON.parse(stripCodeFence(text)) as AgentAnswer;
    return { answer, transcript: contents };
  }
  throw new Error(`끼니 에이전트가 ${maxTurns}턴 안에 최종 답변을 못 냄: ${meal.date} ${meal.mealType}`);
}

function buildTraceMarkdown(meal: MealGroup, transcript: GeminiContent[]): string {
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

async function loadCached(db: D1Database, meals: MealGroup[]): Promise<Map<string, DishNutrition>> {
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
        outlier: !!row.outlier,
        excludedReason: row.excluded_reason ?? undefined,
      });
    }
  }
  return result;
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

  for (const m of meals) {
    if (m.dishes.length === 0 || mealFullyCached(m, result)) continue;
    try {
      const { answer, transcript } = await runMealAgent(m, geminiApiKey, geminiModel, dataGoKrKey);
      const excludeMap = new Map((answer.exclude ?? []).map((e) => [e.dish, e.reason]));

      for (const d of m.dishes) {
        const a = answer.dishes[d.name];
        if (!a) continue;
        const kcal = kcalFromMacros(a.carb_g, a.protein_g, a.fat_g);
        const nutrition: DishNutrition = {
          serving_g: a.serving_g,
          carb_g: a.carb_g,
          protein_g: a.protein_g,
          fat_g: a.fat_g,
          kcal,
          source: a.source,
          reliability: a.reliability,
          outlier: isOutlier(d.name, a.serving_g > 0 ? (kcal / a.serving_g) * 100 : 0),
          excludedReason: excludeMap.get(d.name),
        };
        result.set(cacheKey(m.date, m.mealType, d.name), nutrition);
      }

      await saveTrace(db, m.date, m.mealType, buildTraceMarkdown(m, transcript));
    } catch (err) {
      console.error(`끼니 에이전트 실패: ${m.date} ${m.mealType}`, err);
    }
  }

  for (const m of meals) {
    for (const d of m.dishes) {
      const key = cacheKey(m.date, m.mealType, d.name);
      const n = result.get(key);
      if (n) await saveToCache(db, m.date, m.mealType, d.name, n);
    }
  }

  return result;
}

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
