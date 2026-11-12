import { describe, expect, it } from "vitest";
import type { InnovalleyWeek } from "../shared/innovalley";
import {
  type InnovalleyGrid,
  buildInnovalleyPayload,
  gridToWeek,
  isLastInnovalleyRun,
  mergeReads,
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

describe("gridToWeek", () => {
  const cols = [
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
    "2026-11-13",
  ];
  const row = (cornerLabel: string, text: string) => ({
    cornerLabel,
    cells: cols.map((_, i) => ({
      text: i === 4 ? "" : `${text}${i}`,
      isMain: false,
    })),
  });
  const grid = (rows: InnovalleyGrid["rows"]): InnovalleyGrid => ({
    columns: cols.map((date, i) => ({
      date,
      weekday: "월화수목금"[i],
      isHoliday: i === 4,
      ...(i === 4 && { label: "휴무" }),
    })),
    rows,
  });
  const cornerOf = (week: InnovalleyWeek, dish: string) =>
    week.days[0].corners.find((c) => c.dishes.some((d) => d.name === dish))
      ?.name;

  it("마지막 요리가 숭늉이면 이름표와 상관없이 아래 세 개를 샐러드바로 묶는다", () => {
    const week = gridToWeek(
      grid([
        row("Korean (한식)", "밥"),
        row("Western (양식)", "필라프"),
        row("Noodle (대면)", "국밥"),
        row("Noodle (대면)", "빼빼로"),
        row("Noodle (대면)", "알새우칩"),
        row("샐러드바", "현미밥/보리밥/숭늉/차"),
      ]),
      "2026-11-09",
    );
    expect(cornerOf(week, "국밥0")).toBe("면");
    expect(cornerOf(week, "빼빼로0")).toBe("샐러드바");
    expect(cornerOf(week, "알새우칩0")).toBe("샐러드바");
    expect(week.days[0].corners.map((c) => c.name)).toEqual([
      "한식",
      "양식",
      "면",
      "샐러드바",
    ]);
  });

  it("면 코너 빈 칸 때문에 요리가 한 줄씩 당겨져도 날짜별로 아래 세 개를 샐러드바로 묶는다", () => {
    const g = grid([
      row("Noodle (대면)", "우동"),
      row("Noodle (대면)", "쌀밥"),
      row("Noodle (대면)", "춘권"),
      row("샐러드바", "쌈"),
      row("샐러드바", "식빵"),
      row("샐러드바", "현미밥/보리밥/숭늉/차"),
    ]);
    // 첫 날만 면의 빈 칸을 건너뛰어 '쌈'이 면 줄로, 샐러드바 둘째 줄이 비게 읽힌 상황
    g.rows[2].cells[0].text = "쌈0";
    g.rows[3].cells[0].text = "식빵0";
    g.rows[4].cells[0].text = "";
    g.rows[1].cells[0].text = "춘권0";
    const week = gridToWeek(g, "2026-11-09");
    const byCorner = Object.fromEntries(
      week.days[0].corners.map((c) => [c.name, c.dishes.map((d) => d.name)]),
    );
    expect(byCorner).toEqual({
      면: ["우동0", "춘권0"],
      샐러드바: ["쌈0", "식빵0", "현미밥/보리밥/숭늉/차0"],
    });
  });

  it("숭늉 줄이 없으면(양식 변경) 이름표를 따른다", () => {
    const week = gridToWeek(
      grid([
        row("Korean (한식)", "밥"),
        row("Noodle (대면)", "국밥"),
        row("샐러드바", "샐러드"),
        row("샐러드바", "과일"),
      ]),
      "2026-11-09",
    );
    expect(cornerOf(week, "국밥0")).toBe("면");
    expect(cornerOf(week, "샐러드0")).toBe("샐러드바");
  });

  it("한 칸에 줄바꿈으로 합쳐진 요리는 나눈다", () => {
    const g = grid([row("Korean (한식)", "밥")]);
    g.rows[0].cells[0].text = "흑미밥/쌀밥\n미역국";
    const week = gridToWeek(g, "2026-11-09");
    expect(week.days[0].corners[0].dishes.map((d) => d.name)).toEqual([
      "흑미밥/쌀밥",
      "미역국",
    ]);
  });

  it("휴무 열은 코너를 비우고 빈 칸은 넣지 않는다", () => {
    const week = gridToWeek(grid([row("Korean (한식)", "밥")]), "2026-11-09");
    expect(week.days[4]).toMatchObject({
      isHoliday: true,
      label: "휴무",
      corners: [],
    });
    expect(week.weekEnd).toBe("2026-11-13");
  });
});

describe("mergeReads", () => {
  const read = (
    korean: string[],
    extra: Partial<InnovalleyWeek["days"][number]> = {},
  ): InnovalleyWeek => ({
    weekStart: "2026-11-09",
    weekEnd: "2026-11-13",
    days: [
      {
        date: "2026-11-11",
        weekday: "수",
        corners: [
          {
            name: "한식",
            dishes: korean.map((name, i) => ({ name, isMain: i === 0 })),
          },
        ],
        ...extra,
      },
    ],
  });
  const korean = (w: InnovalleyWeek) =>
    w.days[0].corners[0].dishes.map((d) => d.name);

  it("모두 같으면 그대로 두고 갈린 곳도 없다", () => {
    const r = mergeReads([
      read(["뼈있는닭갈비", "미역국"]),
      read(["뼈있는닭갈비", "미역국"]),
      read(["뼈있는닭갈비", "미역국"]),
    ]);
    expect(korean(r.week)).toEqual(["뼈있는닭갈비", "미역국"]);
    expect(r.week.days[0].corners[0].dishes[0].isMain).toBe(true);
    expect(r.disagreements).toEqual([]);
  });

  it("갈리면 다수 쪽으로 넣고 후보와 횟수를 알려준다", () => {
    const r = mergeReads([
      read(["뼈없는닭갈비", "미역국"]),
      read(["뼈있는닭갈비", "미역국"]),
      read(["뼈있는닭갈비", "미역국"]),
    ]);
    expect(korean(r.week)).toEqual(["뼈있는닭갈비", "미역국"]);
    expect(r.disagreements).toEqual([
      "11-11(수) 한식: 뼈없는닭갈비 1회, 뼈있는닭갈비 2회",
    ]);
  });

  it("띄어쓰기만 다른 이름은 같은 요리로 본다", () => {
    const r = mergeReads([
      read(["꼬치어묵우동 (꼬치 2개씩)"]),
      read(["꼬치어묵우동(꼬치2개씩)"]),
      read(["꼬치어묵우동(꼬치2개씩)"]),
    ]);
    expect(r.disagreements).toEqual([]);
  });

  it("요리 개수가 다르면 다수 개수끼리만 비교하고 알려준다", () => {
    const r = mergeReads([
      read(["밥", "국"]),
      read(["밥", "국", "빼빼로"]),
      read(["밥", "국"]),
    ]);
    expect(korean(r.week)).toEqual(["밥", "국"]);
    expect(r.disagreements).toEqual([
      "11-11(수) 한식: 요리 개수가 읽을 때마다 달라요 (2개, 3개, 2개)",
    ]);
  });

  it("휴무 여부도 다수결로 정한다", () => {
    const holiday = read([], { isHoliday: true, label: "한글날", corners: [] });
    const r = mergeReads([holiday, read(["밥"]), holiday]);
    expect(r.week.days[0]).toMatchObject({ isHoliday: true, label: "한글날" });
    expect(r.disagreements).toEqual([
      "11-11(수): 휴무 여부가 읽을 때마다 달라요",
    ]);
  });
});
