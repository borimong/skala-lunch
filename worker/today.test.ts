import { describe, expect, it } from "vitest";
import type { WeeklyMenu } from "../shared/menu";
import { buildTodayResponse } from "./today";

const menu: WeeklyMenu = {
  weekStart: "2026-08-17",
  weekEnd: "2026-08-21",
  cafeteria: "본관 구내식당",
  days: [
    {
      date: "2026-08-17",
      weekday: "월",
      isHoliday: true,
      label: "광복절 대체휴일",
    },
    {
      date: "2026-08-18",
      weekday: "화",
      lunch: { dishes: [{ name: "청양풍돈육볶음", isMain: true }] },
      dinner: { dishes: [{ name: "소고기쌀국수", isMain: true }] },
      dessert: "요구르트",
    },
    { date: "2026-08-19", weekday: "수", lunch: { dishes: [] } },
  ],
};

describe("buildTodayResponse", () => {
  it("메뉴 있는 평일: hasMenu=true, 중/석식·후식·식당명 채워짐", () => {
    const r = buildTodayResponse("2026-08-18", menu);
    expect(r.hasMenu).toBe(true);
    expect(r.isHoliday).toBe(false);
    expect(r.cafeteria).toBe("본관 구내식당");
    expect(r.lunch?.dishes[0].name).toBe("청양풍돈육볶음");
    expect(r.dinner?.dishes[0].name).toBe("소고기쌀국수");
    expect(r.dessert).toBe("요구르트");
    expect(r.note).toBeNull();
  });

  it("휴무일: hasMenu=false, isHoliday=true, note=휴무 사유", () => {
    const r = buildTodayResponse("2026-08-17", menu);
    expect(r.hasMenu).toBe(false);
    expect(r.isHoliday).toBe(true);
    expect(r.note).toBe("광복절 대체휴일");
    expect(r.lunch).toBeNull();
  });

  it("메뉴가 비어있는 날: hasMenu=false, note 안내", () => {
    const r = buildTodayResponse("2026-08-19", menu);
    expect(r.hasMenu).toBe(false);
    expect(r.isHoliday).toBe(false);
    expect(r.lunch).toBeNull();
    expect(r.note).toBe("등록된 메뉴가 없어요");
  });

  it("주에 없는 날(주말): hasMenu=false, note=주말", () => {
    const r = buildTodayResponse("2026-08-23", menu);
    expect(r.hasMenu).toBe(false);
    expect(r.weekday).toBe("일");
    expect(r.note).toBe("주말");
  });

  it("발행된 주가 없음(null): hasMenu=false, note=미발행", () => {
    const r = buildTodayResponse("2026-08-18", null);
    expect(r.hasMenu).toBe(false);
    expect(r.note).toBe("미발행");
    expect(r.cafeteria).toBeUndefined();
  });
});
