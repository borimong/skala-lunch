import { afterEach, describe, expect, it, vi } from "vitest";
import { buildImageRequest, fetchWithRetry } from "./gemini";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(statuses: number[]) {
  const fn = vi.fn();
  for (const s of statuses)
    fn.mockResolvedValueOnce(new Response("", { status: s }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("fetchWithRetry", () => {
  it("503이면 다시 보내고 성공하면 그 응답을 돌려준다", async () => {
    const fn = stubFetch([503, 503, 200]);
    const res = await fetchWithRetry("https://x", {}, [0, 0, 0]);
    expect(res.status).toBe(200);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("재시도 횟수를 다 쓰면 마지막 오류 응답을 돌려준다", async () => {
    const fn = stubFetch([503, 503, 429]);
    const res = await fetchWithRetry("https://x", {}, [0, 0]);
    expect(res.status).toBe(429);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("400 같은 요청 오류는 재시도하지 않는다", async () => {
    const fn = stubFetch([400]);
    const res = await fetchWithRetry("https://x", {}, [0, 0]);
    expect(res.status).toBe(400);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("buildImageRequest", () => {
  const img = new Uint8Array([1, 2, 3]).buffer;

  it("해상도를 지정하면 이미지 part에 media_resolution을 붙인다", () => {
    const body = buildImageRequest(
      "p",
      img,
      "image/png",
      {},
      "MEDIA_RESOLUTION_ULTRA_HIGH",
    );
    expect(body.contents[0].parts[1]).toMatchObject({
      inline_data: { mime_type: "image/png" },
      media_resolution: { level: "MEDIA_RESOLUTION_ULTRA_HIGH" },
    });
  });

  it("지정하지 않으면 media_resolution을 보내지 않는다(모델 기본값)", () => {
    const body = buildImageRequest("p", img, "", {});
    expect(body.contents[0].parts[1]).not.toHaveProperty("media_resolution");
    expect(body.contents[0].parts[1]).toMatchObject({
      inline_data: { mime_type: "image/jpeg" },
    });
  });
});
