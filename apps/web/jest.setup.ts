import '@testing-library/jest-dom';

/**
 * The line above augments the GLOBAL `jest.Matchers` namespace (@types/jest).
 * Five of the 35 specs import `expect` from '@jest/globals' instead, which is a
 * different type the augmentation never reaches — so `toBeInTheDocument` /
 * `toHaveAttribute` / `toBeDisabled` / `toBeEmptyDOMElement` were untyped in
 * four of them, producing 82 of the 120 errors that failed the TypeScript Check
 * job. (The fifth, fortune-folk-content.spec.tsx, uses no jest-dom matcher at
 * all, so it had nothing to report.) This entry point declares the same matchers
 * against '@jest/globals'.
 *
 * Both imports are needed while both styles coexist. Registering the matchers
 * twice at runtime is a no-op — it's the same matcher objects, and jest's
 * `expect` is a single shared instance either way.
 */
import '@testing-library/jest-dom/jest-globals';
