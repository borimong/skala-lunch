import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Day, Meal, WeeklyMenu } from "../../shared/menu";
import { fetchCurrentWeek, fetchNutrition } from "../lib/api";
import type { DishNutrition } from "../lib/api";

// 김현수님이 주신 "상세화면 디자인가이드"를 그대로 따른 레이아웃(메뉴/제공량/
// 탄단지/칼로리/출처 표 + 합계 행). 원본 파이썬 프로젝트(skala-meal-macros)의
// generate_page.py가 만들던 페이지와 같은 골격이다. 2026-09-09에 DB조회
// 경로를 다시 넣으면서 출처/이상치 배지도 같이 복원함.

const RELIABILITY_BADGE: Record<string, string> = {
  high: "🟢 DB",
  medium: "🟡 DB유사",
  low: "🟠 AI추정",
};

function SourceBadge({ n }: { n?: DishNutrition }) {
  if (!n) return <span className="text-gray-300">—</span>; // 아직 계산 안 됐거나 실패한 요리
  if (n.outlier) return <span className="text-amber-600">⚠️ 이상치의심</span>; // 이상치 배지가 출처 배지보다 우선
  return <span>{RELIABILITY_BADGE[n.reliability] ?? n.source}</span>;
}

// 메뉴 목록(name/isMain)에 API에서 받은 영양정보를 합친 화면용 행 하나.
// 아직 계산 안 된 요리는 DishNutrition 필드가 전부 undefined로 옴(Partial).
type MealRow = { name: string; isMain: boolean } & Partial<DishNutrition>;

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
  const [nutrition, setNutrition] = useState<Record<string, DishNutrition>>({}); // 요리명 -> 영양정보

  useEffect(() => {
    if (!meal) return;
    let alive = true; // 언마운트 후 setState 방지
    fetchNutrition(date, mealType).then((data) => {
      if (alive) setNutrition(data);
    });
    return () => {
      alive = false;
    };
  }, [date, mealType, meal]);

  if (!meal || meal.dishes.length === 0) return null;

  // 메뉴 순서(원본 발행 순서) 그대로 유지하면서 영양정보만 이름으로 매칭.
  const rows: MealRow[] = meal.dishes.map((d) => ({
    name: d.name,
    isMain: d.isMain,
    ...nutrition[d.name],
  }));

  return (
    <section className="mb-8">
      <h2 className="mb-2 text-base font-bold text-gray-800">
        {icon} {title}
      </h2>
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
            {rows.map((r) => {
              const excluded = !!r.excludedReason;
              const valCls = excluded ? "text-gray-400 line-through" : "";
              return (
                <tr key={r.name} className="border-b border-gray-100 last:border-0">
                  <td className={`px-3 py-2 ${r.isMain ? "font-semibold text-gray-900" : "text-gray-700"}`}>
                    {r.name}
                  </td>
                  <td className={`px-3 py-2 text-gray-500 ${valCls}`}>
                    {r.serving_g != null ? `${r.serving_g}g` : "—"}
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
                      <SourceBadge n={r as DishNutrition} />
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
  // day: undefined=로딩 중, null=해당 날짜 메뉴 없음, Day=정상 로드됨
  const [day, setDay] = useState<Day | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!date) return;
    let alive = true;
    fetchCurrentWeek()
      .then((menu: WeeklyMenu | null) => {
        if (!alive) return;
        setDay(menu?.days.find((d) => d.date === date) ?? null);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "알 수 없는 오류");
      });
    return () => {
      alive = false;
    };
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
          영양정보는 AI 추정치이며 실제와 다를 수 있어요.
        </p>
      </main>
    </div>
  );
}
