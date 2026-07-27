import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { excelGridText, parseWeeklyExcel } from "./excel";
import { verifyWithGemini } from "./verify";

const fixturePath = fileURLToPath(
  new URL("../automation/samples/sample-2026-07-27.xlsx", import.meta.url),
);
const bytes = readFileSync(fixturePath);
const menu = parseWeeklyExcel(bytes);

function geminiResponse(obj: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
    }),
    { status: 200 },
  );
}

const fakeEnv = {
  GEMINI_API_KEY: "test-key",
  GEMINI_MODEL: "gemini-3.5-flash",
} as unknown as Env;

afterEach(() => vi.unstubAllGlobals());

describe("excelGridText", () => {
  it("원본 셀을 '주소=값'으로 덤프한다(매핑 안 거친 원본)", () => {
    const g = excelGridText(bytes);
    expect(g).toContain("짜장밥");
    expect(g).toContain("B5="); // 메뉴명이 실제 셀 주소와 함께
  });
});

describe("verifyWithGemini", () => {
  it("불일치 없음 → ok:true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => geminiResponse({ ok: true, discrepancies: [] })),
    );
    const r = await verifyWithGemini(fakeEnv, excelGridText(bytes), menu);
    expect(r.ok).toBe(true);
    expect(r.discrepancies).toEqual([]);
  });

  it("불일치 있음 → ok:false + 사유 목록", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        geminiResponse({
          ok: false,
          discrepancies: ["월요일 중식 '짜장밥'이 '짜짱밥'으로 잘못 추출됨"],
        }),
      ),
    );
    const r = await verifyWithGemini(fakeEnv, "grid", menu);
    expect(r.ok).toBe(false);
    expect(r.discrepancies[0]).toContain("짜짱밥");
  });

  it("API 오류 → throw (호출측이 무시하고 발행)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 403 })),
    );
    await expect(verifyWithGemini(fakeEnv, "grid", menu)).rejects.toThrow();
  });
});
