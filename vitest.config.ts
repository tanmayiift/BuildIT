import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts", "tests/**/*.test.ts", "convex/**/*.test.ts"],
    coverage: { reporter: ["text", "json-summary"] },
  },
});
