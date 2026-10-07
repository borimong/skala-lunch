import {
  type InnovalleyDay,
  type InnovalleyWeek,
  innovalleyWeekSchema,
} from "../shared/innovalley";
import { addDaysISO, mondayOf, weekdayKo } from "../shared/menu";
import { generateJsonFromImage } from "./gemini";
import {
  type ChannelPost,
  fetchChannelPosts,
  weekStartFromTitle,
} from "./kakao";
import {
  type SlackPayload,
  escapeMrkdwn,
  formatMeal,
  postToSlack,
} from "./slack";
import { todayKST } from "./today";

// 추출 (Gemini)

const dishSchema = {
  type: "OBJECT",
  properties: { name: { type: "STRING" }, isMain: { type: "BOOLEAN" } },
  required: ["name", "isMain"],
} as const;

const responseSchema = {
  type: "OBJECT",
  properties: {
    days: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING" },
          weekday: { type: "STRING" },
          label: { type: "STRING" },
          isHoliday: { type: "BOOLEAN" },
          corners: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                dishes: { type: "ARRAY", items: dishSchema },
              },
              required: ["name", "dishes"],
            },
          },
        },
        required: ["date", "weekday", "corners"],
      },
    },
  },
  required: ["days"],
} as const;

function buildPrompt(weekStart: string): string {
  return `당신은 사내 식당 '이노밸리 주간 메뉴' 이미지에서 중식(점심) 메뉴만 정확히 추출하는 도우미입니다.

[표 구조]
- 가로(열)는 월~금 5일이며, 각 열 상단에 요일과 날짜(YYYY-MM-DD)가 적혀 있습니다.
- 이미지 맨 위 큰 제목의 날짜 범위는 지난주 것이 남아 있을 때가 있으니 무시하고, 반드시 열 상단의 날짜를 쓰세요.
- 세로(행)는 위에서부터 조식 → 중식 → 석식 → Take Out 구역입니다.
- 중식 구역은 코너로 나뉩니다: Korean(한식), Western(양식), Noodle(면), 샐러드바.
- 색 글씨(빨강, 초록, 보라 등)로 강조된 요리가 그 코너의 메인입니다.

[추출 규칙]
- 이 주의 월요일은 ${weekStart} 입니다. date는 YYYY-MM-DD, weekday는 한국어 한 글자(월/화/수/목/금)로 채우세요.
- 중식 구역만 추출하세요. 조식, 석식, Take Out, 오른쪽의 요일별 샐러드 표는 넣지 마세요.
- 각 날짜의 corners에 코너를 위에서 아래 순서로 넣고, 코너 name은 한식, 양식, 면, 샐러드바 처럼 한국어로 쓰세요.
- 각 코너의 dishes에 요리를 위에서 아래 순서대로 넣고, 메인 요리는 isMain=true, 나머지는 isMain=false로 표시하세요. 표기('&', '/', 괄호 등)는 원문 그대로 두세요.
- 메뉴 없이 '대체공휴일', '한글날' 같은 큰 글씨나 그림만 있는 날은 isHoliday=true, label에 그 이름을 넣고 corners는 빈 배열로 두세요.
- 이미지에 없는 내용을 지어내지 마세요. 읽을 수 없는 요리는 생략하세요.

반드시 제공된 JSON 스키마에 맞춰 한국어로만 출력하세요.`;
}

export async function extractInnovalley(
  env: Env,
  image: ArrayBuffer,
  mimeType: string,
  weekStart: string,
): Promise<InnovalleyWeek> {
  const parsed = await generateJsonFromImage(
    env,
    buildPrompt(weekStart),
    image,
    mimeType,
    responseSchema,
  );
  const result = innovalleyWeekSchema.safeParse({
    ...(parsed as object),
    weekStart,
    weekEnd: addDaysISO(weekStart, 4),
  });
  if (!result.success) {
    throw new Error(
      `추출 결과 형식이 예상과 달라요: ${JSON.stringify(result.error.issues).slice(0, 400)}`,
    );
  }
  return result.data;
}

// 검증 게이트

const MAX_NAME_LEN = 60;

export interface InnovalleyValidation {
  ok: boolean;
  hardErrors: string[];
  softWarnings: string[];
}

// 하드 에러가 있으면 발행하지 않고 보류한다(잘못 읽은 메뉴가 채널에 나가는 것 방지).
export function validateInnovalley(
  week: InnovalleyWeek,
  expectedWeekStart: string,
): InnovalleyValidation {
  const hardErrors: string[] = [];
  const softWarnings: string[] = [];

  const byDate = new Map<string, InnovalleyDay>();
  for (const d of week.days) {
    if (byDate.has(d.date)) hardErrors.push(`중복된 날짜: ${d.date}`);
    byDate.set(d.date, d);
  }
  for (const d of week.days) {
    const offset = Math.round(
      (new Date(`${d.date}T00:00:00`).getTime() -
        new Date(`${expectedWeekStart}T00:00:00`).getTime()) /
        86_400_000,
    );
    if (!(offset >= 0 && offset <= 4)) {
      hardErrors.push(`이번 주(${expectedWeekStart}) 밖의 날짜: ${d.date}`);
    }
  }

  for (let i = 0; i < 5; i++) {
    const date = addDaysISO(expectedWeekStart, i);
    const day = byDate.get(date);
    if (!day) {
      hardErrors.push(`요일 누락: ${date}`);
      continue;
    }
    const wd = weekdayKo(date);
    if (day.weekday && day.weekday !== wd) {
      hardErrors.push(
        `요일 표기 불일치: ${date}는 '${wd}'인데 '${day.weekday}'로 되어 있습니다`,
      );
    }
    if (day.isHoliday) continue;

    const dishes = day.corners.flatMap((c) => c.dishes);
    if (dishes.length === 0) {
      hardErrors.push(`중식이 비어 있습니다: ${date}`);
      continue;
    }
    for (const corner of day.corners) {
      if (corner.dishes.length === 0) {
        softWarnings.push(`${date} ${corner.name} 코너가 비어 있습니다`);
      } else if (
        !corner.name.includes("샐러드") &&
        !corner.dishes.some((x) => x.isMain)
      ) {
        softWarnings.push(`${date} ${corner.name} 코너에 메인 표기가 없습니다`);
      }
    }
    for (const dish of dishes) {
      const name = dish.name.trim();
      if (name.length === 0) {
        hardErrors.push(`${date}에 빈 메뉴명이 있습니다`);
      } else if (name.length > MAX_NAME_LEN) {
        softWarnings.push(
          `${date} 메뉴명이 비정상적으로 깁니다: "${name.slice(0, 20)}…"`,
        );
      }
    }
  }

  if (week.days.length > 0 && week.days.every((d) => d.isHoliday)) {
    hardErrors.push("주 전체가 휴무로 읽혔습니다. 추출 오류일 수 있어요.");
  }

  return { ok: hardErrors.length === 0, hardErrors, softWarnings };
}

// 저장

export interface InnovalleyRow {
  weekStart: string;
  postId: string;
  postUrl: string;
  imageUrl: string;
  menu: InnovalleyWeek | null; // 추출 오류로 보류된 경우 null
  status: "published" | "held";
  reasons: string[];
  updatedAt: string;
}

interface DbRow {
  week_start: string;
  post_id: string;
  post_url: string;
  image_url: string;
  data: string | null;
  status: string;
  reasons: string;
  updated_at: string;
}

export async function getInnovalleyRow(
  db: D1Database,
  weekStart: string,
): Promise<InnovalleyRow | null> {
  const r = await db
    .prepare("SELECT * FROM innovalley_menus WHERE week_start = ?")
    .bind(weekStart)
    .first<DbRow>();
  if (!r) return null;
  let reasons: string[] = [];
  try {
    reasons = JSON.parse(r.reasons) as string[];
  } catch {
    // 무시
  }
  return {
    weekStart: r.week_start,
    postId: r.post_id,
    postUrl: r.post_url,
    imageUrl: r.image_url,
    menu: r.data ? (JSON.parse(r.data) as InnovalleyWeek) : null,
    status: r.status === "published" ? "published" : "held",
    reasons,
    updatedAt: r.updated_at,
  };
}

export async function saveInnovalleyRow(
  db: D1Database,
  row: Omit<InnovalleyRow, "updatedAt">,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO innovalley_menus
         (week_start, post_id, post_url, image_url, data, status, reasons, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(week_start) DO UPDATE SET
         post_id = excluded.post_id,
         post_url = excluded.post_url,
         image_url = excluded.image_url,
         data = excluded.data,
         status = excluded.status,
         reasons = excluded.reasons,
         updated_at = datetime('now')`,
    )
    .bind(
      row.weekStart,
      row.postId,
      row.postUrl,
      row.imageUrl,
      row.menu ? JSON.stringify(row.menu) : null,
      row.status,
      JSON.stringify(row.reasons),
    )
    .run();
}

// 수집 (카카오 채널 → 추출 → 검증 → 저장)

export interface SyncResult {
  status: "published" | "held" | "skipped" | "not_posted";
  weekStart: string;
  reasons: string[];
  warnings: string[];
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function ingestPost(
  env: Env,
  post: ChannelPost,
  weekStart: string,
): Promise<SyncResult> {
  const base = {
    weekStart,
    postId: post.id,
    postUrl: post.permalink,
    imageUrl: post.imageUrl,
  };

  const img = await fetch(post.imageUrl);
  if (!img.ok) throw new Error(`메뉴 이미지 다운로드 실패 (${img.status})`);
  const buf = await img.arrayBuffer();
  const mime = img.headers.get("Content-Type") ?? "image/jpeg";

  let week: InnovalleyWeek;
  try {
    week = await extractInnovalley(env, buf, mime, weekStart);
  } catch (e) {
    const reasons = [`추출 실패: ${errMsg(e)}`];
    await saveInnovalleyRow(env.DB, {
      ...base,
      menu: null,
      status: "held",
      reasons,
    });
    return { status: "held", weekStart, reasons, warnings: [] };
  }

  const v = validateInnovalley(week, weekStart);
  const status = v.ok ? "published" : "held";
  await saveInnovalleyRow(env.DB, {
    ...base,
    menu: week,
    status,
    reasons: v.hardErrors,
  });
  return { status, weekStart, reasons: v.hardErrors, warnings: v.softWarnings };
}

/**
 * 이번 주 이노밸리 메뉴가 아직 발행 전이면 카카오 채널을 확인해 수집한다.
 * - 이미 발행됨 → skipped (채널 조회도 안 함)
 * - 같은 게시글을 검증 실패로 보류한 적 있음 → skipped (같은 이미지로 Gemini를 반복 호출하지 않음)
 * - 추출 오류(일시 장애 가능)로 보류된 건 → 다음 실행 때 재시도
 * force=true면 위 조건과 상관없이 다시 수집한다(관리자 수동 실행).
 */
export async function syncInnovalley(
  env: Env,
  today: string,
  { force = false } = {},
): Promise<SyncResult> {
  const weekStart = mondayOf(today);
  const existing = await getInnovalleyRow(env.DB, weekStart);
  const skipped = (reason: string): SyncResult => ({
    status: "skipped",
    weekStart,
    reasons: [reason],
    warnings: [],
  });
  if (!force && existing?.status === "published") {
    return skipped("이미 발행된 주예요.");
  }

  const posts = await fetchChannelPosts();
  const post = posts.find(
    (p) => weekStartFromTitle(p.title, p.publishedAt) === weekStart,
  );
  if (!post) {
    return {
      status: "not_posted",
      weekStart,
      reasons: ["카카오 채널에 이번 주 메뉴가 아직 없어요."],
      warnings: [],
    };
  }
  if (!force && existing?.postId === post.id && existing.menu) {
    return skipped(`보류 중인 게시글이에요: ${existing.reasons.join(" / ")}`);
  }

  const result = await ingestPost(env, post, weekStart);
  // 같은 게시글로 처음 보류될 때만 알린다(추출 오류 재시도마다 알림이 쌓이지 않게).
  const firstHold = !(existing && existing.postId === post.id);
  if (result.status === "held" && (firstHold || force)) {
    await alertAdmin(
      env,
      `이노밸리 ${weekStart} 주 메뉴를 보류했어요.\n${result.reasons.map((r) => `- ${r}`).join("\n")}\n원본: ${post.permalink}`,
    );
  }
  return result;
}

// 슬랙

const CORNER_EMOJI: [string, string][] = [
  ["한식", "🍚"],
  ["양식", "🍝"],
  ["면", "🍜"],
  ["샐러드", "🥗"],
];

function cornerEmoji(name: string): string {
  return CORNER_EMOJI.find(([k]) => name.includes(k))?.[1] ?? "🍴";
}

export function buildInnovalleyPayload(
  day: InnovalleyDay,
  postUrl: string,
): SlackPayload {
  const dateLabel = `${day.date.slice(5).replace("-", "/")} (${day.weekday})`;
  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `🍽️ 이노밸리 중식 · ${dateLabel}`,
        emoji: true,
      },
    },
  ];

  for (const corner of day.corners) {
    const dishes = formatMeal(corner);
    if (!dishes) continue;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${cornerEmoji(corner.name)} ${escapeMrkdwn(corner.name)}*\n${dishes}`,
      },
    });
  }

  const context: string[] = [];
  if (day.label) context.push(escapeMrkdwn(day.label));
  if (postUrl) context.push(`<${postUrl}|주간 메뉴 원본 보기>`);
  if (context.length > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: context.join("  ·  ") }],
    });
  }

  return { text: `이노밸리 중식 · ${dateLabel}`, blocks };
}

export type InnovalleyNotifyCode =
  | "sent"
  | "already_sent"
  | "not_published"
  | "no_day"
  | "holiday"
  | "empty"
  | "no_webhook"
  | "failed";

export interface InnovalleyNotifyResult {
  sent: boolean;
  code: InnovalleyNotifyCode;
  reason?: string;
  payload?: SlackPayload;
}

/**
 * 오늘 이노밸리 중식을 새 채널로 보낸다. 하루 한 번만 보내도록 발송 기록을 먼저 잡고 보낸다.
 * force=true면 이미 보낸 날도 다시 보낸다(관리자 재발송).
 */
export async function notifyInnovalleyToday(
  env: Env,
  dateOverride?: string,
  { force = false } = {},
): Promise<InnovalleyNotifyResult> {
  const date = dateOverride ?? todayKST();
  const row = await getInnovalleyRow(env.DB, mondayOf(date));
  if (!row || row.status !== "published" || !row.menu) {
    return {
      sent: false,
      code: "not_published",
      reason: row
        ? `이번 주 메뉴가 보류 중이에요: ${row.reasons.join(" / ")}`
        : "이번 주 메뉴가 아직 수집되지 않았어요.",
    };
  }

  const day = row.menu.days.find((d) => d.date === date);
  if (!day) {
    return {
      sent: false,
      code: "no_day",
      reason: `${date}은 메뉴가 없는 날이에요.`,
    };
  }
  if (day.isHoliday) {
    return {
      sent: false,
      code: "holiday",
      reason: `휴무예요(${day.label ?? ""}).`,
    };
  }
  if (day.corners.every((c) => c.dishes.length === 0)) {
    return { sent: false, code: "empty", reason: "등록된 중식이 없어요." };
  }

  const payload = buildInnovalleyPayload(day, row.postUrl);
  const webhook = env.SLACK_WEBHOOK_URL_INNOVALLEY;
  if (!webhook) {
    return {
      sent: false,
      code: "no_webhook",
      reason: "SLACK_WEBHOOK_URL_INNOVALLEY가 설정되지 않았어요(미리보기만).",
      payload,
    };
  }

  if (!force) {
    const claim = await env.DB.prepare(
      "INSERT OR IGNORE INTO innovalley_notified (date) VALUES (?)",
    )
      .bind(date)
      .run();
    if (claim.meta.changes === 0) {
      return {
        sent: false,
        code: "already_sent",
        reason: "오늘은 이미 보냈어요.",
      };
    }
  }

  const error = await postToSlack(webhook, payload);
  if (error) {
    if (!force) {
      // 다음 실행에서 다시 시도할 수 있게 발송 기록을 되돌린다.
      await env.DB.prepare("DELETE FROM innovalley_notified WHERE date = ?")
        .bind(date)
        .run();
    }
    return { sent: false, code: "failed", reason: error };
  }
  return { sent: true, code: "sent" };
}

// 관리자 알림 / 크론

async function alertAdmin(env: Env, text: string): Promise<void> {
  console.warn(`[innovalley] ${text}`);
  if (!env.ADMIN_SLACK_WEBHOOK_URL) return;
  const error = await postToSlack(env.ADMIN_SLACK_WEBHOOK_URL, {
    text: `⚠️ ${text}`,
  });
  if (error) console.error(`[innovalley] 관리자 알림 실패: ${error}`);
}

function kstHourMinute(now: Date): [number, number] {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return [get("hour"), get("minute")];
}

// wrangler.jsonc의 이노밸리 크론(매일 08:00~12:40 KST, 20분 간격) 중 마지막 실행인지.
export function isLastInnovalleyRun(now: Date): boolean {
  const [h, m] = kstHourMinute(now);
  return h === 12 && m >= 40;
}

/**
 * 크론 1회분: 이번 주 메뉴 수집(필요할 때만) → 오늘 발송(아직 안 보냈으면).
 * 카카오 채널은 보통 월요일 오전에 올라오므로 여러 번 확인하다가 올라오는 즉시 보낸다.
 * 마지막 실행까지 못 보냈으면(평일, 휴무 아님) 관리자에게 한 번 알린다.
 */
export async function runInnovalleyCron(
  env: Env,
  now: Date = new Date(),
): Promise<void> {
  const today = todayKST(now);
  let syncError: string | null = null;
  try {
    const sync = await syncInnovalley(env, today);
    if (sync.status !== "skipped") {
      console.log(
        `[innovalley] sync ${sync.status}`,
        sync.reasons,
        sync.warnings,
      );
    }
  } catch (e) {
    syncError = errMsg(e);
    console.error(`[innovalley] 수집 실패: ${syncError}`);
  }

  const result = await notifyInnovalleyToday(env, today);
  console.log(`[innovalley] notify ${result.code}`, result.reason ?? "");

  const weekday = !["토", "일"].includes(weekdayKo(today));
  const missed = ["not_published", "empty", "failed"].includes(result.code);
  if (weekday && missed && isLastInnovalleyRun(now)) {
    const why = [result.reason, syncError && `수집 오류: ${syncError}`]
      .filter(Boolean)
      .join("\n");
    await alertAdmin(
      env,
      `오늘(${today}) 이노밸리 중식을 보내지 못했어요(식당 휴무일일 수도 있어요).\n${why}`,
    );
  }
}
