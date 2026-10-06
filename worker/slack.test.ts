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

function contextTexts(payload: ReturnType<typeof buildPayload>): string[] {
  return payload.blocks
    .filter((b) => b.type === "context")
    .map((b) => (b.elements as { text: string }[])[0]?.text ?? "");
}

// 링크가 모인 맨 아래 context 줄
function contextText(payload: ReturnType<typeof buildPayload>): string {
  const texts = contextTexts(payload);
  return texts[texts.length - 1] ?? "";
}

function sectionText(
  payload: ReturnType<typeof buildPayload>,
  marker: string,
): string {
  const sec = payload.blocks.find(
    (b) =>
      b.type === "section" &&
      typeof (b.text as { text?: unknown } | undefined)?.text === "string" &&
      (b.text as { text: string }).text.includes(marker),
  );
  return (sec?.text as { text?: string } | undefined)?.text ?? "";
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

describe("buildPayload — 메뉴명 '*' 볼드 깨짐 방지", () => {
  const dayWithStar: Day = {
    date: "2026-07-27",
    weekday: "월",
    lunch: {
      dishes: [
        { name: "새우까스*스리라차마요소스", isMain: true },
        { name: "샐러드*드레싱", isMain: false },
      ],
    },
  };
  const t = sectionText(buildPayload(dayWithStar, "https://x/"), "🥗 중식");

  it("메인 메뉴의 '*'가 '&'로 치환되어 볼드가 유지된다", () => {
    expect(t).toContain("*새우까스&amp;스리라차마요소스*");
  });

  it("원본 '*'가 메뉴명 안에 남지 않는다 (사이드도 치환)", () => {
    expect(t).not.toContain("새우까스*스리");
    expect(t).not.toContain("샐러드*드레싱");
    expect(t).toContain("샐러드&amp;드레싱");
  });

  it("볼드 구분자 '*' 개수가 짝수라 볼드가 안 깨진다", () => {
    expect((t.match(/\*/g) ?? []).length % 2).toBe(0);
  });
});

describe("buildPayload — 반별 점심 순서 안내", () => {
  const onRotation: Day = { ...day, date: "2026-10-06", weekday: "화" };

  it("운영 기간 날짜면 링크 줄 위에 작은 글씨로 순서가 붙는다", () => {
    const texts = contextTexts(buildPayload(onRotation, "https://x/"));
    expect(texts).toHaveLength(2);
    expect(texts[0]).toBe(
      "⏰ 점심 순서  11:50 2반  ·  12:00 3반, 4반  ·  12:10 5반, 1반",
    );
    expect(texts[1]).toContain("전체 식단표 보기");
  });

  it("운영 기간 밖이면 순서 줄이 없다", () => {
    const texts = contextTexts(buildPayload(day, "https://x/"));
    expect(texts).toHaveLength(1);
    expect(texts[0]).not.toContain("점심 순서");
  });

  it("중식이 없는 날엔 순서 줄을 생략한다", () => {
    const dinnerOnly: Day = { ...onRotation, lunch: undefined };
    const texts = contextTexts(buildPayload(dinnerOnly, "https://x/"));
    expect(texts.some((t) => t.includes("점심 순서"))).toBe(false);
  });
});
