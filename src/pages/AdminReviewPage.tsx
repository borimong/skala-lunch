import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import type { Day, Meal, WeeklyMenu } from "../../shared/menu";
import { publishMenu } from "../lib/adminApi";

type ReviewState = { menu: WeeklyMenu; imageKey?: string };

export default function AdminReviewPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as ReviewState | null;
  const [menu, setMenu] = useState<WeeklyMenu | null>(state?.menu ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!menu) return <Navigate to="/admin" replace />;

  const updateDay = (i: number, patch: Partial<Day>) =>
    setMenu((m) =>
      m
        ? {
            ...m,
            days: m.days.map((d, idx) => (idx === i ? { ...d, ...patch } : d)),
          }
        : m,
    );

  async function publish() {
    if (!menu) return;
    setBusy(true);
    setError(null);
    try {
      await publishMenu(menu, state?.imageKey);
      setDone(true);
      setTimeout(() => navigate("/"), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "발행에 실패했어요.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">추출 결과 검수</h1>
            <p className="text-xs text-gray-500">
              {menu.weekStart} ~ {menu.weekEnd} · 확인하고 고친 뒤 발행하세요
            </p>
          </div>
          <button
            onClick={publish}
            disabled={busy || done}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {done ? "발행 완료 ✓" : busy ? "발행 중…" : "발행하기"}
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-4">
          <input
            value={menu.cafeteria ?? ""}
            onChange={(e) =>
              setMenu((m) => (m ? { ...m, cafeteria: e.target.value } : m))
            }
            placeholder="식당명 (선택)"
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
          />
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {menu.days.map((day, i) => (
            <DayCard
              key={day.date}
              day={day}
              onChange={(patch) => updateDay(i, patch)}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

function DayCard({
  day,
  onChange,
}: {
  day: Day;
  onChange: (patch: Partial<Day>) => void;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <header className="mb-2 flex items-center justify-between">
        <div className="flex items-baseline gap-1.5">
          <span className="text-base font-bold text-gray-900">
            {day.weekday}
          </span>
          <span className="text-xs text-gray-400">
            {day.date.slice(5).replace("-", "/")}
          </span>
        </div>
        <label className="flex items-center gap-1 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={day.isHoliday ?? false}
            onChange={(e) => onChange({ isHoliday: e.target.checked })}
            className="accent-amber-500"
          />
          휴무/행사
        </label>
      </header>

      <input
        value={day.label ?? ""}
        onChange={(e) => onChange({ label: e.target.value || undefined })}
        placeholder="특별일 (예: 초복)"
        className="mb-3 w-full rounded border border-gray-200 px-2 py-1 text-xs"
      />

      {!day.isHoliday && (
        <div className="space-y-3">
          <MealEditor
            title="중식"
            accent="text-emerald-700"
            meal={day.lunch}
            onChange={(m) => onChange({ lunch: m })}
          />
          <MealEditor
            title="석식"
            accent="text-indigo-700"
            meal={day.dinner}
            onChange={(m) => onChange({ dinner: m })}
          />
          <div>
            <div className="mb-1 text-xs font-bold text-gray-500">후식</div>
            <input
              value={day.dessert ?? ""}
              onChange={(e) =>
                onChange({ dessert: e.target.value || undefined })
              }
              placeholder="차 (예: 결명자차)"
              className="w-full rounded border border-gray-200 px-2 py-1 text-sm"
            />
          </div>
        </div>
      )}
    </section>
  );
}

function MealEditor({
  title,
  accent,
  meal,
  onChange,
}: {
  title: string;
  accent: string;
  meal?: Meal;
  onChange: (meal: Meal) => void;
}) {
  const value: Meal = meal ?? { dishes: [] };
  const setDishes = (dishes: Meal["dishes"]) => onChange({ ...value, dishes });

  return (
    <div>
      <div className={`mb-1 text-xs font-bold ${accent}`}>{title}</div>
      <div className="space-y-1">
        {value.dishes.map((dish, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <label className="flex items-center gap-0.5 text-[10px] text-gray-400">
              <input
                type="checkbox"
                checked={dish.isMain}
                onChange={(e) =>
                  setDishes(
                    value.dishes.map((d, idx) =>
                      idx === i ? { ...d, isMain: e.target.checked } : d,
                    ),
                  )
                }
              />
              메인
            </label>
            <input
              value={dish.name}
              onChange={(e) =>
                setDishes(
                  value.dishes.map((d, idx) =>
                    idx === i ? { ...d, name: e.target.value } : d,
                  ),
                )
              }
              className="flex-1 rounded border border-gray-200 px-2 py-1 text-sm"
            />
            <button
              type="button"
              onClick={() =>
                setDishes(value.dishes.filter((_, idx) => idx !== i))
              }
              className="px-1 text-gray-300 hover:text-red-500"
              aria-label="삭제"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setDishes([...value.dishes, { name: "", isMain: false }])
          }
          className="text-xs text-emerald-600 hover:text-emerald-700"
        >
          + 메뉴 추가
        </button>
      </div>
      <input
        value={value.origin ?? ""}
        onChange={(e) => onChange({ ...value, origin: e.target.value })}
        placeholder="원산지 (선택)"
        className="mt-1 w-full rounded border border-gray-100 px-2 py-1 text-[11px] text-gray-500"
      />
    </div>
  );
}
