// Flat config, .mjs because the root package.json has no "type": "module".
//
// `pnpm lint` was `pnpm -r lint`, and every package's "lint" was `tsc --noEmit` - so it duplicated
// `pnpm typecheck` and linted nothing. It also could not see convex/ (not a pnpm workspace),
// tests/, or scripts/, which is every Autofix and retention path in the product.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**", "**/dist/**", "**/.next/**", "**/coverage/**",
      // Gitignored working trees. Linting them buries the ~20 real findings under 8,000.
      ".local/**", "docs/plan-BuildIT.md", ".agents/**",
      "convex/_generated/**", "**/playwright-report/**", "**/test-results/**",
      "tests/e2e*/**/*-snapshots/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mjs"],
    languageOptions: {
      parserOptions: { ecmaVersion: 2023, sourceType: "module" },
      globals: { console: "readonly", process: "readonly", Buffer: "readonly", fetch: "readonly",
        Response: "readonly", Request: "readonly", Headers: "readonly", URL: "readonly", URLSearchParams: "readonly",
        TextEncoder: "readonly", TextDecoder: "readonly", crypto: "readonly", structuredClone: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", AbortController: "readonly", ReadableStream: "readonly",
        Uint8Array: "readonly", performance: "readonly", queueMicrotask: "readonly" },
    },
    rules: {
      // The repo builds under exactOptionalPropertyTypes and noUncheckedIndexedAccess, so `!` is
      // the idiom throughout after an explicit guard. Flagging it would produce hundreds of
      // findings on correct code and drown anything real.
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Redaction and log-sanitisation patterns match control characters on purpose - that is
      // the whole job. Every occurrence in this repo is one of those.
      "no-control-regex": "off",
      // The remaining hits are redundant backslashes inside character classes in path, redaction
      // and patch-policy patterns, where the extra escape is deliberate. Rewriting a
      // security-relevant regex for cosmetics is a worse trade than leaving the escape.
      "no-useless-escape": "off",
      // These are the ones worth having on a codebase that awaits inside loops over tenant data.
      "no-constant-binary-expression": "error",
      "no-self-compare": "error",
      "no-unmodified-loop-condition": "error",
      "require-atomic-updates": "error",
    },
  },
  {
    files: ["apps/web/**/*.tsx", "apps/web/**/*.ts"],
    languageOptions: { globals: { window: "readonly", document: "readonly", localStorage: "readonly", navigator: "readonly", HTMLElement: "readonly", React: "readonly" } },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "tests/**/*.ts"],
    rules: { "@typescript-eslint/no-unused-vars": "off" },
  },
);
