import { describe, expect, it } from "vitest";
import { consumptionRatio, guessServingG, isOutlier } from "./foodHeuristics";

describe("guessServingG", () => {
  it("국밥류는 450g", () => {
    expect(guessServingG("장터국밥")).toBe(450);
  });
  it("밥류는 200g", () => {
    expect(guessServingG("쌀밥")).toBe(200);
  });
  it("김치/무침류는 50g", () => {
    expect(guessServingG("포기김치")).toBe(50);
    expect(guessServingG("고추지무침")).toBe(50);
  });
  it("매칭되는 카테고리가 없으면 기본값 150g", () => {
    expect(guessServingG("정체불명메뉴")).toBe(150);
  });
});

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
});

describe("consumptionRatio (2026-09-10 사용자 규칙: 메인 90% / 밥류예외 40% / 그외반찬 20%)", () => {
  it("메인메뉴는 isMain 여부만 보고 90%", () => {
    expect(consumptionRatio("탕수육", true)).toBe(0.9);
    expect(consumptionRatio("쌀밥", true)).toBe(0.9); // 밥이 메인으로 나와도 메인 규칙이 우선
  });
  it("메인이 아닌 밥류는 예외로 40%", () => {
    expect(consumptionRatio("쌀밥", false)).toBe(0.4);
    expect(consumptionRatio("현미밥", false)).toBe(0.4);
  });
  it("그 외 반찬은 20%", () => {
    expect(consumptionRatio("포기김치", false)).toBe(0.2);
    expect(consumptionRatio("오이생채", false)).toBe(0.2);
  });
});
