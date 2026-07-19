export function requireAdmin(request: Request, env: Env): boolean {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && token === env.ADMIN_TOKEN;
}

export function unauthorized(): Response {
  return Response.json({ error: "관리자 인증이 필요해요." }, { status: 401 });
}
