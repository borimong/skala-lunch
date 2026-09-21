// 요리명 -> 이상치 여부를 순수 규칙(키워드 매칭)으로 판단. AI 호출 없음.
// 예전엔 제공량도 이 파일이 고정 규칙으로 정했으나(guessServingG 등, 지금은
// 삭제됨), 지금은 에이전트가 제공량을 정하고 이 파일은 "그 값이 상식적인지"
// 사후 검증만 함. 히스토리는 인수인계.md "코딩기록" 참고.

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

// 요리명에 키워드가 포함되면 그 카테고리로 판정. 위에서부터 순서대로 검사하니
// CATEGORY_RULES 배열 순서가 우선순위(먼저 매칭되는 게 이김).
function matchCategory(dishName: string): CategoryRule | null {
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => dishName.includes(kw))) return rule;
  }
  return null; // 매칭 안 되면 DEFAULT_KCAL_CEILING 씀
}

// kcalPer100g: 100g 기준 칼로리. 이 값이 카테고리 상한선을 넘으면 이상치로 본다.
// 값을 고치진 않고 화면에 "⚠️이상치의심" 배지만 붙이는 용도 — 에이전트가
// 준 숫자를 코드가 독립적으로 한 번 더 검증하는 안전장치.
export function isOutlier(dishName: string, kcalPer100g: number): boolean {
  const ceiling = matchCategory(dishName)?.kcalCeiling ?? DEFAULT_KCAL_CEILING;
  return kcalPer100g > ceiling;
}
