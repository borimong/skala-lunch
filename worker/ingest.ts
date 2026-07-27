import { type WeeklyMenu, addDaysISO, mondayOf } from "../shared/menu";
import { excelGridText, parseWeeklyExcel } from "./excel";
import { saveDraft, saveWeek } from "./menus";
import { validateMenu } from "./validate";
import { verifyWithGemini } from "./verify";

export interface IngestResult {
  status: "published" | "held" | "error";
  reasons: string[]; // held/error 사유(관리자 알림에 사용)
  warnings: string[]; // 발행했지만 확인하면 좋은 soft 경고
  summary: string; // 요일별 메인 요약(알림용)
  weekStart?: string;
}

function kstToday(): string {
  // en-CA는 YYYY-MM-DD 형식을 준다. slack.ts와 동일한 방식.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );
}

// 차주(다음 주) 월요일. 금요일 자동 실행 기준으로 "다음 주"를 기대값으로 삼는다.
export function nextWeekMonday(todayISO: string = kstToday()): string {
  return addDaysISO(mondayOf(todayISO), 7);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

// 요일별 "메인 메뉴" 한 줄 요약(관리자 알림 메일용).
function summarize(menu: WeeklyMenu): string {
  return menu.days
    .map((day) => {
      if (day.isHoliday) return `${day.weekday}(${shortDate(day.date)}): 휴무`;
      const mains = (day.lunch?.dishes ?? [])
        .filter((x) => x.isMain)
        .map((x) => x.name);
      return `${day.weekday}(${shortDate(day.date)}): ${mains.join(", ") || "-"}`;
    })
    .join("\n");
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 차주 식단 엑셀(base64) 1건을 받아 파싱 → 검증 게이트 → 발행/보류까지 처리한다.
 *  - 검증 통과 → saveWeek(발행), status="published" (호출측은 조용히 처리)
 *  - 검증 이상 → saveDraft(보류), status="held" (호출측이 관리자에게 알림)
 *  - 파싱/디코딩 실패 → status="error"
 */
export async function ingestWeeklyExcel(
  env: Env,
  contentBase64: string,
): Promise<IngestResult> {
  const expected = nextWeekMonday();

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(contentBase64);
  } catch (e) {
    return {
      status: "error",
      reasons: [`base64 디코딩 실패: ${errMsg(e)}`],
      warnings: [],
      summary: "",
    };
  }

  let menu: WeeklyMenu;
  try {
    menu = parseWeeklyExcel(bytes, expected);
  } catch (e) {
    return {
      status: "error",
      reasons: [`엑셀 파싱 실패: ${errMsg(e)}`],
      warnings: [],
      summary: "",
    };
  }

  const v = validateMenu(menu, expected);
  const summary = summarize(menu);

  if (!v.ok) {
    await saveDraft(env.DB, menu);
    return {
      status: "held",
      reasons: v.hardErrors,
      warnings: v.softWarnings,
      summary,
      weekStart: menu.weekStart,
    };
  }

  // AI 교차검증(선택): GEMINI_API_KEY가 있을 때만. 파서 결과를 원본 셀과 대조해
  // 불일치가 있으면 보류. Gemini 실패/오류는 발행을 막지 않는다(인프라 이슈로 인한 오탐 방지).
  if (env.GEMINI_API_KEY) {
    try {
      const cross = await verifyWithGemini(env, excelGridText(bytes), menu);
      if (!cross.ok && cross.discrepancies.length > 0) {
        await saveDraft(env.DB, menu);
        return {
          status: "held",
          reasons: cross.discrepancies.map((d) => `AI 교차검증: ${d}`),
          warnings: v.softWarnings,
          summary,
          weekStart: menu.weekStart,
        };
      }
    } catch (e) {
      console.error("Gemini 교차검증 실패(무시하고 발행):", e);
    }
  }

  await saveWeek(env.DB, menu);
  return {
    status: "published",
    reasons: [],
    warnings: v.softWarnings,
    summary,
    weekStart: menu.weekStart,
  };
}
