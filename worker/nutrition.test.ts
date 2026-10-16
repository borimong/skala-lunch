import { describe, expect, it } from "vitest";
import {
  collectMeals,
  isDailyQuotaBody,
  parseDish,
  scaleToServing,
  type AgentDishResult,
} from "./nutrition";
import type { DbLookupResult } from "./nutritionDb";

const miyeokguk: DbLookupResult = {
  matchedName: "미역국",
  kcalPer100g: 23,
  carbPer100g: 1.74,
  proteinPer100g: 1.3,
  fatPer100g: 1.22,
  similarity: 1,
};

describe("scaleToServing", () => {
  it("DB 값은 100g당이라 섭취량만큼 곱한다 (미역국 200g → 두 배)", () => {
    const a: AgentDishResult = {
      serving_g: 200,
      carb_per100g: 1.74,
      protein_per100g: 1.3,
      fat_per100g: 1.22,
      db_match: "미역국",
      source: "food_safety_db",
      reliability: "high",
    };
    const r = scaleToServing(a, new Map([["미역국", miyeokguk]]));
    expect(r).toEqual({
      serving_g: 200,
      carb_g: 3.5,
      protein_g: 2.6,
      fat_g: 2.4,
      kcal: 46,
    });
  });

  it("db_match가 있으면 AI가 옮겨 적은 숫자 대신 실제 DB 응답을 쓴다", () => {
    const a: AgentDishResult = {
      serving_g: 100,
      carb_per100g: 99,
      protein_per100g: 99,
      fat_per100g: 99,
      db_match: "미역국",
      source: "food_safety_db",
      reliability: "high",
    };
    const r = scaleToServing(a, new Map([["미역국", miyeokguk]]));
    expect(r.carb_g).toBe(1.7);
  });

  it("DB 매칭이 없으면 AI 추정 100g당 값을 곱한다", () => {
    const a: AgentDishResult = {
      serving_g: 50,
      carb_per100g: 10,
      protein_per100g: 4,
      fat_per100g: 2,
      source: "llm_estimate",
      reliability: "low",
    };
    expect(scaleToServing(a, new Map())).toEqual({
      serving_g: 50,
      carb_g: 5,
      protein_g: 2,
      fat_g: 1,
      kcal: 37,
    });
  });
});

describe("parseDish", () => {
  const valid = {
    serving_g: 150,
    carb_per100g: 10,
    protein_per100g: 3,
    fat_per100g: 2,
    source: "llm_estimate",
    reliability: "low",
  };
  it("형식이 맞으면 통과", () => {
    expect(parseDish(valid)).toEqual(valid);
  });
  it("섭취량이 0g이면 잘못된 답으로 보고 버린다 (합계에서 조용히 빠지는 것 방지)", () => {
    expect(parseDish({ ...valid, serving_g: 0 })).toBeUndefined();
  });
  it("필드가 빠진 답은 버린다", () => {
    expect(parseDish({ serving_g: 100 })).toBeUndefined();
  });
});

describe("isDailyQuotaBody", () => {
  it("하루 할당량 초과 429는 재시도하지 않을 대상으로 본다", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        details: [
          {
            violations: [
              { quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" },
            ],
          },
        ],
      },
    });
    expect(isDailyQuotaBody(body)).toBe(true);
  });
  it("분당 한도 429는 잠깐 뒤 풀리니 재시도 대상", () => {
    const body = JSON.stringify({
      error: {
        code: 429,
        details: [
          {
            violations: [
              {
                quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
              },
            ],
          },
        ],
      },
    });
    expect(isDailyQuotaBody(body)).toBe(false);
  });
});

describe("collectMeals", () => {
  it("날짜별 중식/석식을 끼니 목록으로 펴고, 메뉴 없는 끼니는 뺀다", () => {
    const meals = collectMeals([
      {
        date: "2026-10-07",
        lunch: { dishes: [{ name: "쌀밥", isMain: false }] },
        dinner: { dishes: [] },
      },
      {
        date: "2026-10-08",
        dinner: { dishes: [{ name: "카레", isMain: true }] },
      },
    ]);
    expect(meals).toEqual([
      {
        date: "2026-10-07",
        mealType: "lunch",
        dishes: [{ name: "쌀밥", isMain: false }],
      },
      {
        date: "2026-10-08",
        mealType: "dinner",
        dishes: [{ name: "카레", isMain: true }],
      },
    ]);
  });
});
