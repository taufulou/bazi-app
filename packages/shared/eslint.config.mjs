import { config } from "@repo/eslint-config/base";

/**
 * This package had a `lint` script and NO config file. Under ESLint v9 that is
 * not "nothing to lint" — it is a hard exit-2 ("couldn't find eslint.config.js"),
 * which is what failed the Lint job before any other workspace was reached.
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  ...config,
  { ignores: ["dist/**", "node_modules/**"] },
];
