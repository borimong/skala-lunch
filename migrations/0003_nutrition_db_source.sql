-- 2026-09-09: "DB조회를 반드시 해야 한다"는 결정에 따라 식약처 DB 직접조회
-- 경로를 다시 넣으면서, 어느 경로로 계산됐는지(source)와 신뢰도(reliability),
-- 이상치 의심 여부(outlier)를 dish_nutrition에 같이 저장하도록 컬럼 추가.
ALTER TABLE dish_nutrition ADD COLUMN source TEXT NOT NULL DEFAULT 'gpt_estimate';
ALTER TABLE dish_nutrition ADD COLUMN reliability TEXT NOT NULL DEFAULT 'low';
ALTER TABLE dish_nutrition ADD COLUMN outlier INTEGER NOT NULL DEFAULT 0;

-- 요리별로 "어떤 판단을 했는지"(DB 매칭 후보/유사도, GPT 힌트/원본 응답 등)를
-- 사람이 읽을 수 있는 마크다운으로 남기는 추적 로그. 최종 계산값만 보면
-- "왜 이 숫자가 나왔는지" 역추적이 안 돼서 추가함(worker/nutrition.ts 참고).
CREATE TABLE IF NOT EXISTS nutrition_trace (
  date       TEXT NOT NULL,
  meal_type  TEXT NOT NULL,
  trace_md   TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, meal_type)
);
