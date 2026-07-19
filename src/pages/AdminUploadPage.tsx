import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { addDaysISO, mondayOf, toISODate } from "../../shared/menu";
import { extractMenuFromImage } from "../lib/adminApi";
import { downscaleImage } from "../lib/image";

export default function AdminUploadPage() {
  const navigate = useNavigate();
  const [weekStart, setWeekStart] = useState(mondayOf(toISODate(new Date())));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("메뉴판 사진을 선택하세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const blob = await downscaleImage(file);
      const { menu, imageKey } = await extractMenuFromImage(blob, weekStart);
      navigate("/admin/review", { state: { menu, imageKey } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "추출에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-lg px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">식단표 올리기</h1>
          <Link to="/" className="text-sm text-gray-500 hover:text-gray-700">
            ← 홈
          </Link>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              해당 주 (월요일 기준)
            </label>
            <input
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(mondayOf(e.target.value))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              {weekStart} ~ {addDaysISO(weekStart, 4)}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              메뉴판 사진
            </label>
            <input
              type="file"
              accept="image/*"
              onChange={onPick}
              className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-emerald-700"
            />
            {preview && (
              <img
                src={preview}
                alt="미리보기"
                className="mt-3 max-h-64 w-full rounded-lg border border-gray-200 object-contain"
              />
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy || !file}
            className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "AI가 읽는 중… (최대 30초)" : "AI로 추출하기"}
          </button>
        </form>
      </main>
    </div>
  );
}
