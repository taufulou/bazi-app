import { config } from "@repo/eslint-config/base";
import globals from "globals";

/**
 * This app had a `lint` script and NO config file — an ESLint v9 hard exit-2,
 * not a no-op. See packages/shared/eslint.config.mjs for the same fix.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  ...config,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
  },
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      // Prisma's generated client — machine-written, not ours to lint.
      "prisma/generated/**",
      "src/generated/**",
    ],
  },
];
