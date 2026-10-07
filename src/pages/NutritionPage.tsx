import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Day, Meal, WeeklyMenu } from "../../shared/menu";
import { fetchCurrentWeek, fetchNutrition } from "../lib/api";
import type { DishNutrition } from "../lib/api";

// 김현수님이 주신 "상세화면 디자인가이드"를 그대로 따른 레이아웃(메뉴/제공량/
// 탄단지/칼로리/출처 표 + 합계 행). 원본 파이썬 프로젝트(skala-meal-macros)의
// generate_page.py가 만들던 페이지와 같은 골격이다. 2026-09-09에 DB조회
// 경로를 다시 넣으면서 출처/이상치 배지도 같이 복원함.
// DishNutritionㅇ

const RELIABILITY_BADGE: Record<string, string> = {
  high: "🟢 DB",
  medium: "🟡 DB유사",
  low: "🟠 AI추정",
};

function SourceBadge({ n }: { n?: DishNutrition }) {
  if (!n) return <span className="text-gray-300">—</span>;
  if (n.outlier) return <span className="text-amber-600">⚠️ 이상치의심</span>;
  return <span>{RELIABILITY_BADGE[n.reliability] ?? n.source}</span>;
}

type MealRow = { name: string; isMain: boolean } & Partial<DishNutrition>;

// 영양정보가 아직 없는 행(Partial)인지 타입 단언(as) 대신 실제로 검사해서 좁힌다.
function hasNutrition(r: MealRow): r is MealRow & DishNutrition {
  return r.serving_g != null && r.kcal != null && r.reliability != null;
}

// 사용자가 1회 제공량을 직접 바꾸면, 서버 재계산(Gemini 호출) 없이 프론트에서
// 바로 비율 계산: 탄단지는 제공량 비율만큼 같이 늘리고/줄이고, kcal은 그
// 값으로 다시 계산(탄4/단4/지9 — worker/nutrition.ts의 kcalFromMacros와 동일 공식).
function scaleServing(n: DishNutrition, newServingG: number): DishNutrition {
  if (!n.serving_g || n.serving_g <= 0) return n;
  const ratio = newServingG / n.serving_g;
  const carb_g = Math.round(n.carb_g * ratio * 10) / 10;
  const protein_g = Math.round(n.protein_g * ratio * 10) / 10;
  const fat_g = Math.round(n.fat_g * ratio * 10) / 10;
  const kcal = Math.round(carb_g * 4 + protein_g * 4 + fat_g * 9);
  return { ...n, serving_g: newServingG, carb_g, protein_g, fat_g, kcal };
}

// 다른 메뉴(예: 국밥)에 이미 포함됐다고 에이전트가 판단한 요리는
// 합계에서 뺀다(값 자체는 화면에 취소선으로 그대로 보여줌 — 원본 파이썬
// generate_page.py와 동일한 방식).
function sumField(rows: MealRow[], field: "carb_g" | "protein_g" | "fat_g" | "kcal"): number {
  return rows.reduce((sum, r) => sum + (r.excludedReason ? 0 : (r[field] ?? 0)), 0);
}

function MealTable({
  title,
  icon,
  meal,
  date,
  mealType,
}: {
  title: string;
  icon: string;
  meal?: Meal;
  date: string;
  mealType: "lunch" | "dinner";
}) {
  // 받아온 결과를 "어느 날짜·끼니 것인지(key)"와 함께 둔다. key가 지금과 다르면 아직 받는 중.
  const key = `${date}|${mealType}`;
  const [loaded, setLoaded] = useState<{ key: string; data: Record<string, DishNutrition> | null }>();
  // 사용자가 직접 입력한 제공량(요리명 -> g). 페이지 새로고침하면 초기화됨(서버 저장 안 함).
  const [servingOverrides, setServingOverrides] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!meal) return;
    // React 공식 문서의 race condition 방지 패턴(react.dev/reference/react/useEffect, "Fetching data with Effects").
    // 늦게 도착한 이전 요청의 응답이 새 화면을 덮어쓰지 않게 한다. state로 두면 이전 렌더의 값을 보게 돼서 동작하지 않는다.
    let ignore = false;
    fetchNutrition(date, mealType)
      .then((data) => {
        if (!ignore) setLoaded({ key, data });
      })
      .catch((e: unknown) => {
        console.error(e);
        if (!ignore) setLoaded({ key, data: null }); // data: null = 실패
      });
    return () => {
      ignore = true;
    };
  }, [key, date, mealType, meal]);

  const status = loaded?.key !== key ? "loading" : loaded.data === null ? "error" : "done";
  const nutrition = status === "done" ? (loaded?.data ?? {}) : {};

  if (!meal || meal.dishes.length === 0) return null;

  // 사용자가 제공량을 수정했으면(servingOverrides) 원본 대신 그 비율로 재계산된 값을 씀.
  const rows: MealRow[] = meal.dishes.map((d) => {
    const base = nutrition[d.name];
    const override = servingOverrides[d.name];
    const n = base && override != null ? scaleServing(base, override) : base;
    return { name: d.name, isMain: d.isMain, ...n };
  });

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-base font-bold text-gray-800">
        {icon} {title}
      </h2>
      {status === "loading" && <p className="mb-2 text-xs text-gray-400">영양정보 불러오는 중…</p>}
      {status === "error" && <p className="mb-2 text-xs text-red-500">영양정보를 불러오지 못했어요.</p>}
      {status === "done" && Object.keys(nutrition).length === 0 && (
        <p className="mb-2 text-xs text-gray-400">아직 계산된 영양정보가 없어요. (매일 새벽 5시에 계산돼요)</p>
      )}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs text-gray-500">
              <th className="px-3 py-2 font-medium">메뉴</th>
              <th className="px-3 py-2 font-medium">1회 제공량</th>
              <th className="px-3 py-2 font-medium">탄/단/지</th>
              <th className="px-3 py-2 font-medium">칼로리</th>
              <th className="px-3 py-2 font-medium">출처</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const excluded = !!r.excludedReason;
              const valCls = excluded ? "text-gray-400 line-through" : "";
              return (
                // 메뉴 데이터엔 id가 없고 같은 끼니에 같은 이름이 두 번 나올 수도 있어서
                // 순서+이름으로 key를 만든다(한 끼니의 메뉴 순서는 바뀌지 않음).
                <tr key={`${i}-${r.name}`} className="border-b border-gray-100 last:border-0">
                  <td className={`px-3 py-2 ${r.isMain ? "font-semibold text-gray-900" : "text-gray-700"}`}>
                    {r.name}
                  </td>
                  <td className={`px-3 py-2 text-gray-500 ${valCls}`}>
                    {r.serving_g != null ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-right text-gray-700 disabled:bg-transparent disabled:border-transparent"
                          value={r.serving_g}
                          disabled={excluded}
                          onChange={(e) => {
                            if (e.target.value === "") return; // 칸을 비우는 중엔 0g으로 바꾸지 않음
                            const next = Number(e.target.value);
                            if (!Number.isFinite(next) || next < 0) return;
                            setServingOverrides((prev) => ({ ...prev, [r.name]: next }));
                          }}
                        />
                        g
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className={`px-3 py-2 text-gray-500 ${valCls}`}>
                    {r.carb_g != null ? `${r.carb_g}g / ${r.protein_g}g / ${r.fat_g}g` : "—"}
                  </td>
                  <td className={`px-3 py-2 font-medium text-gray-900 ${valCls}`}>
                    {r.kcal != null ? `${r.kcal}kcal` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {excluded ? (
                      <span className="text-gray-400">🔁 {r.excludedReason}</span>
                    ) : (
                      <SourceBadge n={hasNutrition(r) ? r : undefined} />
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="bg-gray-50 font-bold text-gray-900">
              <td className="px-3 py-2" colSpan={2}>
                합계
              </td>
              <td className="px-3 py-2">
                {sumField(rows, "carb_g").toFixed(1)}g / {sumField(rows, "protein_g").toFixed(1)}g /{" "}
                {sumField(rows, "fat_g").toFixed(1)}g
              </td>
              <td className="px-3 py-2">{sumField(rows, "kcal")}kcal</td>
              <td className="px-3 py-2"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function NutritionPage() {
  const { date } = useParams<{ date: string }>();
  const [day, setDay] = useState<Day | null | undefined>(undefined);
  // 화면 상태 3가지를 하나로 표현:
  //   undefined = 아직 받는 중 → "불러오는 중…"
  //   null      = 받았는데 그 날짜가 없음 → "메뉴를 찾을 수 없어요"
  //   Day 객체  = 찾음 → 표 그리기

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!date) return;
    let ignore = false; // MealTable과 같은 공식 race condition 방지 패턴
    fetchCurrentWeek()
      .then((menu: WeeklyMenu | null) => {
        if (ignore) return;
        setDay(menu?.days.find((d) => d.date === date) ?? null);
      })
      // 일주일 중 그 날짜만 골라서 day에 넣음 → 화면이 다시 그려짐
      .catch((e: unknown) => {
        if (!ignore) setError(e instanceof Error ? e.message : "알 수 없는 오류");
      });
    return () => {
      ignore = true;
    };
    // 정리 함수: 페이지를 떠나거나 date가 바뀌면 이전 요청의 응답은 무시
  }, [date]);

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <h1 className="mb-6 text-xl font-bold text-gray-900">
          🍱 SKALA 오늘의 영양정보 ({date})
        </h1>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-600">
            {error}
          </div>
        )}
        {day === undefined && !error && (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            불러오는 중…
          </div>
        )}
        {day === null && !error && (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            이 날짜의 메뉴를 찾을 수 없어요.
          </div>
        )}
        {day && (
          <>
            <MealTable title="중식" icon="🥗" meal={day.lunch} date={day.date} mealType="lunch" />
            <MealTable title="석식" icon="🍲" meal={day.dinner} date={day.date} mealType="dinner" />
          </>
        )}

        <p className="mt-4 text-xs text-gray-400">
          영양정보는 AI 추정치이며 실제와 다를 수 있어요. 1회 제공량을 직접
          입력하면 실제 먹은 양 기준으로 탄단지/칼로리가 다시 계산돼요.
        </p>
      </main>
    </div>
  );
}
