-- 식약처 DB 검색어 -> 매칭 결과 캐시. 같은 검색어는 결과가 바뀌지 않으니 한 번 찾은 값을 재사용해서
-- API 호출을 줄이고, 같은 요리가 날마다 다른 DB 항목에 매칭되는 일도 막는다.
-- result가 NULL이면 "검색했지만 못 찾음"(이것도 저장해서 반복 검색을 막음).
CREATE TABLE IF NOT EXISTS food_db_cache (
  query TEXT PRIMARY KEY,
  result TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
