import type { WeeklyMenu } from "../../shared/menu";

const TOKEN_KEY = "skala-admin-token";

export const getAdminToken = (): string =>
  localStorage.getItem(TOKEN_KEY) ?? "";
export const setAdminToken = (token: string): void =>
  localStorage.setItem(TOKEN_KEY, token);
export const clearAdminToken = (): void => localStorage.removeItem(TOKEN_KEY);

function authHeader(token = getAdminToken()): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  const res = await fetch("/api/admin/verify", { headers: authHeader(token) });
  return res.ok;
}

export async function extractMenuFromImage(
  image: Blob,
  weekStart: string,
): Promise<{ menu: WeeklyMenu; imageKey: string }> {
  const form = new FormData();
  form.append("image", image, "menu.jpg");
  form.append("weekStart", weekStart);
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: authHeader(),
    body: form,
  });
  const data = (await res.json()) as {
    menu?: WeeklyMenu;
    imageKey?: string;
    error?: string;
  };
  if (!res.ok || !data.menu) {
    throw new Error(data.error ?? `추출에 실패했어요 (${res.status})`);
  }
  return { menu: data.menu, imageKey: data.imageKey ?? "" };
}

export async function publishMenu(
  menu: WeeklyMenu,
  imageKey?: string,
): Promise<void> {
  const res = await fetch("/api/menus", {
    method: "POST",
    headers: { ...authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ menu, imageKey }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `발행에 실패했어요 (${res.status})`);
  }
}
