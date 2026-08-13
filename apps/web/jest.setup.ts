import '@testing-library/jest-dom';

/**
 * The line above augments the GLOBAL `jest.Matchers` namespace (@types/jest).
 * Four specs import `expect` from '@jest/globals' instead, which is a different
 * type — so `toBeInTheDocument` / `toHaveAttribute` / `toBeDisabled` /
 * `toBeEmptyDOMElement` were untyped there and produced 82 of the 120 errors
 * failing the TypeScript Check job. This entry point declares the same matchers
 * against '@jest/globals'.
 *
 * Both are needed while both styles of import coexist: 5 of 35 specs use
 * '@jest/globals', the rest use the ambient globals. Registering the matchers
 * twice at runtime is a no-op — it's the same matcher objects, and jest's
 * `expect` is a single shared instance either way.
 */
import '@testing-library/jest-dom/jest-globals';
