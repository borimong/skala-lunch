export function requireAdmin(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && token === env.ADMIN_TOKEN;
}

export function unauthorized(): Response {
  return Response.json({ error: "관리자 인증이 필요해요." }, { status: 401 });
}

// 자동 인그레스(Apps Script)용 토큰 확인. 관리자 전체 권한과 분리(최소권한).
export function requireIngest(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && token === env.INGEST_TOKEN;
}
