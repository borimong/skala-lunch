import { defineConfig } from "vitest/config";

// 워커/공유 로직 단위 테스트 전용 설정(앱 vite.config의 Cloudflare 플러그인을 끌어오지 않도록 분리).
export default defineConfig({
  test: {
    include: ["worker/**/*.test.ts", "shared/**/*.test.ts"],
    environment: "node",
  },
});
