import type { WeeklyMenu } from "../shared/menu";

export interface VerifyResult {
  ok: boolean;
  discrepancies: string[];
}

const responseSchema = {
  type: "OBJECT",
  properties: {
    ok: { type: "BOOLEAN" },
    discrepancies: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["ok", "discrepancies"],
} as const;

// isMain/원산지 등 "무시할 것"을 빼고, 요일×끼니별 메뉴명만 추린 대조용 축약본.
function compactMenu(menu: WeeklyMenu): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const d of menu.days) {
    obj[`${d.weekday} ${d.date}`] = d.isHoliday
      ? "휴무"
      : {
          중식: d.lunch?.dishes.map((x) => x.name) ?? [],
          석식: d.dinner?.dishes.map((x) => x.name) ?? [],
          후식: d.dessert ?? "",
        };
  }
  return obj;
}

function buildPrompt(gridText: string, menu: WeeklyMenu): string {
  return `당신은 구내식당 주간 식단 데이터의 검수자입니다.
[원본 셀]은 엑셀 스프레드시트의 실제 셀 값(주소=값)이고, [추출 결과]는 프로그램이 만든 식단입니다.
[추출 결과]가 [원본 셀]을 정확히 반영하는지 검증하세요.

다음 경우만 discrepancy로 보고하세요:
- 메뉴명이 원본과 다르게 표기됨(오탈자·글자 누락·다른 메뉴).
- 원본에 있는 메뉴가 추출 결과에서 빠졌거나, 원본에 없는 메뉴가 추가됨.
- 어떤 메뉴가 잘못된 요일 또는 잘못된 끼니(중식/석식)에 배치됨.

다음은 정상이니 무시하세요:
- 메뉴 순서 차이, 메인 여부, 원산지 문구, 후식/안내문 표기.

문제가 없으면 ok=true, discrepancies=[]. 문제가 있으면 ok=false, 각 문제를 한국어 한 문장으로 discrepancies에 담으세요.

[원본 셀]
${gridText}

[추출 결과]
${JSON.stringify(compactMenu(menu), null, 0)}`;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/**
 * 결정적 파서 결과(menu)를 엑셀 원본 셀(gridText)과 Gemini로 대조한다.
 * 성공 시 {ok, discrepancies} 반환. API 오류/빈 응답이면 throw(호출측이 무시하고 발행).
 */
export async function verifyWithGemini(
  env: Env,
  gridText: string,
  menu: WeeklyMenu,
): Promise<VerifyResult> {
  const model = env.GEMINI_MODEL || "gemini-3.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(gridText, menu) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini 교차검증 API 오류 (${res.status})`);
  }

  const json = (await res.json()) as GeminiResponse;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini 교차검증 응답이 비어 있습니다.");

  const parsed = JSON.parse(text) as Partial<VerifyResult>;
  return {
    ok: Boolean(parsed.ok),
    discrepancies: Array.isArray(parsed.discrepancies)
      ? parsed.discrepancies.filter((d): d is string => typeof d === "string")
      : [],
  };
}
