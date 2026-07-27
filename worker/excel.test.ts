import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseWeeklyExcel } from "./excel";

const fixturePath = fileURLToPath(
  new URL("../automation/samples/sample-2026-07-27.xlsx", import.meta.url),
);
const menu = parseWeeklyExcel(readFileSync(fixturePath));

describe("parseWeeklyExcel — 실제 샘플(2026-07-27 주간표)", () => {
  it("주 범위·요일이 정확하다", () => {
    expect(menu.weekStart).toBe("2026-07-27");
    expect(menu.weekEnd).toBe("2026-07-31");
    expect(menu.days.map((d) => d.date)).toEqual([
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
    ]);
    expect(menu.days.map((d) => d.weekday)).toEqual(["월", "화", "수", "목", "금"]);
    expect(menu.days.some((d) => d.isHoliday)).toBe(false);
  });

  it("월요일 중식: 메뉴·메인·원산지·후식이 원문 그대로", () => {
    const mon = menu.days[0];
    expect(mon.lunch?.dishes.map((d) => d.name)).toEqual([
      "짜장밥",
      "야채짬뽕국",
      "모듬탕수*소스",
      "청경채굴소스볶음",
      "반달단무지",
      "포기김치",
      "샐러드*드레싱*토핑",
    ]);
    expect(
      mon.lunch?.dishes.filter((d) => d.isMain).map((d) => d.name),
    ).toEqual(["짜장밥", "야채짬뽕국"]);
    expect(mon.lunch?.origin).toContain("돈육:국내산");
    expect(mon.dessert).toBe("결명자차");
  });

  it("월요일 석식: 메인은 상단 2개 행", () => {
    const mon = menu.days[0];
    expect(mon.dinner?.dishes.map((d) => d.name)).toEqual([
      "순살감자탕",
      "메밀전병",
      "쌀밥",
      "청포묵무침",
      "고추쌈장무침",
      "깍두기",
    ]);
    expect(
      mon.dinner?.dishes.filter((d) => d.isMain).map((d) => d.name),
    ).toEqual(["순살감자탕", "메밀전병"]);
  });

  it("금요일: 중식/석식 메인 + 후식", () => {
    const fri = menu.days[4];
    expect(
      fri.lunch?.dishes.filter((d) => d.isMain).map((d) => d.name),
    ).toEqual(["매콤돈육장조림", "근대된장국"]);
    expect(fri.dinner?.dishes.map((d) => d.name)).toContain("돈코츠라멘*시치미");
    expect(
      fri.dinner?.dishes.filter((d) => d.isMain).map((d) => d.name),
    ).toEqual(["돈코츠라멘*시치미", "타코야끼*소스"]);
    expect(fri.dessert).toBe("쟈스민차");
  });

  it("안내문(notes) 3줄 포함", () => {
    expect(menu.notes?.length).toBe(3);
    expect(menu.notes?.[0]).toContain("국내산");
  });

  it("전체 스냅샷(회귀 방지)", () => {
    expect(menu).toMatchSnapshot();
  });

  it("메뉴를 하나도 못 읽으면 에러(빈/비정상 파일 차단)", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["주 간 메 뉴 표"], []]),
      "empty",
    );
    const buf = XLSX.write(wb, {
      type: "array",
      bookType: "xlsx",
    }) as Uint8Array;
    expect(() => parseWeeklyExcel(buf, "2026-07-27")).toThrow(/메뉴를 하나도/);
  });
});
