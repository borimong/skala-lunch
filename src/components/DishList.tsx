import { useEffect, useState } from "react";
import type { Dish } from "../../shared/menu";

type Nutrition = {
  serving_g: number;
  carb_g: number;
  protein_g: number;
  fat_g: number;
  kcal: number;
};

// 끼니별(날짜+lunch/dinner) 응답 캐시. 같은 끼니를 여러 번 렌더링해도
// API를 한 번만 부르도록 컴포넌트 바깥(모듈 레벨)에 둔다.
// 2026-09-09: 캐시 키가 (date, mealType, 요리명) 복합키로 바뀌면서
// DishList도 "어느 날짜/어느 끼니인지" 몰라선 안 되게 됨 — 그래서 이제
// props로 date/mealType을 받아 그 조합으로만 API를 부른다(요리명만으로는
// 더 이상 유일한 값이 아니라서 예전처럼 통째로 캐시할 수 없음).
const nutritionCache = new Map<string, Record<string, Nutrition>>();
const nutritionPromises = new Map<string, Promise<Record<string, Nutrition>>>();

function useNutritionMap(date: string, mealType: "lunch" | "dinner") {
  const cacheId = `${date}|${mealType}`;
  const [map, setMap] = useState<Record<string, Nutrition> | null>(
    nutritionCache.get(cacheId) ?? null,
  );

  useEffect(() => {
    if (nutritionCache.has(cacheId)) return;
    let promise = nutritionPromises.get(cacheId);
    if (!promise) {
      promise = fetch(`/api/nutrition?date=${date}&mealType=${mealType}`)
        .then((res) => res.json() as Promise<Record<string, Nutrition>>)
        .catch(() => ({}) as Record<string, Nutrition>);
      nutritionPromises.set(cacheId, promise);
    }
    promise.then((data) => {
      nutritionCache.set(cacheId, data);
      setMap(data);
    });
  }, [cacheId, date, mealType]);

  return map ?? {};
}

type Props = {
  dishes: Dish[];
  date: string;
  mealType: "lunch" | "dinner";
};

export default function DishList({ dishes, date, mealType }: Props) {
  const nutritionMap = useNutritionMap(date, mealType);

  return (
    <ul className="space-y-0.5">
      {dishes.map((dish, i) => {
        const n = nutritionMap[dish.name];
        return (
          <li
            key={i}
            className={
              dish.isMain
                ? "font-semibold text-gray-900"
                : "text-sm text-gray-600"
            }
          >
            {dish.name}
            {n && (
              <span className="ml-1 text-[11px] font-normal text-gray-400">
                ({n.kcal}kcal · 탄{n.carb_g} 단{n.protein_g} 지{n.fat_g})
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
