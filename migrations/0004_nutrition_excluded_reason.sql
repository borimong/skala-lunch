-- 2026-09-10: GPT 에이전트가 "이 요리는 다른 메뉴에 이미 포함돼서 총합에서
-- 빼야 한다"고 판단한 경우(예: 국밥 메인메뉴 + 별도 쌀밥) 그 이유를 저장.
ALTER TABLE dish_nutrition ADD COLUMN excluded_reason TEXT;
