import { z } from "zod";

export const dishSchema = z.object({
  name: z.string(),
  isMain: z.boolean().default(false),
});

export const mealSchema = z.object({
  dishes: z.array(dishSchema),
  origin: z.string().optional(),
});

export const daySchema = z.object({
  date: z.string(),
  weekday: z.string(),
  label: z.string().optional(),
  isHoliday: z.boolean().optional(),
  lunch: mealSchema.optional(),
  dinner: mealSchema.optional(),
  dessert: z.string().optional(),
});

export const weeklyMenuSchema = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  cafeteria: z.string().optional(),
  days: z.array(daySchema),
  notes: z.array(z.string()).optional(),
});

export type Dish = z.infer<typeof dishSchema>;
export type Meal = z.infer<typeof mealSchema>;
export type Day = z.infer<typeof daySchema>;
export type WeeklyMenu = z.infer<typeof weeklyMenuSchema>;

export const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function weekdayKo(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00`);
  return WEEKDAYS_KO[d.getDay()];
}

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function mondayOf(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00`);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return toISODate(d);
}

export function addDaysISO(dateISO: string, n: number): string {
  const d = new Date(`${dateISO}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

// 두 ISO 날짜 사이의 일수 차(toISO - fromISO).
export function daysBetweenISO(fromISO: string, toISO: string): number {
  const a = new Date(`${fromISO}T00:00:00`).getTime();
  const b = new Date(`${toISO}T00:00:00`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * 주간 식단을 다른 주 시작일로 "재date"한다. 각 날짜를 같은 간격만큼 옮기고 요일을 재계산한다.
 * (엑셀 날짜 칸이 잘못 와서 엉뚱한 주로 파싱된 보류 건을 관리자가 교정해 발행할 때 사용.)
 */
export function shiftMenuToWeekStart(
  menu: WeeklyMenu,
  newWeekStart: string,
): WeeklyMenu {
  const shift = daysBetweenISO(menu.weekStart, newWeekStart);
  return {
    ...menu,
    weekStart: newWeekStart,
    weekEnd: addDaysISO(newWeekStart, 4),
    days: menu.days.map((d) => {
      const date = addDaysISO(d.date, shift);
      return { ...d, date, weekday: weekdayKo(date) };
    }),
  };
}
