import type { WeeklyMenu } from "../../shared/menu";

export async function fetchCurrentWeek(): Promise<WeeklyMenu | null> {
  const res = await fetch("/api/menus/current");
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`식단표를 불러오지 못했어요 (${res.status})`);
  }
  return (await res.json()) as WeeklyMenu;
}

export type DishNutrition = {
  serving_g: number;
  carb_g: number;
  protein_g: number;
  fat_g: number;
  kcal: number;
  source: "food_safety_db" | "food_safety_db(유사검색)" | "gpt_estimate";
  reliability: "high" | "medium" | "low";
  outlier: boolean;
};

// 상세 영양정보 페이지(NutritionPage)용. worker/nutrition.ts의 캐시 키가
// (date, meal_type, food_name) 복합키라서, 요리명만으로는 조회가 안 되고
// 이 둘을 반드시 같이 넘겨야 한다.
export async function fetchNutrition(
  date: string,
  mealType: "lunch" | "dinner",
): Promise<Record<string, DishNutrition>> {
  const res = await fetch(`/api/nutrition?date=${date}&mealType=${mealType}`);
  if (!res.ok) return {};
  return (await res.json()) as Record<string, DishNutrition>;
}
