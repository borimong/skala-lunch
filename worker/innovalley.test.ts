import { describe, expect, it } from "vitest";
import type { InnovalleyWeek } from "../shared/innovalley";
import {
  buildInnovalleyPayload,
  isLastInnovalleyRun,
  validateInnovalley,
} from "./innovalley";

// 2026-10-05 주 실제 이미지 기준(월 대체공휴일, 금 한글날)
function sampleWeek(): InnovalleyWeek {
  const lunch = (main: string) => [
    {
      name: "한식",
      dishes: [
        { name: "흑미밥/쌀밥", isMain: false },
        { name: "근대된장국", isMain: false },
        { name: main, isMain: true },
      ],
    },
    {
      name: "양식",
      dishes: [{ name: "참치마요덮밥", isMain: true }],
    },
    {
      name: "면",
      dishes: [{ name: "얼큰짬뽕", isMain: true }],
    },
    {
      name: "샐러드바",
      dishes: [{ name: "그린샐러드&드레싱2종", isMain: false }],
    },
  ];
  return {
    weekStart: "2026-10-05",
    weekEnd: "2026-10-09",
    days: [
      {
        date: "2026-10-05",
        weekday: "월",
        isHoliday: true,
        label: "대체공휴일",
        corners: [],
      },
      { date: "2026-10-06", weekday: "화", corners: lunch("돈채김치볶음") },
      { date: "2026-10-07", weekday: "수", corners: lunch("안동찜닭") },
      {
        date: "2026-10-08",
        weekday: "목",
        corners: lunch("통마늘고기산적조림"),
      },
      {
        date: "2026-10-09",
        weekday: "금",
        isHoliday: true,
        label: "한글날",
        corners: [],
      },
    ],
  };
}

describe("validateInnovalley", () => {
  it("정상 주는 통과한다(휴무일은 비어 있어도 됨)", () => {
    const v = validateInnovalley(sampleWeek(), "2026-10-05");
    expect(v.hardErrors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("이미지 제목처럼 지난주 날짜로 읽히면 보류한다", () => {
    const week = sampleWeek();
    week.days = week.days.map((d, i) => ({
      ...d,
      date: [
        "2026-09-28",
        "2026-09-29",
        "2026-09-30",
        "2026-10-01",
        "2026-10-02",
      ][i],
    }));
    const v = validateInnovalley(week, "2026-10-05");
    expect(v.ok).toBe(false);
    expect(v.hardErrors.some((e) => e.includes("요일 누락"))).toBe(true);
  });

  it("영업일인데 중식이 비어 있으면 보류한다", () => {
    const week = sampleWeek();
    week.days[1].corners = [];
    expect(validateInnovalley(week, "2026-10-05").hardErrors).toContain(
      "중식이 비어 있습니다: 2026-10-06",
    );
  });

  it("요일 표기가 날짜와 다르면 보류한다", () => {
    const week = sampleWeek();
    week.days[2].weekday = "목";
    expect(validateInnovalley(week, "2026-10-05").ok).toBe(false);
  });

  it("주 전체가 휴무로 읽히면 보류한다", () => {
    const week = sampleWeek();
    week.days = week.days.map((d) => ({ ...d, isHoliday: true, corners: [] }));
    expect(validateInnovalley(week, "2026-10-05").ok).toBe(false);
  });

  it("메인 표기가 없는 코너는 경고만 한다(샐러드바 제외)", () => {
    const week = sampleWeek();
    week.days[1].corners[1].dishes[0].isMain = false;
    const v = validateInnovalley(week, "2026-10-05");
    expect(v.ok).toBe(true);
    expect(v.softWarnings).toEqual([
      "2026-10-06 양식 코너에 메인 표기가 없습니다",
    ]);
  });
});

describe("buildInnovalleyPayload", () => {
  const day = sampleWeek().days[1];
  const payload = buildInnovalleyPayload(
    day,
    "https://pf.kakao.com/_LCxlxlxb/114799834",
  );
  const texts = payload.blocks.map(
    (b) =>
      (b.text as { text?: string } | undefined)?.text ??
      (b.elements as { text: string }[] | undefined)?.[0]?.text ??
      "",
  );

  it("헤더에 식당과 날짜가 들어간다", () => {
    expect(texts[0]).toBe("🍽️ 이노밸리 중식 · 10/06 (화)");
  });

  it("코너마다 섹션이 생기고 메인이 굵게 맨 앞에 온다", () => {
    expect(texts[1]).toBe(
      "*🍚 한식*\n*돈채김치볶음* · 흑미밥/쌀밥 · 근대된장국",
    );
    expect(texts[4]).toBe("*🥗 샐러드바*\n그린샐러드&amp;드레싱2종");
  });

  it("맨 아래에 카카오 원본 링크가 붙는다", () => {
    expect(texts.at(-1)).toBe(
      "<https://pf.kakao.com/_LCxlxlxb/114799834|주간 메뉴 원본 보기>",
    );
  });
});

describe("isLastInnovalleyRun", () => {
  it("12:40 KST 실행만 마지막으로 본다", () => {
    expect(isLastInnovalleyRun(new Date("2026-10-06T03:40:05Z"))).toBe(true);
    expect(isLastInnovalleyRun(new Date("2026-10-06T03:20:00Z"))).toBe(false);
    expect(isLastInnovalleyRun(new Date("2026-10-05T23:00:00Z"))).toBe(false);
  });
});
