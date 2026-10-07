import { mondayOf } from "../shared/menu";

// 카카오톡 채널 게시글 목록. 공식 API가 아니라 채널 웹페이지(pf.kakao.com)가 쓰는
// 내부 JSON이라 형식이 바뀔 수 있다. 바뀌면 여기서 예외를 던지고, 호출측이 관리자에게 알린다.
export const INNOVALLEY_CHANNEL_ID = "_LCxlxlxb";

export interface ChannelPost {
  id: string;
  title: string;
  imageUrl: string;
  permalink: string;
  publishedAt: number; // epoch ms
}

interface RawPost {
  id?: number | string;
  title?: string;
  permalink?: string;
  published_at?: number;
  media?: { type?: string; url?: string; xlarge_url?: string }[];
}

export function parsePosts(json: unknown): ChannelPost[] {
  const items = (json as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) {
    throw new Error(
      "카카오 채널 응답에 items 배열이 없어요(형식 변경 가능성).",
    );
  }
  const posts: ChannelPost[] = [];
  for (const raw of items as RawPost[]) {
    const image = raw.media?.find((m) => m.type === "image");
    const imageUrl = image?.xlarge_url ?? image?.url;
    if (raw.id == null || !raw.title || !imageUrl || !raw.published_at) {
      continue;
    }
    posts.push({
      id: String(raw.id),
      title: raw.title,
      imageUrl,
      permalink: raw.permalink?.replace(/^http:/, "https:") ?? "",
      publishedAt: raw.published_at,
    });
  }
  return posts;
}

export async function fetchChannelPosts(
  channelId: string = INNOVALLEY_CHANNEL_ID,
): Promise<ChannelPost[]> {
  const res = await fetch(
    `https://pf.kakao.com/rocket-web/web/profiles/${channelId}/posts`,
    { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } },
  );
  if (!res.ok) {
    throw new Error(`카카오 채널 조회 실패 (${res.status})`);
  }
  return parsePosts(await res.json());
}

function kstDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(
    new Date(ms),
  );
}

/**
 * 게시글 제목 "이노밸리 구내식당 주간메뉴[10/05-10/09]"에서 그 주의 월요일을 구한다.
 * 이미지 안의 제목은 지난주 것이 그대로 남아 있는 경우가 있어(실제 사례) 게시글 제목을 기준으로 삼는다.
 * 연도는 제목에 없으므로 게시 시각과 가장 가까운 해로 정한다(연말연초 대비).
 */
export function weekStartFromTitle(
  title: string,
  publishedAt: number,
): string | null {
  const m = title.match(/\[(\d{1,2})\/(\d{1,2})\s*-\s*\d{1,2}\/\d{1,2}\]/);
  if (!m) return null;
  const month = m[1].padStart(2, "0");
  const day = m[2].padStart(2, "0");
  const published = kstDate(publishedAt);
  const year = Number(published.slice(0, 4));
  const pubTime = new Date(`${published}T00:00:00`).getTime();
  let best: string | null = null;
  let bestDiff = Infinity;
  for (const y of [year - 1, year, year + 1]) {
    const iso = `${y}-${month}-${day}`;
    const t = new Date(`${iso}T00:00:00`).getTime();
    if (Number.isNaN(t)) continue;
    const diff = Math.abs(t - pubTime);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = iso;
    }
  }
  // 제목의 시작일이 월요일이 아니면(오타 등) 그 주 월요일로 맞춘다.
  return best ? mondayOf(best) : null;
}
