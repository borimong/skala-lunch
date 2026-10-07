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

export interface PendingDraft {
  menu: WeeklyMenu;
  reasons: string[]; // 보류 사유(검증 하드에러 또는 AI 교차검증 불일치)
  createdAt: string;
}

// 자동 검증에서 이상이 감지된 주를 "보류(draft)"로 저장한다(관리자 검토 대기).
// 발행본(weekly_menus)과 분리된 pending_drafts에 담기므로, 파싱된 주가 이미 발행된 주와
// 겹쳐도 초안이 사라지지 않는다. 같은 주가 다시 들어오면 최신 내용으로 덮어쓴다.
export async function saveDraft(
  db: D1Database,
  menu: WeeklyMenu,
  reasons: string[] = [],
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO pending_drafts (week_start, data, reasons, created_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(week_start) DO UPDATE SET
         data = excluded.data,
         reasons = excluded.reasons,
         created_at = datetime('now')`,
    )
    .bind(menu.weekStart, JSON.stringify(menu), JSON.stringify(reasons))
    .run();
}

function parseReasons(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// 검토 대기 중인 보류 초안 목록(최신 주부터). 각 항목에 보류 사유를 함께 담는다.
export async function getPendingDrafts(db: D1Database): Promise<PendingDraft[]> {
  const rows = await db
    .prepare(
      "SELECT data, reasons, created_at FROM pending_drafts ORDER BY week_start DESC",
    )
    .all<{ data: string; reasons: string; created_at: string }>();
  return (rows.results ?? []).map((r) => ({
    menu: JSON.parse(r.data) as WeeklyMenu,
    reasons: parseReasons(r.reasons),
    createdAt: r.created_at,
  }));
}

// 보류 초안 삭제(발행 완료 또는 관리자가 "무시"할 때).
export async function deletePendingDraft(
  db: D1Database,
  weekStart: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM pending_drafts WHERE week_start = ?")
    .bind(weekStart)
    .run();
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
