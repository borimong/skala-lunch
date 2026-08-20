// 공개(비인증) GET 엔드포인트 전용 CORS.
// 식단 데이터는 공개·비자격증명(쿠키 없음)이므로 정적 '*'를 쓴다.
// - '*' + Allow-Credentials 조합 금지(브라우저가 응답 거부) → Allow-Credentials 안 붙임
// - 정적 '*'라 Origin 반사가 없어 CDN 캐시 오염 걱정도 없음
// 관리자/인그레스 등 인증 엔드포인트에는 절대 얹지 않는다.
export const PUBLIC_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

// 기존 응답에 CORS 헤더만 덧붙인다(상태코드·본문·기존 헤더는 그대로).
export function withCors(res: Response): Response {
  for (const [k, v] of Object.entries(PUBLIC_CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

// 프리플라이트(OPTIONS) 응답. 본문 없이 CORS 헤더만.
export function preflight(): Response {
  return new Response(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}
