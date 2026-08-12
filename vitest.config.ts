import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["lib/**/*.test.ts", "lib/**/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      // "server-only" は Next.js のビルド時ガード。
      // テスト実行環境では解決できないため空モジュールに置き換える。
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
});
