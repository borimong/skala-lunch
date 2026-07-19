import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { WeeklyMenu } from "../../shared/menu";
import { toISODate } from "../../shared/menu";
import { fetchCurrentWeek } from "../lib/api";
import WeekView from "../components/WeekView";

export default function HomePage() {
  const [menu, setMenu] = useState<WeeklyMenu | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showOrigin, setShowOrigin] = useState(false);
  const today = toISODate(new Date());

  useEffect(() => {
    let alive = true;
    fetchCurrentWeek()
      .then((m) => {
        if (alive) setMenu(m);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : "알 수 없는 오류");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">
        <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">
              주간 식단표
            </h1>
            {menu && (
              <p className="mt-1 text-sm text-gray-500">
                {menu.cafeteria ?? "구내식당"} ·{" "}
                {formatRange(menu.weekStart, menu.weekEnd)}
              </p>
            )}
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={showOrigin}
              onChange={(e) => setShowOrigin(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 accent-emerald-600"
            />
            원산지 표시
          </label>
        </header>

        {loading && <StateBox>불러오는 중…</StateBox>}
        {error && <StateBox tone="error">{error}</StateBox>}
        {!loading && !error && !menu && (
          <StateBox>아직 등록된 식단표가 없어요.</StateBox>
        )}
        {menu && <WeekView menu={menu} today={today} showOrigin={showOrigin} />}

        {menu?.notes && menu.notes.length > 0 && (
          <footer className="mt-6 space-y-1 text-xs text-gray-400">
            {menu.notes.map((note, i) => (
              <p key={i}>· {note}</p>
            ))}
          </footer>
        )}

        <div className="mt-8 text-center">
          <Link
            to="/admin"
            className="text-xs text-gray-300 hover:text-gray-500"
          >
            관리자
          </Link>
        </div>
      </main>
    </div>
  );
}

function formatRange(start: string, end: string) {
  return `${start.replace(/-/g, ".")} ~ ${end.slice(5).replace("-", ".")}`;
}

function StateBox({ children, tone }: { children: ReactNode; tone?: "error" }) {
  const cls =
    tone === "error"
      ? "border-red-200 bg-red-50 text-red-600"
      : "border-gray-200 bg-white text-gray-500";
  return (
    <div className={`rounded-xl border p-8 text-center text-sm ${cls}`}>
      {children}
    </div>
  );
}
