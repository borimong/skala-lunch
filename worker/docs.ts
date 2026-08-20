// GET /api/docs 에서 서빙하는 Swagger UI 페이지.
// 워커가 직접 서빙하는 HTML이라(Artifact 아님) unpkg CDN 로드가 허용된다.
// 스펙은 /api/openapi.json 에서 읽는다.
const SWAGGER_VERSION = "5.17.14";

export const swaggerUiHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SKALA 식단 API 문서</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@${SWAGGER_VERSION}/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "/api/openapi.json",
      dom_id: "#swagger-ui",
      deepLinking: true,
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`;
