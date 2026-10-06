import { z } from "zod";
import { dishSchema } from "./menu";

// 사외 식당(이노밸리) 주간 중식. 카카오 채널에 주 1회 올라오는 메뉴 이미지에서 추출한다.
// SKALA 식당과 달리 중식이 코너(한식, 양식, 면, 샐러드바) 단위로 나뉘어 있어 스키마를 따로 둔다.

export const cornerSchema = z.object({
  name: z.string(),
  dishes: z.array(dishSchema),
});

export const innovalleyDaySchema = z.object({
  date: z.string(),
  weekday: z.string(),
  label: z.string().optional(),
  isHoliday: z.boolean().optional(),
  corners: z.array(cornerSchema).default([]),
});

export const innovalleyWeekSchema = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  days: z.array(innovalleyDaySchema),
});

export type Corner = z.infer<typeof cornerSchema>;
export type InnovalleyDay = z.infer<typeof innovalleyDaySchema>;
export type InnovalleyWeek = z.infer<typeof innovalleyWeekSchema>;
