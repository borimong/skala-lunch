-- 보류(검토 대기) 초안을 발행 테이블과 분리 보관한다.
-- weekly_menus 는 week_start 가 PK라, 파싱된 주가 "이미 발행된 주"와 겹치면
-- 초안이 저장되지 못하고 조용히 사라지는 문제가 있었다(알림은 갔는데 /admin/pending 은 빈 상태).
-- 초안을 별도 테이블에 두면 발행본과 절대 충돌하지 않고, 보류 사유도 함께 남길 수 있다.
CREATE TABLE IF NOT EXISTS pending_drafts (
  week_start TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  reasons    TEXT NOT NULL DEFAULT '[]', -- JSON string[] (보류 사유)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
