// Jest setup — runs before each test file (setupFilesAfterEnv).
// @testing-library/react-native v12.4+ auto-registers its matchers, so no
// explicit "extend-expect" import is needed here. Add shared native-module
// mocks (SecureStore, Clerk, etc.) as the test suites grow.

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted; must use require() */

// lucide-react-native ships ESM `.mjs` that jest-expo's transform doesn't process
// (fails with "Unexpected token 'export'"). Stub every icon as a plain View — the
// icons are decorative, so tests only need them to render without crashing. Mirrors
// the web suite's `jest.mock('lucide-react', ...)` pattern (CLAUDE.md).
jest.mock('lucide-react-native', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Icon = (props: Record<string, unknown>) => React.createElement(View, props);
  return new Proxy(
    { __esModule: true },
    { get: (target, prop) => (prop === '__esModule' ? true : Icon) },
  );
});
