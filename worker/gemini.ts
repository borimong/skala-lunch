import type { WeeklyMenu } from "../shared/menu";
import { addDaysISO, weeklyMenuSchema } from "../shared/menu";

const mealSchema = {
  type: "OBJECT",
  properties: {
    dishes: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          isMain: { type: "BOOLEAN" },
        },
        required: ["name", "isMain"],
      },
    },
    origin: { type: "STRING" },
  },
  required: ["dishes"],
} as const;

const daySchema = {
  type: "OBJECT",
  properties: {
    date: { type: "STRING" },
    weekday: { type: "STRING" },
    label: { type: "STRING" },
    isHoliday: { type: "BOOLEAN" },
    lunch: mealSchema,
    dinner: mealSchema,
    dessert: { type: "STRING" },
  },
  required: ["date", "weekday"],
} as const;

const responseSchema = {
  type: "OBJECT",
  properties: {
    weekStart: { type: "STRING" },
    weekEnd: { type: "STRING" },
    cafeteria: { type: "STRING" },
    days: { type: "ARRAY", items: daySchema },
    notes: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["days"],
} as const;

function buildPrompt(weekStart: string): string {
  return `당신은 한국어 구내식당 '주간 메뉴표' 사진에서 식단 정보를 정확히 추출하는 도우미입니다.

[표 구조]
- 가로(열)는 평일 5일이며, 각 열 상단에 '월 일'(예: 7월 14일) 날짜가 적혀 있습니다. 요일 이름은 없을 수 있습니다.
- 세로(행)는 위에서부터 중식(점심) → 후식(차) → 석식(저녁) 순서입니다.
- 각 칸 오른쪽에는 원산지 정보(예: '돈육:국내산')가 별도로 적혀 있습니다.
- 빨간색/파란색으로 강조된 상단 1~2개 요리가 그날의 '메인'입니다. 밥/국/김치/샐러드/장아찌 같은 사이드는 메인이 아닙니다.

[추출 규칙]
- 이 주의 월요일은 ${weekStart} 입니다. 각 열의 date(YYYY-MM-DD)는 이 연도를 사용하고 사진에 적힌 월/일을 반영해 채우세요. weekday는 한국어 한 글자(월/화/수/목/금)로 채우세요.
- 각 날짜의 lunch(중식)와 dinner(석식)에 dishes를 사진 순서대로 넣고, 메인 요리는 isMain=true, 나머지는 isMain=false로 표시하세요.
- 후식의 차(예: 결명자차)는 그 날짜의 dessert에 넣으세요.
- 각 끼니의 원산지 문구는 origin에 원문 그대로 넣으세요.
- '초복', '제헌절' 같은 특별일 표기가 있으면 그 날짜의 label에 넣으세요. 메뉴 없이 안내/그래픽만 있는 날은 isHoliday=true로 하고 lunch/dinner는 비워두세요.
- 사진에 없는 내용을 지어내지 마세요. 읽을 수 없으면 생략하세요.
- 식당명이 보이면 cafeteria에, 하단 안내문이 보이면 notes에 넣으세요.

반드시 제공된 JSON 스키마에 맞춰 한국어로만 출력하세요.`;
}

function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
  }[];
}

export async function extractMenu(
  env: Env,
  image: ArrayBuffer,
  mimeType: string,
  weekStart: string,
): Promise<WeeklyMenu> {
  if (!env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY가 설정되지 않았어요. .dev.vars 또는 시크릿을 확인해 주세요.",
    );
  }

  const model = env.GEMINI_MODEL || "gemini-3.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body = {
    contents: [
      {
        parts: [
          { text: buildPrompt(weekStart) },
          {
            inline_data: {
              mime_type: mimeType || "image/jpeg",
              data: toBase64(image),
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(
      `Gemini API 오류 (${res.status}): ${errText.slice(0, 500)}`,
    );
  }

  const json = (await res.json()) as GeminiResponse;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini 응답에서 결과 텍스트를 찾지 못했어요.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini가 유효한 JSON을 반환하지 않았어요.");
  }

  // 날짜 범위는 관리자가 지정한 월요일 기준으로 보정 (모델 계산보다 신뢰)
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    obj.weekStart = weekStart;
    obj.weekEnd = addDaysISO(weekStart, 4);
  }

  const result = weeklyMenuSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `추출 결과 형식이 예상과 달라요: ${JSON.stringify(result.error.issues).slice(0, 400)}`,
    );
  }
  return result.data;
}
