import type { Day, Meal } from "../shared/menu";
import { mondayOf } from "../shared/menu";
import { lunchScheduleFor } from "../shared/lunchSchedule";
import { getPublishedWeek } from "./menus";

type SlackPayload = { text: string; blocks: Record<string, unknown>[] };
type NotifyResult = { sent: boolean; reason?: string; payload?: SlackPayload };

// 슬랙 mrkdwn은 백슬래시 이스케이프(\*)를 지원하지 않는다.
// 메뉴명 안의 '*'(예: "새우까스*스리라차마요소스")가 볼드 구분자 '*...*'와
// 충돌해 볼드가 깨지므로 '&'로 치환한다.
// '&','<','>'는 슬랙 제어문자라 HTML 엔티티로 이스케이프해야 화면에 문자
// 그대로(예: '&') 렌더된다. '*'→'&' 치환을 먼저 한 뒤 이스케이프하므로,
// 새로 넣은 '&'도 '&amp;'가 되어 '&'로 표시된다.
function escapeMrkdwn(text: string): string {
  return text
    .replace(/\*/g, "&")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatMeal(meal?: Meal): string {
  if (!meal || meal.dishes.length === 0) return "";
  const mains = meal.dishes
    .filter((d) => d.isMain)
    .map((d) => `*${escapeMrkdwn(d.name)}*`);
  const sides = meal.dishes
    .filter((d) => !d.isMain)
    .map((d) => escapeMrkdwn(d.name));
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

  const schedule = lunchScheduleFor(day.date);
  if (schedule && lunch) {
    const slots = schedule.map(
      (s) => `${s.time} ${s.classes.map((c) => `${c}반`).join(", ")}`,
    );
    blocks.push({
      type: "context",
      elements: [
        { type: "mrkdwn", text: `⏰ 점심 순서  ${slots.join("  ·  ")}` },
      ],
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
