CREATE TABLE IF NOT EXISTS weekly_menus (
  week_start TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'draft',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS menu_images (
  id         TEXT PRIMARY KEY,
  week_start TEXT NOT NULL,
  r2_key     TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
