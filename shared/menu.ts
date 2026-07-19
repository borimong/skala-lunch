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
