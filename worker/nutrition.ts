// 요리명 -> 탄수화물/단백질/지방/칼로리 추정치를 만드는 모듈.
//
// 2026-09-09: "DB조회를 반드시 해야 한다"는 결정에 따라, 원본 파이썬
// (nutrition_db.py + food_heuristics.py + estimate_macros.py)의 우선순위
// 구조를 다시 이식함:
//   Lv1) 식약처 DB에서 원본 요리명 그대로 검색 (제일 신뢰도 높음)
//   Lv2) DB에 없으면 GPT가 유사 검색어를 제안 -> 그 검색어로 DB 재검색
//   최후수단) 그래도 없으면 GPT가 직접 추정 (신뢰도 낮음)
// 최종 kcal는 항상 코드가 탄×4+단×4+지×9로 재계산해서 GPT가 부른 kcal를
// 신뢰하지 않는다. DB 실측값(Lv1/Lv2)은 값을 임의로 고치지 않고, 대신
// 카테고리별 kcal 상한선을 넘으면 "이상치의심" 배지만 붙인다(foodHeuristics).
// 끼니 총합이 너무 높을 때의 재보정(correctMeal)은 GPT 직접추정(최후수단)
// 요리에만 적용한다 — DB 실측값은 근거가 있는 값이라 함부로 안 건드린다.

import { guessServingG, isOutlier } from "./foodHeuristics";
import { lookupBest, SIMILARITY_HIGH } from "./nutritionDb";

export type Reliability = "high" | "medium" | "low";
export type Source = "food_safety_db" | "food_safety_db(유사검색)" | "gpt_estimate";

export interface DishNutrition {
  serving_g: number;
  carb_g: number;
  protein_g: number;
  fat_g: number;
  kcal: number;
  source: Source;
  reliability: Reliability;
  outlier: boolean;
}

// 요리 하나를 가리킬 때 이름만으론 부족해서(메인/반찬에 따라 제공량이
// 크게 다름) isMain도 같이 들고 다니는 타입.
export interface DishRef {
  name: string;
  isMain: boolean;
}

// 끼니 하나(특정 날짜의 중식 또는 석식)를 표현. 캐시 키가 (date, mealType,
// food_name) 복합키라서, 요리 목록뿐 아니라 어느 날짜·어느 끼니인지도
// 같이 들고 다녀야 한다.
export interface MealGroup {
  date: string; // YYYY-MM-DD
  mealType: "lunch" | "dinner";
  dishes: DishRef[];
}

// 한국 구내식당 한 끼(중식 또는 석식) 총 칼로리의 상식적인 상한선.
const MEAL_KCAL_WARN_THRESHOLD = 1050;

function cacheKey(date: string, mealType: string, name: string): string {
  return `${date}|${mealType}|${name}`;
}

function traceKey(date: string, mealType: string): string {
  return `${date}|${mealType}`;
}

// 추적 로그 한 줄: 이 요리를 어떤 경로(DB직접/DB유사검색/GPT직접추정)로
// 계산했는지, 그 경로에서 실제로 오간 원본 데이터를 그대로 남긴다.
// "쌀밥이 30g에 95kcal로 나오는데 DB에서 뭘로 매칭했는지 확인하고 싶다"는
// 요청(2026-09-09)으로 추가 — 최종 계산값만 보면 역추적이 안 됨.
export interface TraceEntry {
  name: string;
  detail: string; // 사람이 읽는 설명(어느 단계, 어떤 매칭/힌트였는지)
  raw: string; // 그 단계에서 실제로 받은 원본 응답(JSON 문자열 등), 가공 없이 그대로
  correctedRawResponse?: string;
}

function kcalFromMacros(carb_g: number, protein_g: number, fat_g: number): number {
  return Math.round(carb_g * 4 + protein_g * 4 + fat_g * 9);
}

// DB는 항상 100g 기준 값을 준다. 카테고리별 예상 1회 제공량(foodHeuristics)
// 만큼으로 스케일링해서 실제 먹는 양 기준 값으로 바꾼다. 이상치 판단은
// 스케일링 전 100g당 값 기준으로 한다(제공량 추정 자체가 근사치라서, 판단
// 기준을 스케일링된 값으로 하면 오차가 두 번 겹친다).
function scaleDbResult(
  dishName: string,
  db: { kcalPer100g: number; carbPer100g: number; proteinPer100g: number; fatPer100g: number },
): { nutrition: Omit<DishNutrition, "source" | "reliability">; outlier: boolean } {
  const servingG = guessServingG(dishName);
  const factor = servingG / 100;
  const outlier = isOutlier(dishName, db.kcalPer100g);
  return {
    nutrition: {
      serving_g: servingG,
      carb_g: Math.round(db.carbPer100g * factor * 10) / 10,
      protein_g: Math.round(db.proteinPer100g * factor * 10) / 10,
      fat_g: Math.round(db.fatPer100g * factor * 10) / 10,
      kcal: Math.round(db.kcalPer100g * factor),
      outlier,
    },
    outlier,
  };
}

// 이 요리가 고기 반찬류로 보이는지 이름으로 대충 판단(휴리스틱, AI 호출 없음).
const MEAT_KEYWORDS = ["고기", "돈육", "닭", "소불고기", "제육", "탕수육", "돈까스", "까스", "불고기", "스테이크", "소세지", "소시지", "햄", "생선", "고등어", "갈비"];
function looksLikeMeatSide(name: string): boolean {
  return MEAT_KEYWORDS.some((kw) => name.includes(kw));
}

function roleHintFor(dish: DishRef): string {
  return dish.isMain
    ? "이 요리는 이 끼니의 메인메뉴야. 표준적인 1인분 양을 기준으로 추정해."
    : looksLikeMeatSide(dish.name)
      ? "이 요리는 곁들이 반찬이지만 고기류라서, 다른 반찬보다는 양이 좀 더 있는 편이야(메인메뉴보다는 적게)."
      : "이 요리는 곁들이 반찬이야. 메인메뉴보다 훨씬 적은 소량(예: 30~80g 수준)만 먹는다고 가정해.";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 2026-09-10: 요리가 많은 끼니를 한 번에 발행하면 DB에서 못 찾은 요리마다
// GPT를 연달아 빠르게 호출하게 되는데, 그러다 OpenAI의 "분당 요청 수" 한도를
// 넘겨서 429(Too Many Requests)로 튕겨나가는 게 실제로 관찰됨. 429일 때만
// 잠깐 기다렸다가 재시도(최대 3회, 1초->2초->4초 간격)한다 — 평소엔 딜레이
// 없이 바로 호출하고, 한도에 걸렸을 때만 속도를 늦추는 방식이라 정상적인
// 경우엔 느려지지 않는다.
async function callOpenAiJson(apiKey: string, system: string, user: string): Promise<string> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { choices: { message: { content: string } }[] };
      return data.choices[0].message.content;
    }
    if (resp.status === 429 && attempt < maxAttempts) {
      const waitMs = 1000 * 2 ** (attempt - 1);
      console.error(`OpenAI 레이트리밋(429), ${waitMs}ms 후 재시도 (${attempt}/${maxAttempts})`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`OpenAI 호출 실패 (${resp.status}): ${await resp.text()}`);
  }
  throw new Error("OpenAI 호출 실패: 재시도 횟수 초과");
}

// GPT에게 "이 요리랑 비슷한 이름으로 뭐라고 검색해볼 수 있을까?"만 물어본다.
// 숫자는 안 만들고 검색어 후보만 받는다(원본 파이썬 estimate_gpt.analyze_dish_structure
// 중 search_queries 부분만 이식 — 구성요소 분해(Lv3)는 이번엔 생략).
async function suggestSearchQueries(dishName: string, apiKey: string): Promise<{ queries: string[]; raw: string }> {
  const raw = await callOpenAiJson(
    apiKey,
    "한국 구내식당 메뉴명을 식약처 식품영양성분DB에서 검색하기 좋은 형태로 " +
      "바꿔주는 역할이야. 메뉴명에서 소스/곁들임 표기(*, 괄호 등)를 떼거나, " +
      "핵심 재료명만 남기는 식으로 검색어 후보를 2~3개 만들어줘. " +
      '반드시 JSON으로만 답해: {"queries": ["검색어1", "검색어2"]}',
    dishName,
  );
  const parsed = JSON.parse(raw) as { queries: string[] };
  return { queries: parsed.queries ?? [], raw };
}

async function estimateDirectWithGpt(
  dish: DishRef,
  apiKey: string,
): Promise<{ nutrition: DishNutrition; detail: string; raw: string }> {
  const roleHint = roleHintFor(dish);
  const raw = await callOpenAiJson(
    apiKey,
    "너는 영양사야. 한국 구내식당 메뉴 1인분(1회 제공량) 기준 영양정보를 추정해줘. " +
      roleHint +
      ' 반드시 JSON으로만 답해: {"serving_g": 숫자, "carb_g": 숫자, "protein_g": 숫자, "fat_g": 숫자}',
    dish.name,
  );
  const parsed = JSON.parse(raw) as { serving_g: number; carb_g: number; protein_g: number; fat_g: number };
  const kcal = kcalFromMacros(parsed.carb_g, parsed.protein_g, parsed.fat_g);
  return {
    nutrition: {
      serving_g: parsed.serving_g,
      carb_g: parsed.carb_g,
      protein_g: parsed.protein_g,
      fat_g: parsed.fat_g,
      kcal,
      source: "gpt_estimate",
      reliability: "low",
      outlier: isOutlier(dish.name, (kcal / parsed.serving_g) * 100),
    },
    detail: `[최후수단: GPT 직접추정] 역할 힌트: ${roleHint}`,
    raw,
  };
}

// 요리 하나의 영양정보를 Lv1(DB직접) -> Lv2(GPT유사검색+DB재조회) -> 최후수단(GPT직접추정)
// 순서로 계산한다. 앞 단계에서 성공하면 뒤 단계는 시도하지 않는다.
async function estimateDish(
  dish: DishRef,
  openaiApiKey: string,
  dataGoKrKey: string | undefined,
): Promise<{ nutrition: DishNutrition; trace: TraceEntry }> {
  // Lv1: 원본 요리명 그대로 DB 검색
  if (dataGoKrKey) {
    const db = await lookupBest(dish.name, dataGoKrKey).catch((err) => {
      console.error(`DB 조회 실패: ${dish.name}`, err);
      return null;
    });
    if (db) {
      const { nutrition } = scaleDbResult(dish.name, db);
      const reliability: Reliability = db.similarity >= SIMILARITY_HIGH ? "high" : "medium";
      return {
        nutrition: { ...nutrition, source: "food_safety_db", reliability },
        trace: {
          name: dish.name,
          detail: `[Lv1: DB 직접매칭] '${dish.name}' -> '${db.matchedName}' (유사도 ${db.similarity})`,
          raw: JSON.stringify(db),
        },
      };
    }

    // Lv2: GPT가 제안한 유사 검색어로 DB 재검색
    try {
      const { queries, raw: gptRaw } = await suggestSearchQueries(dish.name, openaiApiKey);
      for (const q of queries) {
        const dbRetry = await lookupBest(q, dataGoKrKey).catch(() => null);
        if (dbRetry) {
          const { nutrition } = scaleDbResult(dish.name, dbRetry);
          return {
            nutrition: { ...nutrition, source: "food_safety_db(유사검색)", reliability: "medium" },
            trace: {
              name: dish.name,
              detail:
                `[Lv2: GPT 유사검색어 '${q}'로 DB 재검색] '${dish.name}' -> '${dbRetry.matchedName}' ` +
                `(유사도 ${dbRetry.similarity}). GPT가 제안한 검색어 후보: ${JSON.stringify(queries)}`,
              raw: `GPT 검색어 제안 원본: ${gptRaw} / DB 매칭 원본: ${JSON.stringify(dbRetry)}`,
            },
          };
        }
      }
    } catch (err) {
      console.error(`Lv2 유사검색 실패: ${dish.name}`, err);
    }
  }

  // 최후수단: GPT 직접 추정
  const { nutrition, detail, raw } = await estimateDirectWithGpt(dish, openaiApiKey);
  return { nutrition, trace: { name: dish.name, detail, raw } };
}

function buildTraceMarkdown(meal: MealGroup, entries: TraceEntry[]): string {
  const lines: string[] = [
    `# ${meal.date} ${meal.mealType === "lunch" ? "중식" : "석식"} 영양정보 추적 로그`,
    "",
    "요리별로 어떤 경로(DB직접/DB유사검색/GPT직접추정)로 계산했는지와, 그 단계에서",
    "실제로 오간 원본 데이터를 그대로 기록.",
    "",
  ];
  for (const e of entries) {
    lines.push(`## ${e.name}`);
    lines.push("");
    lines.push(`- **판단 경로**: ${e.detail}`);
    lines.push(`- **원본 데이터**: \`${e.raw}\``);
    if (e.correctedRawResponse) {
      lines.push(
        `- **끼니 재보정 발생** — 끼니 총합이 ${MEAL_KCAL_WARN_THRESHOLD}kcal를 넘어서 ` +
          "GPT 직접추정이었던 요리들만 재보정 요청함(DB 실측값은 안 건드림). " +
          `재보정 호출 원본 응답: \`${e.correctedRawResponse}\``,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

// 끼니 총합이 너무 높으면, 그중 "GPT 직접추정(gpt_estimate)"이었던 요리들만
// 대상으로 재보정을 요청한다. DB 실측값(food_safety_db*)은 근거가 있는 값이라
// 재보정 대상에서 제외 — 대신 이상치가 의심되면 위에서 이미 outlier 배지가 붙는다.
async function correctMeal(
  meal: MealGroup,
  current: Map<string, DishNutrition>,
  apiKey: string,
): Promise<string | null> {
  const total = meal.dishes.reduce((sum, d) => sum + (current.get(cacheKey(meal.date, meal.mealType, d.name))?.kcal ?? 0), 0);
  if (total <= MEAL_KCAL_WARN_THRESHOLD) return null;

  const adjustable = meal.dishes.filter((d) => current.get(cacheKey(meal.date, meal.mealType, d.name))?.source === "gpt_estimate");
  if (adjustable.length === 0) return null; // 고칠 대상(GPT추정)이 없으면 그냥 둠 — DB값은 안 건드림

  const breakdown = adjustable.map((d) => ({ name: d.name, isMain: d.isMain, ...current.get(cacheKey(meal.date, meal.mealType, d.name)) }));

  const raw = await callOpenAiJson(
    apiKey,
    `아래는 한국 구내식당 한 끼(총 ${total}kcal로 계산됨, DB 실측값 포함)의 요리 중 ` +
      "GPT가 직접 추정했던 것들이야. 전체 끼니 합계가 과대추정으로 의심돼(보통 " +
      `${MEAL_KCAL_WARN_THRESHOLD}kcal를 넘지 않음). isMain이 아닌 반찬류의 제공량과 ` +
      "탄단지를 현실적인 소량 기준으로 다시 추정해줘(메인메뉴는 원래 값 유지). " +
      '반드시 JSON으로만 답해: {"요리명": {"serving_g": 숫자, "carb_g": 숫자, "protein_g": 숫자, "fat_g": 숫자}, ...}',
    JSON.stringify(breakdown),
  ).catch((err) => {
    console.error(`끼니 재보정 실패: ${meal.date} ${meal.mealType}`, err);
    return null;
  });
  if (!raw) return null;

  const corrected = JSON.parse(raw) as Record<string, { serving_g: number; carb_g: number; protein_g: number; fat_g: number }>;
  for (const [name, c] of Object.entries(corrected)) {
    const key = cacheKey(meal.date, meal.mealType, name);
    const prev = current.get(key);
    if (!prev) continue;
    const kcal = kcalFromMacros(c.carb_g, c.protein_g, c.fat_g);
    current.set(key, {
      ...prev,
      serving_g: c.serving_g,
      carb_g: c.carb_g,
      protein_g: c.protein_g,
      fat_g: c.fat_g,
      kcal,
      outlier: isOutlier(name, (kcal / c.serving_g) * 100),
    });
  }
  return raw;
}

async function loadCached(db: D1Database, meals: MealGroup[]): Promise<Map<string, DishNutrition>> {
  const result = new Map<string, DishNutrition>();
  for (const m of meals) {
    if (m.dishes.length === 0) continue;
    const placeholders = m.dishes.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT food_name, serving_g, carb_g, protein_g, fat_g, kcal, source, reliability, outlier
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
      });
    }
  }
  return result;
}

async function saveToCache(db: D1Database, date: string, mealType: string, name: string, n: DishNutrition): Promise<void> {
  await db
    .prepare(
      `INSERT INTO dish_nutrition
         (date, meal_type, food_name, serving_g, carb_g, protein_g, fat_g, kcal, source, reliability, outlier, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(date, meal_type, food_name) DO UPDATE SET
         serving_g = excluded.serving_g, carb_g = excluded.carb_g, protein_g = excluded.protein_g,
         fat_g = excluded.fat_g, kcal = excluded.kcal, source = excluded.source,
         reliability = excluded.reliability, outlier = excluded.outlier, updated_at = excluded.updated_at`,
    )
    .bind(date, mealType, name, n.serving_g, n.carb_g, n.protein_g, n.fat_g, n.kcal, n.source, n.reliability, n.outlier ? 1 : 0)
    .run();
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

// saveWeek() 직후, 발행 시점에 딱 한 번만 호출된다(배치/서빙 분리 원칙 유지).
export async function ensureNutrition(
  db: D1Database,
  openaiApiKey: string,
  meals: MealGroup[],
  dataGoKrKey?: string,
): Promise<Map<string, DishNutrition>> {
  const result = await loadCached(db, meals);
  const traces = new Map<string, TraceEntry[]>();

  for (const m of meals) {
    const tKey = traceKey(m.date, m.mealType);
    if (!traces.has(tKey)) traces.set(tKey, []);
    for (const d of m.dishes) {
      const key = cacheKey(m.date, m.mealType, d.name);
      if (result.has(key)) continue;
      try {
        const { nutrition, trace } = await estimateDish(d, openaiApiKey, dataGoKrKey);
        result.set(key, nutrition);
        traces.get(tKey)!.push(trace);
      } catch (err) {
        console.error(`영양정보 추정 실패: ${m.date} ${m.mealType} ${d.name}`, err);
      }
    }
  }

  for (const m of meals) {
    try {
      const correctedRaw = await correctMeal(m, result, openaiApiKey);
      if (correctedRaw) {
        const tKey = traceKey(m.date, m.mealType);
        for (const entry of traces.get(tKey) ?? []) entry.correctedRawResponse = correctedRaw;
      }
    } catch (err) {
      console.error(`끼니 재보정 중 오류: ${m.date} ${m.mealType}`, err);
    }
  }

  for (const m of meals) {
    for (const d of m.dishes) {
      const key = cacheKey(m.date, m.mealType, d.name);
      const n = result.get(key);
      if (n) await saveToCache(db, m.date, m.mealType, d.name, n);
    }
  }

  for (const [tKey, entries] of traces) {
    if (entries.length === 0) continue;
    const [date, mealType] = tKey.split("|");
    const meal = meals.find((m) => m.date === date && m.mealType === mealType)!;
    await saveTrace(db, date, mealType, buildTraceMarkdown(meal, entries));
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
