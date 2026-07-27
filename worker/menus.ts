import type { WeeklyMenu } from "../shared/menu";

export async function getPublishedWeek(
  db: D1Database,
  weekStart: string,
): Promise<WeeklyMenu | null> {
  const row = await db
    .prepare(
      "SELECT data FROM weekly_menus WHERE week_start = ? AND status = 'published'",
    )
    .bind(weekStart)
    .first<{ data: string }>();
  return row ? (JSON.parse(row.data) as WeeklyMenu) : null;
}

// 홈에는 가장 최근에 발행된 주(week_start 최신)를 노출한다.
// 관리자가 다음 주를 발행하면 즉시 반영된다.
export async function getLatestWeek(
  db: D1Database,
): Promise<WeeklyMenu | null> {
  const row = await db
    .prepare(
      "SELECT data FROM weekly_menus WHERE status = 'published' ORDER BY week_start DESC LIMIT 1",
    )
    .first<{ data: string }>();
  return row ? (JSON.parse(row.data) as WeeklyMenu) : null;
}

export async function saveWeek(
  db: D1Database,
  menu: WeeklyMenu,
  imageKey?: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO weekly_menus (week_start, data, status, updated_at)
       VALUES (?, ?, 'published', datetime('now'))
       ON CONFLICT(week_start) DO UPDATE SET
         data = excluded.data,
         status = 'published',
         updated_at = datetime('now')`,
    )
    .bind(menu.weekStart, JSON.stringify(menu))
    .run();

  if (imageKey) {
    await db
      .prepare(
        "INSERT INTO menu_images (id, week_start, r2_key) VALUES (?, ?, ?)",
      )
      .bind(crypto.randomUUID(), menu.weekStart, imageKey)
      .run();
  }
}

// 자동 검증에서 이상이 감지된 주를 "보류(draft)"로 저장한다(관리자 검토 대기).
// 이미 published 된 주는 절대 덮어쓰지 않는다(끝의 WHERE 가드) — 수동 발행본 보호.
export async function saveDraft(
  db: D1Database,
  menu: WeeklyMenu,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO weekly_menus (week_start, data, status, updated_at)
       VALUES (?, ?, 'draft', datetime('now'))
       ON CONFLICT(week_start) DO UPDATE SET
         data = excluded.data,
         updated_at = datetime('now')
       WHERE weekly_menus.status = 'draft'`,
    )
    .bind(menu.weekStart, JSON.stringify(menu))
    .run();
}

// 검토 대기 중인 보류 주 목록(최신 주부터).
export async function getPendingDrafts(db: D1Database): Promise<WeeklyMenu[]> {
  const rows = await db
    .prepare(
      "SELECT data FROM weekly_menus WHERE status = 'draft' ORDER BY week_start DESC",
    )
    .all<{ data: string }>();
  return (rows.results ?? []).map((r) => JSON.parse(r.data) as WeeklyMenu);
}

// 상태와 무관하게 특정 주를 조회(발행 여부 확인·검토 화면 로드용).
export async function getWeekAnyStatus(
  db: D1Database,
  weekStart: string,
): Promise<{ menu: WeeklyMenu; status: string } | null> {
  const row = await db
    .prepare("SELECT data, status FROM weekly_menus WHERE week_start = ?")
    .bind(weekStart)
    .first<{ data: string; status: string }>();
  return row
    ? { menu: JSON.parse(row.data) as WeeklyMenu, status: row.status }
    : null;
}
