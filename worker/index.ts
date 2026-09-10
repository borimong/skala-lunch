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
import { collectMeals, ensureNutrition } from "./nutrition";

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
        pathname === "/api/nutrition" ||
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

      // 공개: 특정 날짜+끼니에 캐시된 요리별 영양정보(요리명 -> 탄단지/칼로리).
      // 프론트(DishList.tsx)가 화면에 그릴 때 이걸 받아서 이름으로 찾아 씀.
      // date/mealType 둘 다 필수 — 같은 요리 이름이라도 끼니마다 재보정된
      // 값이 다를 수 있어서(worker/nutrition.ts의 (date,meal_type,food_name)
      // 복합키 캐시 참고) 통째로 다 주지 않고 정확히 그 끼니 것만 준다.
      if (pathname === "/api/nutrition" && method === "GET") {
        const date = url.searchParams.get("date");
        const mealType = url.searchParams.get("mealType");
        if (
          !date ||
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          (mealType !== "lunch" && mealType !== "dinner")
        ) {
          return withCors(
            Response.json(
              { error: "date(YYYY-MM-DD)와 mealType(lunch|dinner)가 필요해요." },
              { status: 400 },
            ),
          );
        }
        const rows = await env.DB.prepare(
          "SELECT food_name, serving_g, carb_g, protein_g, fat_g, kcal, source, reliability, outlier, excluded_reason FROM dish_nutrition WHERE date = ? AND meal_type = ?",
        )
          .bind(date, mealType)
          .all<{
            food_name: string;
            serving_g: number;
            carb_g: number;
            protein_g: number;
            fat_g: number;
            kcal: number;
            source: string;
            reliability: string;
            outlier: number;
            excluded_reason: string | null;
          }>();
        const byName: Record<string, unknown> = {};
        for (const row of rows.results ?? []) {
          byName[row.food_name] = {
            serving_g: row.serving_g,
            carb_g: row.carb_g,
            protein_g: row.protein_g,
            fat_g: row.fat_g,
            kcal: row.kcal,
            source: row.source,
            reliability: row.reliability,
            outlier: !!row.outlier,
            excludedReason: row.excluded_reason ?? undefined,
          };
        }
        return withCors(Response.json(byName));
      }

      // 관리자: 이 끼니를 계산할 때 GPT/DB랑 어떤 판단을 주고받았는지 원본 그대로.
      // "쌀밥이 30g에 95kcal면 이상한데 DB에서 뭘로 매칭했는지 보고 싶다" 같은
      // 확인용 — 일반 사용자용이 아니라서 관리자 인증을 요구한다.
      if (pathname === "/api/nutrition/trace" && method === "GET") {
        if (!requireAdmin(request, env)) return unauthorized();
        const date = url.searchParams.get("date");
        const mealType = url.searchParams.get("mealType");
        if (!date || (mealType !== "lunch" && mealType !== "dinner")) {
          return Response.json({ error: "date와 mealType(lunch|dinner)이 필요해요." }, { status: 400 });
        }
        const row = await env.DB.prepare(
          "SELECT trace_md FROM nutrition_trace WHERE date = ? AND meal_type = ?",
        )
          .bind(date, mealType)
          .first<{ trace_md: string }>();
        return row
          ? new Response(row.trace_md, { headers: { "Content-Type": "text/markdown; charset=utf-8" } })
          : Response.json({ error: "추적 로그가 없어요(캐시에서 바로 읽혀서 이번엔 새로 계산 안 했을 수 있음)." }, { status: 404 });
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

        // 발행 직후 딱 한 번, 이번 주 요리들의 영양정보를 계산해서 D1에
        // 캐시해둔다(끼니당 Gemini 에이전트 호출 1번, 몇 초 걸릴 수 있음 —
        // 백그라운드로 돌리려면 ctx.waitUntil 필요한데 지금은 fetch 핸들러에
        // ctx를 안 받고 있어서 나중에 개선 여지로 남겨둠).
        // GEMINI_NUTRITION_API_KEY는 사진→메뉴 추출용 GEMINI_API_KEY(김현수님
        // 명의)와 별개 키다 — 우리가 새로 만드는 이 기능이 그분 무료 할당량을
        // 몰래 갉아먹지 않도록 사용자 본인 명의로 새로 발급받은 키를 씀.
        // 실패해도(예: 키 미설정, 일부 요리 추정 실패) 발행 자체는 이미
        // 끝났으니 막지 않고 로그만 남긴다 — 다음 발행 때 재시도됨.
        if (env.GEMINI_NUTRITION_API_KEY) {
          const meals = collectMeals(parsed.data.days);
          try {
            await ensureNutrition(env.DB, env.GEMINI_NUTRITION_API_KEY, meals, env.DATA_GO_KR_API_KEY);
          } catch (err) {
            console.error("영양정보 계산 실패:", err);
          }
        }

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
