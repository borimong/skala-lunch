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

// /api/admin/nutrition-override 전용 토큰. 이 라우트 하나만 열어주는
// 최소권한 토큰이라, 관리자 전체 권한(ADMIN_TOKEN)을 몰라도 통과한다.
// 기존 ADMIN_TOKEN으로도 여전히 통과됨(둘 중 하나면 OK).
export function requireNutritionAdmin(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token.length === 0) return false;
  return token === env.ADMIN_TOKEN || token === env.NUTRITION_ADMIN_TOKEN;
}
