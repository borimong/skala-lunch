// 요리명 -> 이상치 여부를 순수 규칙(키워드 매칭)으로 판단.
// AI 호출이 전혀 없어서 비용이 안 든다. 원본 파이썬 food_heuristics.py의
// 카테고리별 kcal 상한선 표를 포팅한 것.
//
// 2026-09-10: 예전엔 "카테고리별 1회 제공량" + "메인/반찬 소비비율"을 코드가
// 고정 숫자로 강제했었는데(guessServingG/consumptionRatio), GPT tool-calling
// 에이전트 구조로 전환하면서 제공량 자체는 이제 GPT가 판단한다. 그래서 이
// 파일엔 "그 판단 결과가 상식적인지 검증하는" isOutlier만 남김 — 값을 만드는
// 게 아니라 사후 검증 역할로 축소.

interface CategoryRule {
  keywords: string[];
  kcalCeiling: number; // 100g당 kcal 기준 상한선. 넘으면 이상치 의심.
}

const CATEGORY_RULES: CategoryRule[] = [
  { keywords: ["국밥", "탕", "찌개", "전골"], kcalCeiling: 150 },
  { keywords: ["국", "찜"], kcalCeiling: 150 },
  { keywords: ["비빔밥", "덮밥", "볶음밥", "카레", "리조또"], kcalCeiling: 250 },
  { keywords: ["면", "우동", "국수", "라면", "파스타"], kcalCeiling: 200 },
  { keywords: ["밥"], kcalCeiling: 200 },
  { keywords: ["까스", "튀김", "돈까스", "탕수육", "핫도그"], kcalCeiling: 350 },
  { keywords: ["구이", "불고기", "고기", "제육", "스테이크", "갈비"], kcalCeiling: 350 },
  { keywords: ["김치", "무침", "나물", "장아찌", "절임"], kcalCeiling: 150 },
  { keywords: ["조림", "볶음"], kcalCeiling: 350 },
  { keywords: ["샐러드", "드레싱"], kcalCeiling: 200 },
];

const DEFAULT_KCAL_CEILING = 350;

function matchCategory(dishName: string): CategoryRule | null {
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => dishName.includes(kw))) return rule;
  }
  return null;
}

// kcalPer100g: 100g 기준 칼로리. 이 값이 카테고리 상한선을 넘으면 이상치로 본다.
// 값을 고치진 않고 화면에 "⚠️이상치의심" 배지만 붙이는 용도 — 에이전트가
// 준 숫자를 코드가 독립적으로 한 번 더 검증하는 안전장치.
export function isOutlier(dishName: string, kcalPer100g: number): boolean {
  const ceiling = matchCategory(dishName)?.kcalCeiling ?? DEFAULT_KCAL_CEILING;
  return kcalPer100g > ceiling;
}
