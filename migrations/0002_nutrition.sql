-- 요리 -> 탄단지/칼로리 추정치 캐시 테이블.
--
-- 2026-09-09에 food_name 단일 PK에서 (date, meal_type, food_name) 복합키로
-- 변경함. 이유: 끼니 총 칼로리가 너무 높으면(worker/nutrition.ts의
-- reviewMealIfTooHigh) 그 끼니에 맞춰 반찬 제공량을 재보정하는데, 같은
-- 요리 이름(예: "김치")이 서로 다른 끼니에 나오면 끼니마다 재보정 결과가
-- 달라질 수 있음. food_name만 키로 쓰면 나중에 처리된 끼니의 값이 이전
-- 끼니의 캐시를 덮어써버려서 부정확해짐 — "간단한 버전"으로 만들 때는
-- 이 부정확함을 감수하기로 했었지만, 정확도가 더 중요하다고 판단해서
-- 끼니 단위로 완전히 독립된 값을 갖도록 정확한 키로 바꿈.
CREATE TABLE IF NOT EXISTS dish_nutrition (
  date       TEXT NOT NULL,   -- YYYY-MM-DD, 그 요리가 나온 날짜
  meal_type  TEXT NOT NULL,   -- 'lunch' | 'dinner'
  food_name  TEXT NOT NULL,
  serving_g  REAL NOT NULL,
  carb_g     REAL NOT NULL,
  protein_g  REAL NOT NULL,
  fat_g      REAL NOT NULL,
  kcal       INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, meal_type, food_name)
);
