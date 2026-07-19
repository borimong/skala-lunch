import { weeklyMenuSchema } from "../shared/menu";
import { requireAdmin, unauthorized } from "./auth";
import { extractMenu } from "./gemini";
import { getLatestWeek, getPublishedWeek, saveWeek } from "./menus";
import { notifyToday } from "./slack";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;

    try {
      if (pathname === "/api/health") {
        return Response.json({ ok: true });
      }

      // 관리자 토큰 확인
      if (pathname === "/api/admin/verify" && method === "GET") {
        return requireAdmin(request, env)
          ? Response.json({ ok: true })
          : unauthorized();
      }

      // 공개: 가장 최근에 발행된 주
      if (pathname === "/api/menus/current" && method === "GET") {
        const menu = await getLatestWeek(env.DB);
        return menu
          ? Response.json(menu)
          : Response.json({ error: "no menu" }, { status: 404 });
      }

      // 공개: 특정 주
      const weekMatch = pathname.match(/^\/api\/menus\/(\d{4}-\d{2}-\d{2})$/);
      if (weekMatch && method === "GET") {
        const menu = await getPublishedWeek(env.DB, weekMatch[1]);
        return menu
          ? Response.json(menu)
          : Response.json({ error: "not found" }, { status: 404 });
      }

      // 관리자: 사진 → Gemini 추출 (저장하지 않고 초안 반환)
      if (pathname === "/api/extract" && method === "POST") {
        if (!requireAdmin(request, env)) return unauthorized();
        const form = await request.formData();
        const file = form.get("image");
        const weekStart = form.get("weekStart");
        if (
          !(file instanceof File) ||
          typeof weekStart !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)
        ) {
          return Response.json(
            { error: "image 파일과 weekStart(YYYY-MM-DD)가 필요해요." },
            { status: 400 },
          );
        }
        const buf = await file.arrayBuffer();
        const menu = await extractMenu(env, buf, file.type, weekStart);
        return Response.json({ menu });
      }

      // 관리자: 편집본 저장·발행
      if (pathname === "/api/menus" && method === "POST") {
        if (!requireAdmin(request, env)) return unauthorized();
        const payload = (await request.json()) as {
          menu?: unknown;
          imageKey?: string;
        };
        const parsed = weeklyMenuSchema.safeParse(payload.menu);
        if (!parsed.success) {
          return Response.json(
            {
              error: "식단 형식이 올바르지 않아요.",
              detail: parsed.error.issues,
            },
            { status: 400 },
          );
        }
        await saveWeek(env.DB, parsed.data, payload.imageKey);
        return Response.json({ ok: true });
      }

      // 관리자: 오늘의 메뉴 슬랙 즉시 발송 (?date=YYYY-MM-DD로 특정 날짜 테스트/재발송)
      if (pathname === "/api/notify" && method === "POST") {
        if (!requireAdmin(request, env)) return unauthorized();
        const date = url.searchParams.get("date") ?? undefined;
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return Response.json(
            { error: "date는 YYYY-MM-DD 형식이어야 해요." },
            { status: 400 },
          );
        }
        const result = await notifyToday(env, date);
        return Response.json(result);
      }

      if (pathname.startsWith("/api/")) {
        return Response.json({ error: "Not found" }, { status: 404 });
      }
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : "server error";
      return Response.json({ error: message }, { status: 500 });
    }

    // /api/* 외 요청은 SPA 정적 자산으로 (안전망)
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(notifyToday(env));
  },
} satisfies ExportedHandler<Env>;
