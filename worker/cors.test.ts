import { describe, expect, it } from "vitest";
import { preflight, withCors } from "./cors";

describe("withCors — 기존 응답에 CORS 헤더만 덧붙인다", () => {
  it("본문과 상태코드는 그대로 두고 Allow-Origin만 추가한다", async () => {
    const original = Response.json({ hello: "world" }, { status: 200 });
    const res = withCors(original);

    expect(res.status).toBe(200);
    expect(await res.clone().json()).toEqual({ hello: "world" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("404 등 오류 응답도 본문·상태 유지한 채 CORS만 붙는다", async () => {
    const res = withCors(Response.json({ error: "no menu" }, { status: 404 }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "no menu" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("자격증명 허용 헤더는 붙이지 않는다('*' + credentials 금지)", () => {
    const res = withCors(Response.json({}));
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

describe("preflight — OPTIONS 응답", () => {
  it("204 + CORS 헤더, 본문 없음", async () => {
    const res = preflight();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(await res.text()).toBe("");
  });
});
