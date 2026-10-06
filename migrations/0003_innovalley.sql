-- 사외 식당(이노밸리) 주간 중식. 카카오 채널 게시글 1건 = 1주.
-- 웹 화면 연동 전까지는 SKALA 식단(weekly_menus)과 분리해 둔다.
-- status: 'published'(슬랙 발송 대상) | 'held'(검증 실패 또는 추출 오류, 관리자 확인 필요)
CREATE TABLE IF NOT EXISTS innovalley_menus (
  week_start TEXT PRIMARY KEY,
  post_id    TEXT NOT NULL,
  post_url   TEXT NOT NULL DEFAULT '',
  image_url  TEXT NOT NULL,
  data       TEXT,                       -- InnovalleyWeek JSON (추출 오류면 NULL)
  status     TEXT NOT NULL,
  reasons    TEXT NOT NULL DEFAULT '[]', -- JSON string[] (보류 사유)
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 날짜별 슬랙 발송 기록. 월요일엔 메뉴가 늦게 올라와 여러 번 확인하므로 중복 발송을 막는다.
CREATE TABLE IF NOT EXISTS innovalley_notified (
  date    TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
