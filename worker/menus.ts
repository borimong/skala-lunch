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
