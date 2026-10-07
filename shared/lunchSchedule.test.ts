import { describe, expect, it } from "vitest";
import { lunchScheduleFor } from "./lunchSchedule";

describe("lunchScheduleFor", () => {
  it("공지 구간 안의 날짜는 시간대별 반 순서를 돌려준다", () => {
    expect(lunchScheduleFor("2026-10-06")).toEqual([
      { time: "11:50", classes: [2] },
      { time: "12:00", classes: [3, 4] },
      { time: "12:10", classes: [5, 1] },
    ]);
  });

  it("구간 양끝 날짜도 포함한다", () => {
    expect(lunchScheduleFor("2026-09-07")?.[0].classes).toEqual([4]);
    expect(lunchScheduleFor("2026-10-23")?.[0].classes).toEqual([4]);
  });

  it("공휴일로 끊긴 두 구간은 같은 순서를 쓴다", () => {
    expect(lunchScheduleFor("2026-09-22")).toEqual(
      lunchScheduleFor("2026-09-28"),
    );
  });

  it("구간 사이 휴일과 운영 기간 밖은 null", () => {
    expect(lunchScheduleFor("2026-09-24")).toBeNull();
    expect(lunchScheduleFor("2026-10-09")).toBeNull();
    expect(lunchScheduleFor("2026-09-04")).toBeNull();
    expect(lunchScheduleFor("2026-10-26")).toBeNull();
  });
});
