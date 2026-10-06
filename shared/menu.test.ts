import { describe, expect, it } from "vitest";
import {
  type WeeklyMenu,
  daysBetweenISO,
  shiftMenuToWeekStart,
} from "./menu";

const sample: WeeklyMenu = {
  weekStart: "2026-08-17",
  weekEnd: "2026-08-21",
  days: [
    { date: "2026-08-17", weekday: "월", lunch: { dishes: [{ name: "A", isMain: true }] } },
    { date: "2026-08-18", weekday: "화", lunch: { dishes: [{ name: "B", isMain: true }] } },
    { date: "2026-08-19", weekday: "수", lunch: { dishes: [{ name: "C", isMain: true }] } },
    { date: "2026-08-20", weekday: "목", lunch: { dishes: [{ name: "D", isMain: true }] } },
    { date: "2026-08-21", weekday: "금", lunch: { dishes: [{ name: "E", isMain: true }] } },
  ],
};

describe("daysBetweenISO", () => {
  it("두 날짜 사이 일수 차를 준다", () => {
    expect(daysBetweenISO("2026-08-17", "2026-08-24")).toBe(7);
    expect(daysBetweenISO("2026-08-24", "2026-08-17")).toBe(-7);
    expect(daysBetweenISO("2026-08-17", "2026-08-17")).toBe(0);
  });
});

describe("shiftMenuToWeekStart", () => {
  it("주 시작일을 옮기면 각 날짜가 같은 간격으로 이동하고 요일이 재계산된다", () => {
    const r = shiftMenuToWeekStart(sample, "2026-08-24");
    expect(r.weekStart).toBe("2026-08-24");
    expect(r.weekEnd).toBe("2026-08-28");
    expect(r.days.map((d) => d.date)).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
    ]);
    // 월~금 요일은 +7일이어도 그대로
    expect(r.days.map((d) => d.weekday)).toEqual(["월", "화", "수", "목", "금"]);
    // 메뉴 내용은 보존
    expect(r.days[0].lunch?.dishes[0].name).toBe("A");
  });

  it("원본을 변형하지 않는다(불변)", () => {
    shiftMenuToWeekStart(sample, "2026-09-07");
    expect(sample.weekStart).toBe("2026-08-17");
    expect(sample.days[0].date).toBe("2026-08-17");
  });
});
