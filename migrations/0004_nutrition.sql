-- 요리 -> 탄단지/칼로리 추정치 캐시 테이블.
--
-- 키를 food_name 하나가 아니라 (date, meal_type, food_name)으로 둔다.
-- 같은 요리 이름(예: "김치")이라도 끼니마다 에이전트가 정한 제공량이 다를 수 있어서,
-- 이름만 키로 쓰면 나중에 계산한 끼니가 앞 끼니의 값을 덮어쓴다.
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
