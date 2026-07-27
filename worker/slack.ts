import type { Day, Meal } from "../shared/menu";
import { mondayOf } from "../shared/menu";
import { getPublishedWeek } from "./menus";

type SlackPayload = { text: string; blocks: Record<string, unknown>[] };
type NotifyResult = { sent: boolean; reason?: string; payload?: SlackPayload };

function formatMeal(meal?: Meal): string {
  if (!meal || meal.dishes.length === 0) return "";
  const mains = meal.dishes.filter((d) => d.isMain).map((d) => `*${d.name}*`);
  const sides = meal.dishes.filter((d) => !d.isMain).map((d) => d.name);
  return [...mains, ...sides].join(" · ");
}

export function buildPayload(day: Day, publicUrl: string): SlackPayload {
  const dateLabel = `${day.date.slice(5).replace("-", "/")} (${day.weekday})`;
  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🍽️ 오늘의 메뉴 · ${dateLabel}`,
        emoji: true,
      },
    },
  ];

  const lunch = formatMeal(day.lunch);
  if (lunch) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*🥗 중식*\n${lunch}` },
    });
  }

  const dinner = formatMeal(day.dinner);
  if (dinner) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*🍲 석식*\n${dinner}` },
    });
  }

  const context: string[] = [];
  if (day.dessert) context.push(`후식: ${day.dessert}`);
  context.push(`<${publicUrl}|전체 식단표 보기>`);
  context.push(
    "<https://skalacafe.netlify.app/|사내카페 주문하기(by 5반 김태관님)>",
  );
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: context.join("  ·  ") }],
  });

  return { text: `오늘의 메뉴 · ${dateLabel}`, blocks };
}

// 오늘(KST) 메뉴를 슬랙으로 발송. 메뉴 없는 날(주말·휴무·미발행)은 조용히 skip.
export async function notifyToday(
  env: Env,
  dateOverride?: string,
): Promise<NotifyResult> {
  const todayKST =
    dateOverride ??
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(
      new Date(),
    );

  const monday = mondayOf(todayKST);
  const menu = await getPublishedWeek(env.DB, monday);
  if (!menu) return { sent: false, reason: `발행된 주(${monday})가 없어요.` };

  const day = menu.days.find((d) => d.date === todayKST);
  if (!day) {
    return {
      sent: false,
      reason: `오늘(${todayKST})은 메뉴가 없는 날이에요(주말 등).`,
    };
  }
  if (day.isHoliday) {
    return { sent: false, reason: `오늘은 휴무예요(${day.label ?? ""}).` };
  }

  const hasMeal =
    (day.lunch?.dishes.length ?? 0) > 0 || (day.dinner?.dishes.length ?? 0) > 0;
  if (!hasMeal) return { sent: false, reason: "오늘 등록된 메뉴가 없어요." };

  const payload = buildPayload(day, env.PUBLIC_URL);

  if (!env.SLACK_WEBHOOK_URL) {
    return {
      sent: false,
      reason: "SLACK_WEBHOOK_URL이 설정되지 않았어요(미리보기만).",
      payload,
    };
  }

  const res = await fetch(env.SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    return {
      sent: false,
      reason: `슬랙 전송 실패 (${res.status}): ${body.slice(0, 200)}`,
    };
  }
  return { sent: true };
}
