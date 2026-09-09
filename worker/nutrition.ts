// 요리명 -> 탄수화물/단백질/지방/칼로리 추정치를 만드는 모듈.
//
// 원래 파이썬 프로젝트(skala-meal-macros)는 식약처 실측 DB를 우선 조회하고
// GPT는 검색어 제안 정도로만 쓰는 복잡한 다단계 구조였는데, 여기 처음
// 이식하는 버전은 "가장 간단하게" 동작하는 걸 목표로 했었음. 그런데
// 2026-09-09에 "기능 정확도를 위해 간단함 원칙은 폐기한다"고 결정해서,
// 끼니별 재보정 로직(reviewMealIfTooHigh)과 캐시 키를 (날짜,끼니,요리명)
// 복합키로 바꾸는 등 정확도 위주로 다시 손봄.
//
// TODO(효율 개선, 나중에): 식약처 DB 실측값 우선 조회 로직을 다시 넣으면
// 정확도가 오르고 OpenAI 호출도 줄일 수 있음 — 원본 파이썬의
// nutrition_db.py/food_heuristics.py가 그 역할.

export interface DishNutrition {
  serving_g: number;
  carb_g: number;
  protein_g: number;
  fat_g: number;
  kcal: number;
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
// 사용자가 실제 급식 경험상 "보통 이 정도를 넘겨서 나오지 않는다"고 확인한
// 값(2026-09-09). 이걸 넘으면 개별 요리 중 하나 이상이 과대추정됐다고
// 보고 재보정을 시도한다.
const MEAL_KCAL_WARN_THRESHOLD = 1050;

// (date, mealType, food_name)을 하나의 문자열 키로 합친다. 캐시 Map의
// 키로도 쓰고, D1 조회 결과를 다시 매칭할 때도 이 형식을 그대로 쓴다.
function cacheKey(date: string, mealType: string, name: string): string {
  return `${date}|${mealType}|${name}`;
}

// D1 캐시테이블에서 이미 계산해둔 (날짜,끼니,요리) 조합들의 결과를 읽어온다.
// (date,mealType,요리명) 전체 조합을 OR로 한 번에 조회하면 요리 수가 많을 때
// SQL 바인딩 변수 개수 제한을 넘어버림(실제로 한 주 전체 발행 시 "too many
// SQL variables" 에러 발생, 2026-09-09). 그래서 끼니(meal) 하나당 쿼리 하나로
// 나눠서, "이 날짜+이 끼니 안에서 food_name IN (...)"만 조회하는 방식으로
// 바인딩 개수를 끼니당 요리 수(보통 10개 안팎) 수준으로 억제한다.
async function loadCached(
  db: D1Database,
  meals: MealGroup[],
): Promise<Map<string, DishNutrition>> {
  const result = new Map<string, DishNutrition>();

  for (const m of meals) {
    if (m.dishes.length === 0) continue;
    const placeholders = m.dishes.map(() => "?").join(",");
    const rows = await db
      .prepare(
        `SELECT food_name, serving_g, carb_g, protein_g, fat_g, kcal
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
      }>();

    for (const row of rows.results ?? []) {
      result.set(cacheKey(m.date, m.mealType, row.food_name), {
        serving_g: row.serving_g,
        carb_g: row.carb_g,
        protein_g: row.protein_g,
        fat_g: row.fat_g,
        kcal: row.kcal,
      });
    }
  }
  return result;
}

function kcalFromMacros(carb_g: number, protein_g: number, fat_g: number): number {
  return Math.round(carb_g * 4 + protein_g * 4 + fat_g * 9);
}

// 이 요리가 고기 반찬류로 보이는지 이름으로 대충 판단(휴리스틱, AI 호출 없음).
// 사용자 피드백: "반찬은 메인메뉴보다 훨씬 적게 먹는데, 고기 반찬은 예외적으로
// 그것보단 많이 먹는다" — 이 예외를 프롬프트에 힌트로 넣어주기 위한 판단.
const MEAT_KEYWORDS = ["고기", "돈육", "닭", "소불고기", "제육", "탕수육", "돈까스", "까스", "불고기", "스테이크", "소세지", "소시지", "햄", "생선", "고등어", "갈비"];
function looksLikeMeatSide(name: string): boolean {
  return MEAT_KEYWORDS.some((kw) => name.includes(kw));
}

// OpenAI(gpt-4o-mini)에게 요리 하나의 1인분 영양정보를 직접 추정해달라고 요청.
// 최종 kcal는 응답을 그대로 믿지 않고 탄×4+단×4+지×9로 코드가 다시 계산한다.
async function estimateWithOpenAI(
  dish: DishRef,
  apiKey: string,
): Promise<DishNutrition> {
  // 사용자 피드백(2026-09-09): 메인메뉴(보통 메뉴 목록 앞쪽 1~2개)는
  // 표준 1인분을 다 먹지만, 나머지 반찬은 그보다 훨씬 적게 먹음(고기 반찬은
  // 예외적으로 좀 더 많이). 이걸 프롬프트에 명시적으로 알려주지 않으면
  // GPT가 반찬도 메인메뉴급 제공량으로 잡아서 칼로리가 전체적으로
  // 과대추정되는 문제가 있었음.
  const roleHint = dish.isMain
    ? "이 요리는 이 끼니의 메인메뉴야. 표준적인 1인분 양을 기준으로 추정해."
    : looksLikeMeatSide(dish.name)
      ? "이 요리는 곁들이 반찬이지만 고기류라서, 다른 반찬보다는 양이 좀 더 있는 편이야(메인메뉴보다는 적게)."
      : "이 요리는 곁들이 반찬이야. 메인메뉴보다 훨씬 적은 소량(예: 30~80g 수준)만 먹는다고 가정해.";

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "너는 영양사야. 한국 구내식당 메뉴 1인분(1회 제공량) 기준 영양정보를 추정해줘. " +
            roleHint +
            ' 반드시 JSON으로만 답해: {"serving_g": 숫자, "carb_g": 숫자, "protein_g": 숫자, "fat_g": 숫자}',
        },
        { role: "user", content: dish.name },
      ],
    }),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI 호출 실패 (${resp.status}): ${await resp.text()}`);
  }

  const data = (await resp.json()) as {
    choices: { message: { content: string } }[];
  };
  const parsed = JSON.parse(data.choices[0].message.content) as {
    serving_g: number;
    carb_g: number;
    protein_g: number;
    fat_g: number;
  };

  return {
    serving_g: parsed.serving_g,
    carb_g: parsed.carb_g,
    protein_g: parsed.protein_g,
    fat_g: parsed.fat_g,
    kcal: kcalFromMacros(parsed.carb_g, parsed.protein_g, parsed.fat_g),
  };
}

// 끼니 하나의 총 칼로리가 상식 밖으로 높을 때(MEAL_KCAL_WARN_THRESHOLD 초과),
// 그 끼니 전체 요리 목록과 각각의 현재 추정치를 GPT에게 다시 보여주고
// "반찬 위주로 양을 현실적으로 줄여서 다시 추정해달라"고 요청한다.
async function reviewMealIfTooHigh(
  meal: MealGroup,
  current: Map<string, DishNutrition>,
): Promise<boolean> {
  const total = meal.dishes.reduce(
    (sum, d) => sum + (current.get(cacheKey(meal.date, meal.mealType, d.name))?.kcal ?? 0),
    0,
  );
  return total > MEAL_KCAL_WARN_THRESHOLD;
}

async function correctMeal(
  meal: MealGroup,
  current: Map<string, DishNutrition>,
  apiKey: string,
): Promise<void> {
  const total = meal.dishes.reduce(
    (sum, d) => sum + (current.get(cacheKey(meal.date, meal.mealType, d.name))?.kcal ?? 0),
    0,
  );

  const breakdown = meal.dishes.map((d) => ({
    name: d.name,
    isMain: d.isMain,
    ...current.get(cacheKey(meal.date, meal.mealType, d.name)),
  }));

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `아래는 한국 구내식당 한 끼(총 ${total}kcal로 계산됨)의 요리별 1인분 추정치야. ` +
            `한국 구내식당 한 끼는 보통 ${MEAL_KCAL_WARN_THRESHOLD}kcal를 넘지 않으니, 이 합계는 ` +
            "과대추정일 가능성이 높아. isMain이 true인 메인메뉴는 그대로 두고, 나머지 반찬류의 " +
            "제공량(serving_g)과 탄단지를 현실적인 소량 기준으로 다시 추정해서 " +
            `전체 합이 ${MEAL_KCAL_WARN_THRESHOLD}kcal 이하가 되도록 보정해줘. ` +
            '반드시 JSON으로만 답해: {"요리명": {"serving_g": 숫자, "carb_g": 숫자, "protein_g": 숫자, "fat_g": 숫자}, ...} ' +
            "(모든 요리를 다 포함하되, 메인메뉴는 원래 값 그대로 넣어줘).",
        },
        { role: "user", content: JSON.stringify(breakdown) },
      ],
    }),
  });

  if (!resp.ok) {
    console.error(`끼니 재보정 실패 (${resp.status}): ${await resp.text()}`);
    return;
  }

  const data = (await resp.json()) as {
    choices: { message: { content: string } }[];
  };
  const corrected = JSON.parse(data.choices[0].message.content) as Record<
    string,
    { serving_g: number; carb_g: number; protein_g: number; fat_g: number }
  >;

  for (const [name, c] of Object.entries(corrected)) {
    current.set(cacheKey(meal.date, meal.mealType, name), {
      serving_g: c.serving_g,
      carb_g: c.carb_g,
      protein_g: c.protein_g,
      fat_g: c.fat_g,
      kcal: kcalFromMacros(c.carb_g, c.protein_g, c.fat_g),
    });
  }
}

// D1 캐시 테이블에 값을 그대로 덮어쓴다(신규 계산이든 재보정이든 공용으로 씀).
async function saveToCache(
  db: D1Database,
  date: string,
  mealType: string,
  name: string,
  n: DishNutrition,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO dish_nutrition
         (date, meal_type, food_name, serving_g, carb_g, protein_g, fat_g, kcal, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(date, meal_type, food_name) DO UPDATE SET
         serving_g = excluded.serving_g,
         carb_g = excluded.carb_g,
         protein_g = excluded.protein_g,
         fat_g = excluded.fat_g,
         kcal = excluded.kcal,
         updated_at = excluded.updated_at`,
    )
    .bind(date, mealType, name, n.serving_g, n.carb_g, n.protein_g, n.fat_g, n.kcal)
    .run();
}

// 주어진 끼니들(meals)에 대해:
//   1) D1 캐시에 (날짜,끼니,요리) 조합이 이미 있으면 그대로 씀
//   2) 없으면 OpenAI로 새로 추정
//   3) 끼니 총 칼로리가 너무 높으면 GPT에게 재보정 요청
//   4) 최종 결과를 D1에 저장
// 반환값: cacheKey(date,mealType,name) -> 영양정보 맵.
// saveWeek() 직후, 발행 시점에 딱 한 번만 호출된다(계획.md의
// "배치와 서빙 분리" 원칙은 유지 — 그때그때 계산 안 하고 발행 시 한 번에 계산).
export async function ensureNutrition(
  db: D1Database,
  openaiApiKey: string,
  meals: MealGroup[],
): Promise<Map<string, DishNutrition>> {
  const result = await loadCached(db, meals);

  // 1) 누락된 것만 새로 추정
  for (const m of meals) {
    for (const d of m.dishes) {
      const key = cacheKey(m.date, m.mealType, d.name);
      if (result.has(key)) continue;
      try {
        const nutrition = await estimateWithOpenAI(d, openaiApiKey);
        result.set(key, nutrition);
      } catch (err) {
        console.error(`영양정보 추정 실패: ${m.date} ${m.mealType} ${d.name}`, err);
      }
    }
  }

  // 2) 끼니별로 총합 검사 후 필요하면 재보정
  for (const m of meals) {
    try {
      if (await reviewMealIfTooHigh(m, result)) {
        await correctMeal(m, result, openaiApiKey);
      }
    } catch (err) {
      console.error(`끼니 재보정 중 오류: ${m.date} ${m.mealType}`, err);
    }
  }

  // 3) 최종 결과를 D1에 저장(신규분 + 재보정분 전부)
  for (const m of meals) {
    for (const d of m.dishes) {
      const key = cacheKey(m.date, m.mealType, d.name);
      const n = result.get(key);
      if (n) await saveToCache(db, m.date, m.mealType, d.name, n);
    }
  }

  return result;
}

// WeeklyMenu의 모든 day에서 lunch/dinner를 끼니 단위(MealGroup) 배열로 뽑아낸다.
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
      meals.push({
        date: day.date,
        mealType,
        dishes: meal.dishes.map((d) => ({ name: d.name, isMain: d.isMain })),
      });
    }
  }
  return meals;
}
