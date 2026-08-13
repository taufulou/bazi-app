import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import tseslint from "typescript-eslint";

/**
 * A shared ESLint configuration for the repository.
 *
 * ⚠️ `eslint-plugin-only-warn` was removed here, and it has to stay removed for
 * the Lint job to mean anything.
 *
 * It rewrote EVERY rule to severity 1. Combined with `--max-warnings 0` that
 * produced the worst of both: the job failed on any violation, but nothing was
 * ever an error, so severity carried no information — a genuine
 * `rules-of-hooks` crash and an unused import were the same shade of yellow.
 *
 * It also silently disabled ESLint's own bulk-suppression mechanism.
 * `--suppress-rule` records severity-2 violations only, so on this repo
 * `--suppress-all` wrote a 3-byte file: `{}`. Accepting existing debt while
 * failing on NEW debt is impossible while every rule is a warning.
 *
 * @type {import("eslint").Linter.Config[]}
 * */
export const config = [
  js.configs.recommended,
  eslintConfigPrettier,
  ...tseslint.configs.recommended,
  {
    plugins: {
      turbo: turboPlugin,
    },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    ignores: ["dist/**"],
  },
];
