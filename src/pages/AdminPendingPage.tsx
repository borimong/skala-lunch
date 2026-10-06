import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { WeeklyMenu } from "../../shared/menu";
import { type PendingDraft, dismissDraft, fetchPendingDrafts } from "../lib/adminApi";

export default function AdminPendingPage() {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState<PendingDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () =>
    fetchPendingDrafts()
      .then(setDrafts)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "목록을 불러오지 못했어요."),
      );

  useEffect(() => {
    load();
  }, []);

  async function onDismiss(weekStart: string) {
    if (!confirm(`${weekStart} 보류 초안을 목록에서 지울까요?`)) return;
    setBusy(weekStart);
    setError(null);
    try {
      await dismissDraft(weekStart);
      setDrafts((ds) => (ds ?? []).filter((d) => d.menu.weekStart !== weekStart));
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제에 실패했어요.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-1 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">검토 대기 (보류)</h1>
          <Link to="/admin" className="text-sm text-gray-500 hover:text-gray-700">
            ← 올리기
          </Link>
        </div>
        <p className="mb-6 text-xs text-gray-500">
          자동 검증에서 이상이 감지돼 보류된 주입니다. 사유를 확인하고, 검토 화면에서
          필요하면 주 시작일까지 고쳐 발행하세요.
        </p>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {!drafts && !error && (
          <p className="text-sm text-gray-500">불러오는 중…</p>
        )}

        {drafts && drafts.length === 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
            검토 대기 중인 식단이 없어요. 자동 반영이 모두 정상 발행됐습니다. ✓
          </div>
        )}

        {drafts && drafts.length > 0 && (
          <ul className="space-y-3">
            {drafts.map(({ menu, reasons }) => (
              <li
                key={menu.weekStart}
                className="rounded-xl border border-amber-200 bg-amber-50 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-gray-900">
                      {menu.weekStart} ~ {menu.weekEnd}
                    </div>
                    <div className="truncate text-xs text-gray-500">
                      {mainsSummary(menu)}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => onDismiss(menu.weekStart)}
                      disabled={busy === menu.weekStart}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      무시
                    </button>
                    <button
                      onClick={() =>
                        navigate("/admin/review", {
                          state: { menu, originalWeekStart: menu.weekStart },
                        })
                      }
                      className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
                    >
                      검토하기
                    </button>
                  </div>
                </div>

                {reasons.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-amber-200 pt-3">
                    {reasons.map((r, i) => (
                      <li key={i} className="flex gap-1.5 text-xs text-amber-800">
                        <span aria-hidden>⚠</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function mainsSummary(menu: WeeklyMenu): string {
  return menu.days
    .map((d) => {
      if (d.isHoliday) return `${d.weekday} 휴무`;
      const main = (d.lunch?.dishes ?? []).find((x) => x.isMain)?.name;
      return `${d.weekday} ${main ?? "-"}`;
    })
    .join(" · ");
}
