import { describe, expect, it } from "vitest";
import type { Day } from "../shared/menu";
import { buildPayload } from "./slack";

const day: Day = {
  date: "2026-07-27",
  weekday: "월",
  lunch: {
    dishes: [
      { name: "짜장밥", isMain: true },
      { name: "반달단무지", isMain: false },
    ],
  },
  dinner: { dishes: [{ name: "순살감자탕", isMain: true }] },
  dessert: "결명자차",
};

function contextText(payload: ReturnType<typeof buildPayload>): string {
  const ctx = payload.blocks.find((b) => b.type === "context");
  const elements = ctx?.elements as { text: string }[] | undefined;
  return elements?.[0]?.text ?? "";
}

describe("buildPayload — 슬랙 context 링크", () => {
  const payload = buildPayload(day, "https://skala-lunch.example/");
  const text = contextText(payload);

  it("전체 식단표 보기 링크가 있다", () => {
    expect(text).toContain("<https://skala-lunch.example/|전체 식단표 보기>");
  });

  it("사내카페 주문하기 링크가 옆에 추가된다", () => {
    expect(text).toContain(
      "<https://skalacafe.netlify.app/|사내카페 주문하기(by 5반 김태관님)>",
    );
  });

  it("두 링크가 같은 context 줄에 함께 노출된다", () => {
    const idxMenu = text.indexOf("전체 식단표 보기");
    const idxCafe = text.indexOf("사내카페 주문하기");
    expect(idxMenu).toBeGreaterThanOrEqual(0);
    expect(idxCafe).toBeGreaterThan(idxMenu); // 식단표 링크 다음(옆)에
  });
});
