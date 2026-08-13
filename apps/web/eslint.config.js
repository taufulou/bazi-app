import { nextJsConfig } from "@repo/eslint-config/next-js";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextJsConfig,

  /**
   * Node-run config files. The shared Next config supplies only
   * `globals.serviceworker`, so `process` and `module` were undeclared here and
   * produced 7 `no-undef` errors — in files that never run in a browser.
   */
  {
    files: ["*.config.js", "*.config.cjs", "*.config.mjs", "*.config.ts", "jest.setup.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  /**
   * `exhaustive-deps` ships as a warning, and a warning is invisible to
   * ESLint's suppression file — `--suppress-rule` records severity 2 only. As a
   * warning it could neither be accepted as existing debt nor enforced going
   * forward; it just kept the job red. Promoted here so the 12 existing cases
   * are recorded in eslint-suppressions.json and the 13th fails the build.
   *
   * Deliberately in the WEB config, not base.js: mobile and packages/ui are
   * currently clean, and promoting this repo-wide would hand them a failing
   * lint job they did nothing to earn.
   */
  {
    rules: {
      "react-hooks/exhaustive-deps": "error",
    },
  },
];
