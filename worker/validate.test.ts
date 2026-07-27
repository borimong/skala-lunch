import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { WeeklyMenu } from "../shared/menu";
import { parseWeeklyExcel } from "./excel";
import { validateMenu } from "./validate";

const fixturePath = fileURLToPath(
  new URL("../automation/samples/sample-2026-07-27.xlsx", import.meta.url),
);
const base = parseWeeklyExcel(readFileSync(fixturePath));
const clone = (): WeeklyMenu => structuredClone(base);
const EXPECTED = "2026-07-27";

describe("validateMenu — 검증 게이트(오파싱 차단)", () => {
  it("정상 데이터는 통과한다", () => {
    const r = validateMenu(base, EXPECTED);
    expect(r.ok).toBe(true);
    expect(r.hardErrors).toEqual([]);
  });

  it("엉뚱한 주(다음 주가 아님)는 보류", () => {
    const r = validateMenu(base, "2026-08-03");
    expect(r.ok).toBe(false);
    expect(r.hardErrors.join()).toContain("주 시작일");
  });

  it("요일이 빠지면 보류", () => {
    const m = clone();
    m.days.splice(2, 1); // 수요일 제거
    const r = validateMenu(m, EXPECTED);
    expect(r.ok).toBe(false);
    expect(r.hardErrors.join()).toContain("요일 누락");
  });

  it("날짜↔요일 표기가 어긋나면 보류(열/날짜 뒤바뀜 감지)", () => {
    const m = clone();
    m.days[0].weekday = "화"; // 월요일인데 '화'
    const r = validateMenu(m, EXPECTED);
    expect(r.ok).toBe(false);
    expect(r.hardErrors.join()).toContain("요일 표기 불일치");
  });

  it("공휴일 아닌 날 중식이 비면 보류", () => {
    const m = clone();
    m.days[0].lunch = { dishes: [] };
    const r = validateMenu(m, EXPECTED);
    expect(r.ok).toBe(false);
    expect(r.hardErrors.join()).toContain("중식");
  });

  it("빈 메뉴명은 보류", () => {
    const m = clone();
    m.days[0].lunch?.dishes.push({ name: "   ", isMain: false });
    const r = validateMenu(m, EXPECTED);
    expect(r.ok).toBe(false);
    expect(r.hardErrors.join()).toContain("빈 메뉴명");
  });

  it("석식 없음은 통과하되 soft 경고", () => {
    const m = clone();
    delete m.days[0].dinner;
    const r = validateMenu(m, EXPECTED);
    expect(r.ok).toBe(true);
    expect(r.softWarnings.join()).toContain("석식");
  });
});
