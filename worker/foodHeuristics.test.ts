import { describe, expect, it } from "vitest";
import { isOutlier } from "./foodHeuristics";

describe("isOutlier", () => {
  it("밥류 상한선(200) 이내면 이상치 아님", () => {
    expect(isOutlier("쌀밥", 166)).toBe(false);
  });
  it("밥류 상한선을 넘으면 이상치", () => {
    expect(isOutlier("쌀밥", 500)).toBe(true);
  });
  it("김치류처럼 상한선이 낮은 카테고리는 더 쉽게 이상치로 잡힘", () => {
    expect(isOutlier("포기김치", 200)).toBe(true);
  });
  it("매칭되는 카테고리가 없으면 기본 상한선(350) 적용", () => {
    expect(isOutlier("정체불명메뉴", 300)).toBe(false);
    expect(isOutlier("정체불명메뉴", 400)).toBe(true);
  });
});
