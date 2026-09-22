// 식품의약품안전처(공공데이터포털, data.go.kr) 식품영양성분DB API 조회.
// 원본 파이썬 nutrition_db.py를 TypeScript로 포팅한 것. 엔드포인트/파라미터명은
// 파이썬 쪽에서 이미 검증된 값을 그대로 씀:
//   - https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02
//   - 검색 파라미터는 FOOD_NM(무시됨)이 아니라 FOOD_NM_KR이어야 함
//   - 인증은 쿼리스트링(serviceKey)으로 — 이 방식이라 슬래시 인코딩 문제가 없음
//     (예전에 시도했던 openapi.foodsafetykorea.go.kr는 발급키에 우연히 '/'가
//     섞여서 경로 기반 인증과 충돌해 포기했었음, CHANGELOG 참고)

export interface DbLookupResult {
  matchedName: string;
  kcalPer100g: number;
  carbPer100g: number;
  proteinPer100g: number;
  fatPer100g: number;
  similarity: number; // 0~1, 검색어와 matchedName의 문자열 유사도
}

// 참고: DB의 Z10500("1회 섭취참고량") 필드를 제공량 기준으로 써보려 했으나,
// 매칭된 레코드마다 값이 들쭉날쭉해서(같은 "쌀밥"이어도 100g/250mL/450mL로
// 제각각) 실제 사용해보니 비현실적인 결과가 나옴을 확인(2026-09-10). 이후
// 제공량 결정 자체를 에이전트(worker/nutrition.ts)에게 넘기는 구조로
// 바뀌면서 이 필드는 아예 안 씀 — 여기선 100g당 실측값과 유사도만 반환한다.

// difflib.SequenceMatcher와 똑같지는 않지만 비슷한 역할을 하는 bigram 기반
// Dice 유사도. 한글 음절 단위로도 잘 동작해서 이 정도면 충분하다고 판단.
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const setA = bigrams(a);
  const setB = bigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let overlap = 0;
  for (const bg of setA) if (setB.has(bg)) overlap++;
  return (2 * overlap) / (setA.size + setB.size);
}

export const SIMILARITY_LOW = 0.25;

// data.go.kr 키는 .env/.dev.vars에 URL-인코딩된 형태(%2B, %3D 등)로 저장돼있어서
// (파이썬 쪽 FOOD_SAFETY_API_KEY와 동일한 값), 한 번 디코딩한 뒤 fetch가 다시
// 인코딩하게 둬야 한다 — 그대로 쓰면 이중 인코딩돼서 인증이 깨진다.
function decodeServiceKey(rawKey: string): string {
  return decodeURIComponent(rawKey);
}

interface ApiItem {
  FOOD_NM_KR: string;
  AMT_NUM1: string; // kcal
  AMT_NUM3: string; // protein
  AMT_NUM4: string; // fat
  AMT_NUM6: string; // carb
}

// 검색어로 최대 10건까지 후보를 받아와서, 이름이 제일 비슷한 것을 고른다.
// 최고 유사도가 SIMILARITY_LOW보다 낮으면 "이 검색으론 못 찾은 것"으로 보고 null.
export async function lookupBest(
  query: string,
  serviceKey: string,
): Promise<DbLookupResult | null> {
  const url = new URL(
    "https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo02/getFoodNtrCpntDbInq02",
  );
  url.searchParams.set("serviceKey", decodeServiceKey(serviceKey));
  url.searchParams.set("FOOD_NM_KR", query);
  url.searchParams.set("numOfRows", "10");
  url.searchParams.set("pageNo", "1");
  url.searchParams.set("type", "json");

  const resp = await fetch(url.toString());
  if (!resp.ok) {
    console.error(`식약처 DB 조회 실패 (${resp.status}): ${await resp.text()}`);
    return null;
  }

  const data = (await resp.json()) as {
    body?: { items?: ApiItem[] | { item: ApiItem[] } };
  };
  const rawItems = data.body?.items;
  const items: ApiItem[] = Array.isArray(rawItems)
    ? rawItems
    : (rawItems?.item ?? []);
  if (items.length === 0) return null;

  let best: { item: ApiItem; score: number } | null = null;
  for (const item of items) {
    const score = similarity(query, item.FOOD_NM_KR);
    if (!best || score > best.score) best = { item, score };
  }
  if (!best || best.score < SIMILARITY_LOW) return null;

  return {
    matchedName: best.item.FOOD_NM_KR,
    kcalPer100g: Number(best.item.AMT_NUM1) || 0,
    proteinPer100g: Number(best.item.AMT_NUM3) || 0,
    fatPer100g: Number(best.item.AMT_NUM4) || 0,
    carbPer100g: Number(best.item.AMT_NUM6) || 0,
    similarity: Math.round(best.score * 100) / 100,
  };
}
