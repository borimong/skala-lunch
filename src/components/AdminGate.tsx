import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  getAdminToken,
  setAdminToken,
  verifyAdminToken,
} from "../lib/adminApi";

export default function AdminGate({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(getAdminToken());
  const [entered, setEntered] = useState(Boolean(getAdminToken()));
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (entered) return <>{children}</>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(null);
    const ok = await verifyAdminToken(token).catch(() => false);
    setChecking(false);
    if (ok) {
      setAdminToken(token);
      setEntered(true);
    } else {
      setError("토큰이 올바르지 않아요.");
    }
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-xl font-bold text-gray-900">관리자 로그인</h1>
      <p className="mt-1 text-sm text-gray-500">
        식단표를 올리려면 관리자 토큰을 입력하세요.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="관리자 토큰"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          autoFocus
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={checking || !token}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {checking ? "확인 중…" : "입력"}
        </button>
      </form>
    </div>
  );
}
