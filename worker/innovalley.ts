import { z } from "zod";
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
// 모델에게는 중식 표를 줄 단위로 그대로 읽게 하고(왼쪽 코너 이름 칸, 5일치 칸),
// 줄을 코너로 묶는 일은 코드가 한다. 코너 경계는 얇은 테두리선 하나뿐이라 모델에게 맡기면
// 샐러드바 첫 줄이 면 코너로 붙는 일이 반복됐다(배경색을 물어도 주황 줄을 흰색으로 답함).

const responseSchema = {
  type: "OBJECT",
  properties: {
    columns: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          date: { type: "STRING" },
          weekday: { type: "STRING" },
          isHoliday: { type: "BOOLEAN" },
          label: { type: "STRING" },
        },
        required: ["date", "weekday", "isHoliday"],
      },
    },
    rows: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          cornerLabel: { type: "STRING" },
          cells: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                text: { type: "STRING" },
                isMain: { type: "BOOLEAN" },
              },
              required: ["text", "isMain"],
            },
          },
        },
        required: ["cornerLabel", "cells"],
      },
    },
  },
  required: ["columns", "rows"],
} as const;

const rawGridSchema = z.object({
  columns: z.array(
    z.object({
      date: z.string(),
      weekday: z.string(),
      isHoliday: z.boolean().default(false),
      label: z.string().optional(),
    }),
  ),
  rows: z.array(
    z.object({
      cornerLabel: z.string(),
      cells: z.array(
        z.object({ text: z.string(), isMain: z.boolean().default(false) }),
      ),
    }),
  ),
});

export type InnovalleyGrid = z.infer<typeof rawGridSchema>;

function buildPrompt(weekStart: string): string {
  return `당신은 사내 식당 '이노밸리 주간 메뉴' 이미지에서 중식(점심) 표를 줄 단위로 정확히 옮겨 적는 도우미입니다.

[표 구조]
- 가로(열)는 월~금 5일이며, 각 열 상단에 요일과 날짜(YYYY-MM-DD)가 적혀 있습니다.
- 이미지 맨 위 큰 제목의 날짜 범위는 지난주 것이 남아 있을 때가 있으니 무시하고, 반드시 열 상단의 날짜를 쓰세요.
- 세로(행)는 위에서부터 조식 → 중식 → 석식 → Take Out 구역입니다.
- 중식 구역은 왼쪽 칸에 코너 이름이 있습니다: Korean(한식), Western(양식), Noodle(대면), 샐러드바.
- 색 글씨(빨강, 초록, 보라 등)로 강조된 요리가 메인입니다.

[출력 규칙]
- 이 주의 월요일은 ${weekStart} 입니다. columns에 월~금 5개 열을 순서대로 넣고, date는 YYYY-MM-DD, weekday는 한국어 한 글자(월/화/수/목/금)로 채우세요.
- 메뉴 없이 '대체공휴일', '한글날' 같은 큰 글씨나 그림만 있는 열은 isHoliday=true, label에 그 이름을 넣으세요.
- rows에는 중식 구역의 가로줄을 위에서 아래로 빠짐없이 한 줄씩 넣으세요. 가로줄은 점선으로 구분되며, 한 줄의 각 칸에는 요리가 하나씩만 있습니다. 여러 요리를 한 칸에 합치지 마세요.
- 조식, 석식, Take Out, 오른쪽의 요일별 샐러드 표는 넣지 마세요.
- cornerLabel에는 그 줄 왼쪽 코너 이름 칸의 글자를 그대로 쓰세요.
- cells에는 그 줄의 칸을 월~금 순서로 정확히 5개 넣으세요. 빈 칸이나 휴무 열은 text를 빈 문자열로 두세요. 메인 요리는 isMain=true로 표시하세요.
- 요리 이름은 글자 하나하나 이미지에 적힌 그대로 옮기세요. 맞춤법이 틀려 보여도 고치지 말고, '&', '/', 괄호 같은 표기도 원문 그대로 두세요.
- 이미지에 없는 내용을 지어내지 마세요.

반드시 제공된 JSON 스키마에 맞춰 한국어로만 출력하세요.`;
}

// 코너는 이 순서로만 진행한다(아래 줄이 위 코너로 되돌아가지 않음).
const CORNERS: [string, RegExp][] = [
  ["한식", /korean|한식/i],
  ["양식", /western|양식/i],
  ["면", /noodle|대면|면/i],
  ["샐러드바", /샐러드|salad/i],
];
const SALAD_BAR = CORNERS.length - 1;

// 이노밸리 메뉴표의 샐러드바는 매일 요리 세 개이고 마지막은 늘 '현미밥/보리밥/숭늉/차'다.
// 날짜 칸의 마지막 요리가 숭늉이면 이 고정 양식을 믿고 아래 세 개를 샐러드바로 묶는다.
// 줄 위치로 자르지 않는 이유: 면 코너에 빈 칸이 있으면 모델이 그 칸을 건너뛰고 아래 요리를 한 줄씩 당겨 적는다.
// 숭늉이 없으면(양식 변경) 이름표를 따른다.
const SALAD_BAR_SIZE = 3;
const SALAD_BAR_LAST_DISH = /숭늉/;

interface PlacedDish {
  corner: number;
  name: string;
  isMain: boolean;
}

/** 줄 단위로 읽은 표를 날짜별 코너 구조로 바꾼다. 코너 경계는 코드가 정한다. */
export function gridToWeek(
  grid: InnovalleyGrid,
  weekStart: string,
): InnovalleyWeek {
  // 이름표 기준 코너(위에서 아래로만 진행)
  const rowCorners: number[] = [];
  let current = 0;
  for (const row of grid.rows) {
    const labeled = CORNERS.findIndex(([, re]) => re.test(row.cornerLabel));
    if (labeled > current) current = labeled;
    rowCorners.push(current);
  }

  const days: InnovalleyDay[] = grid.columns.map((col, i) => {
    const placed: PlacedDish[] = grid.rows.flatMap((row, ri) => {
      const cell = row.cells[i];
      // 모델이 한 칸에 요리 여러 개를 줄바꿈으로 합쳐 보낼 때가 있어 나눈다.
      return (cell?.text ?? "")
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((name) => ({ corner: rowCorners[ri], name, isMain: cell.isMain }));
    });

    const last = placed.at(-1);
    if (last && SALAD_BAR_LAST_DISH.test(last.name)) {
      const from = placed.length - SALAD_BAR_SIZE;
      placed.forEach((d, di) => {
        d.corner = di >= from ? SALAD_BAR : Math.min(d.corner, SALAD_BAR - 1);
      });
    }

    const corners = CORNERS.map(([name], ci) => ({
      name,
      dishes: placed
        .filter((d) => d.corner === ci)
        .map(({ name, isMain }) => ({ name, isMain })),
    })).filter((c) => c.dishes.length > 0);
    return {
      date: col.date,
      weekday: col.weekday,
      ...(col.label && { label: col.label }),
      ...(col.isHoliday && { isHoliday: true }),
      corners: col.isHoliday ? [] : corners,
    };
  });

  return { weekStart, weekEnd: addDaysISO(weekStart, 4), days };
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
    // 한 장에 5일치 조식~Take Out이 다 들어 있어 글씨가 작다. 오탈자를 줄이려고 최고 해상도로 읽힌다.
    { mediaResolution: "MEDIA_RESOLUTION_ULTRA_HIGH" },
  );
  const grid = rawGridSchema.safeParse(parsed);
  if (!grid.success) {
    throw new Error(
      `추출 결과 형식이 예상과 달라요: ${JSON.stringify(grid.error.issues).slice(0, 400)}`,
    );
  }
  const badRow = grid.data.rows.findIndex((r) => r.cells.length !== 5);
  if (badRow !== -1) {
    throw new Error(
      `중식 ${badRow + 1}번째 줄의 칸 수가 5개가 아니에요(${grid.data.rows[badRow].cells.length}개).`,
    );
  }
  return innovalleyWeekSchema.parse(gridToWeek(grid.data, weekStart));
}

// 여러 번 읽어 비교 (같은 이미지라도 읽을 때마다 글자가 조금씩 다르게 나온다)

export const INNOVALLEY_READS = 3;

const sameName = (name: string) => name.replace(/\s+/g, "");

function mostCommon<T>(items: T[], key: (x: T) => string): [T, number] {
  const counts = new Map<string, { item: T; n: number }>();
  for (const item of items) {
    const k = key(item);
    const c = counts.get(k);
    if (c) c.n++;
    else counts.set(k, { item, n: 1 });
  }
  // 동점이면 먼저 나온 쪽(앞선 읽기)을 고른다.
  let best = { item: items[0], n: 0 };
  for (const c of counts.values()) if (c.n > best.n) best = c;
  return [best.item, best.n];
}

/**
 * 같은 주를 여러 번 읽은 결과를 날짜, 코너, 순서별 다수결로 합친다.
 * 다수결이 틀릴 수도 있어서(같은 글자를 반복해서 잘못 읽는 경우) 결과가 갈린 곳은 따로 돌려준다.
 * 띄어쓰기만 다른 이름은 같은 요리로 본다.
 */
export function mergeReads(reads: InnovalleyWeek[]): {
  week: InnovalleyWeek;
  disagreements: string[];
} {
  const [first] = reads;
  const disagreements: string[] = [];

  const days: InnovalleyDay[] = first.days.map((baseDay) => {
    const sameDay = reads
      .map((w) => w.days.find((d) => d.date === baseDay.date))
      .filter((d): d is InnovalleyDay => d !== undefined);
    const where = `${baseDay.date.slice(5)}(${baseDay.weekday})`;

    const [holidayVote] = mostCommon(sameDay, (d) => String(!!d.isHoliday));
    if (new Set(sameDay.map((d) => !!d.isHoliday)).size > 1) {
      disagreements.push(`${where}: 휴무 여부가 읽을 때마다 달라요`);
    }
    if (holidayVote.isHoliday) return holidayVote;

    const cornerNames = [
      ...new Set(sameDay.flatMap((d) => d.corners.map((c) => c.name))),
    ];
    const corners = cornerNames.map((name) => {
      const lists = sameDay.map(
        (d) => d.corners.find((c) => c.name === name)?.dishes ?? [],
      );
      const [majorityList] = mostCommon(lists, (l) => String(l.length));
      const size = majorityList.length;
      if (lists.some((l) => l.length !== size)) {
        disagreements.push(
          `${where} ${name}: 요리 개수가 읽을 때마다 달라요 (${lists.map((l) => `${l.length}개`).join(", ")})`,
        );
      }
      const voters = lists.filter((l) => l.length === size);
      const dishes = Array.from({ length: size }, (_, i) => {
        const candidates = voters.map((l) => l[i]);
        const [winner] = mostCommon(candidates, (x) => sameName(x.name));
        const tally = new Map<string, number>();
        for (const x of candidates) {
          const k = sameName(x.name);
          tally.set(k, (tally.get(k) ?? 0) + 1);
        }
        if (tally.size > 1) {
          const shown = [...tally].map(([k, n]) => {
            const original = candidates.find((x) => sameName(x.name) === k)!;
            return `${original.name} ${n}회`;
          });
          disagreements.push(`${where} ${name}: ${shown.join(", ")}`);
        }
        const mains = candidates.filter((x) => x.isMain).length;
        return { name: winner.name, isMain: mains * 2 > candidates.length };
      });
      return { name, dishes };
    });

    return { ...holidayVote, corners };
  });

  return {
    week: { weekStart: first.weekStart, weekEnd: first.weekEnd, days },
    disagreements,
  };
}

/** 같은 이미지를 여러 번 읽어 다수결로 합친다. 일부 읽기가 실패해도 성공한 것끼리 비교한다. */
export async function extractInnovalleyByVote(
  env: Env,
  image: ArrayBuffer,
  mimeType: string,
  weekStart: string,
  reads: number = INNOVALLEY_READS,
): Promise<{ week: InnovalleyWeek; disagreements: string[] }> {
  const ok: InnovalleyWeek[] = [];
  const errors: string[] = [];
  // 무료 등급의 분당 요청 한도를 넘지 않게 차례로 읽는다.
  for (let i = 0; i < reads; i++) {
    try {
      ok.push(await extractInnovalley(env, image, mimeType, weekStart));
    } catch (e) {
      errors.push(errMsg(e));
    }
  }
  if (ok.length === 0) throw new Error(errors[0]);
  const merged = mergeReads(ok);
  if (ok.length < reads) {
    merged.disagreements.unshift(
      `${reads}번 중 ${ok.length}번만 읽기에 성공해 비교가 부족해요 (${errors[0]})`,
    );
  }
  return merged;
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
  // 여러 번 읽은 결과가 갈린 곳(다수결로 발행하고 관리자에게 알림)
  disagreements: string[];
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
  let disagreements: string[];
  try {
    ({ week, disagreements } = await extractInnovalleyByVote(
      env,
      buf,
      mime,
      weekStart,
    ));
  } catch (e) {
    const reasons = [`추출 실패: ${errMsg(e)}`];
    await saveInnovalleyRow(env.DB, {
      ...base,
      menu: null,
      status: "held",
      reasons,
    });
    return {
      status: "held",
      weekStart,
      reasons,
      warnings: [],
      disagreements: [],
    };
  }

  const v = validateInnovalley(week, weekStart);
  const status = v.ok ? "published" : "held";
  await saveInnovalleyRow(env.DB, {
    ...base,
    menu: week,
    status,
    reasons: v.hardErrors,
  });
  return {
    status,
    weekStart,
    reasons: v.hardErrors,
    warnings: v.softWarnings,
    disagreements,
  };
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
    disagreements: [],
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
      disagreements: [],
    };
  }
  if (!force && existing?.postId === post.id && existing.menu) {
    return skipped(`보류 중인 게시글이에요: ${existing.reasons.join(" / ")}`);
  }

  const result = await ingestPost(env, post, weekStart);
  // 같은 게시글로 처음 보류될 때만 알린다(추출 오류 재시도마다 알림이 쌓이지 않게).
  const firstHold = !(existing && existing.postId === post.id);
  const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  if (result.status === "held" && (firstHold || force)) {
    const split = result.disagreements.length
      ? `\n읽을 때마다 달랐던 곳:\n${bullets(result.disagreements)}`
      : "";
    await alertAdmin(
      env,
      `이노밸리 ${weekStart} 주 메뉴를 보류했어요.\n${bullets(result.reasons)}${split}\n원본: ${post.permalink}`,
    );
  }
  if (result.status === "published" && result.disagreements.length > 0) {
    await alertAdmin(
      env,
      `이노밸리 ${weekStart} 주 메뉴를 발행했는데, ${INNOVALLEY_READS}번 읽은 결과가 갈린 곳이 있어 다수 쪽으로 넣었어요. 원본과 맞는지 확인해 주세요.\n${bullets(result.disagreements)}\n원본: ${post.permalink}`,
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
        sync.disagreements,
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
