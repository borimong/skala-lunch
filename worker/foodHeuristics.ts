// 요리명 -> 예상 1회 제공량(g) / 이상치 여부를 순수 규칙(키워드 매칭)으로 판단.
// AI 호출이 전혀 없어서 비용이 안 든다. 원본 파이썬 food_heuristics.py를
// 그대로 포팅한 것 — 카테고리별 평균 제공량과 kcal 상한선 표만 옮겼다.

interface CategoryRule {
  keywords: string[];
  servingG: number;
  kcalCeiling: number; // 100g당 kcal 기준 상한선. 넘으면 이상치 의심.
}

const CATEGORY_RULES: CategoryRule[] = [
  { keywords: ["국밥", "탕", "찌개", "전골"], servingG: 450, kcalCeiling: 150 },
  { keywords: ["국", "찜"], servingG: 300, kcalCeiling: 150 },
  { keywords: ["비빔밥", "덮밥", "볶음밥", "카레", "리조또"], servingG: 400, kcalCeiling: 250 },
  { keywords: ["면", "우동", "국수", "라면", "파스타"], servingG: 400, kcalCeiling: 200 },
  { keywords: ["밥"], servingG: 200, kcalCeiling: 200 },
  { keywords: ["까스", "튀김", "돈까스", "탕수육", "핫도그"], servingG: 180, kcalCeiling: 350 },
  { keywords: ["구이", "불고기", "고기", "제육", "스테이크", "갈비"], servingG: 150, kcalCeiling: 350 },
  { keywords: ["김치", "무침", "나물", "장아찌", "절임"], servingG: 50, kcalCeiling: 150 },
  { keywords: ["조림", "볶음"], servingG: 200, kcalCeiling: 350 },
  { keywords: ["샐러드", "드레싱"], servingG: 100, kcalCeiling: 200 },
];

const DEFAULT_SERVING_G = 150;
const DEFAULT_KCAL_CEILING = 350;

function matchCategory(dishName: string): CategoryRule | null {
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => dishName.includes(kw))) return rule;
  }
  return null;
}

export function guessServingG(dishName: string): number {
  return matchCategory(dishName)?.servingG ?? DEFAULT_SERVING_G;
}

// kcalPer100g: 100g 기준 칼로리. 이 값이 카테고리 상한선을 넘으면 이상치로 본다.
// 값을 고치진 않고 화면에 "⚠️이상치의심" 배지만 붙이는 용도(원본과 동일 원칙 —
// 사용자가 직접 판단할 근거만 보여주고 데이터를 임의로 조작하지 않음).
export function isOutlier(dishName: string, kcalPer100g: number): boolean {
  const ceiling = matchCategory(dishName)?.kcalCeiling ?? DEFAULT_KCAL_CEILING;
  return kcalPer100g > ceiling;
}
