import { mondayOf, weeklyMenuSchema } from "../shared/menu";
import { requireAdmin, requireIngest, unauthorized } from "./auth";
import { preflight, withCors } from "./cors";
import { swaggerUiHtml } from "./docs";
import { extractMenu } from "./gemini";
import { ingestWeeklyExcel } from "./ingest";
import {
  getLatestWeek,
  getPendingDrafts,
  getPublishedWeek,
  getWeekAnyStatus,
  saveWeek,
} from "./menus";
import { openApiSpec } from "./openapi";
import { notifyToday } from "./slack";
import { buildTodayResponse, todayKST } from "./today";

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const { method } = request;

    try {
      if (pathname === "/api/health") {
        return Response.json({ ok: true });
      }

      // 공개 GET 엔드포인트: 브라우저 cross-origin 소비자를 위한 프리플라이트 응답.
      const isPublicApiGet =
        pathname === "/api/today" ||
        pathname === "/api/openapi.json" ||
        pathname === "/api/menus/current" ||
        /^\/api\/menus\/\d{4}-\d{2}-\d{2}$/.test(pathname);
      if (method === "OPTIONS" && isPublicApiGet) {
        return preflight();
      }

      // 공개: API 문서(Swagger UI)와 OpenAPI 스펙
      if (pathname === "/api/docs" && method === "GET") {
        return new Response(swaggerUiHtml, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      if (pathname === "/api/openapi.json" && method === "GET") {
        return withCors(Response.json(openApiSpec));
      }

      // 공개: 오늘(KST)의 메뉴 한 날치 (?date=YYYY-MM-DD로 특정 날짜 조회)
      if (pathname === "/api/today" && method === "GET") {
        const dateParam = url.searchParams.get("date") ?? undefined;
        if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
          return withCors(
            Response.json(
              { error: "date는 YYYY-MM-DD 형식이어야 해요." },
              { status: 400 },
            ),
          );
        }
        const date = dateParam ?? todayKST();
        const menu = await getPublishedWeek(env.DB, mondayOf(date));
        return withCors(Response.json(buildTodayResponse(date, menu)));
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
          ? withCors(Response.json(menu))
          : withCors(Response.json({ error: "no menu" }, { status: 404 }));
      }

      // 관리자: 검토 대기(보류) 주 목록
      if (pathname === "/api/menus/pending" && method === "GET") {
        if (!requireAdmin(request, env)) return unauthorized();
        const drafts = await getPendingDrafts(env.DB);
        return Response.json({ drafts });
      }

      // 관리자: 특정 주 초안/데이터 로드(검토 화면용, 상태 무관)
      const draftMatch = pathname.match(
        /^\/api\/menus\/(\d{4}-\d{2}-\d{2})\/draft$/,
      );
      if (draftMatch && method === "GET") {
        if (!requireAdmin(request, env)) return unauthorized();
        const row = await getWeekAnyStatus(env.DB, draftMatch[1]);
        return row
          ? Response.json(row)
          : Response.json({ error: "not found" }, { status: 404 });
      }

      // 공개: 특정 주
      const weekMatch = pathname.match(/^\/api\/menus\/(\d{4}-\d{2}-\d{2})$/);
      if (weekMatch && method === "GET") {
        const menu = await getPublishedWeek(env.DB, weekMatch[1]);
        return menu
          ? withCors(Response.json(menu))
          : withCors(Response.json({ error: "not found" }, { status: 404 }));
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

      // 자동 인그레스: 차주 식단 엑셀(base64) 수신 → 파싱 → 검증 게이트 → 발행/보류
      // (Apps Script가 매주 금요일 밤 호출. 공개 슬랙은 건드리지 않음.)
      if (pathname === "/api/ingest/weekly" && method === "POST") {
        if (!requireIngest(request, env)) return unauthorized();
        const payload = (await request.json()) as { contentBase64?: unknown };
        if (
          typeof payload.contentBase64 !== "string" ||
          payload.contentBase64.length === 0
        ) {
          return Response.json(
            {
              status: "error",
              reasons: ["contentBase64(엑셀 base64)가 필요해요."],
              warnings: [],
              summary: "",
            },
            { status: 400 },
          );
        }
        const result = await ingestWeeklyExcel(env, payload.contentBase64);
        return Response.json(result, {
          status: result.status === "error" ? 422 : 200,
        });
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
