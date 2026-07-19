import type { WeeklyMenu } from "../../shared/menu";

export async function fetchCurrentWeek(): Promise<WeeklyMenu | null> {
  const res = await fetch("/api/menus/current");
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`식단표를 불러오지 못했어요 (${res.status})`);
  }
  return (await res.json()) as WeeklyMenu;
}
