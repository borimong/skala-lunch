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

  it("영양정보 상세페이지 링크가 날짜와 함께 추가된다", () => {
    expect(text).toContain(
      "<https://skala-lunch.example/nutrition/2026-07-27|칼로리/영양정보 자세히 보기(by 5반 유길선님)>",
    );
  });
});

describe("buildPayload — 요리명에 '*'가 들어있어도 볼드 마크다운이 안 깨진다", () => {
  const dayWithAsterisk: Day = {
    date: "2026-07-27",
    weekday: "월",
    lunch: {
      dishes: [
        { name: "샐러드*드레싱*토핑", isMain: true },
        { name: "핫도그*머스타드*케찹", isMain: false },
      ],
    },
    dessert: undefined,
  };
  const payload = buildPayload(dayWithAsterisk, "https://skala-lunch.example/");
  const lunchSection = payload.blocks.find(
    (b) => b.type === "section" && (b.text as { text: string }).text.includes("중식"),
  ) as { text: { text: string } };

  it("메인메뉴의 '*'는 가운뎃점으로 바뀌고 볼드는 앞뒤에만 붙는다", () => {
    expect(lunchSection.text.text).toContain("*샐러드·드레싱·토핑*");
  });

  it("반찬의 '*'도 가운뎃점으로 바뀐다", () => {
    expect(lunchSection.text.text).toContain("핫도그·머스타드·케찹");
  });
});
