/**
 * Load `lib/purchases` on demand, so the native react-native-purchases module
 * stays off the boot path of always-mounted screens (我的, the root layout).
 *
 * A lazy `require`, not `await import()`: Metro supports both, but jest-expo does
 * not transform dynamic `import()` (it throws "needs --experimental-vm-modules"),
 * and every caller swallows errors — so with `import()` the sign-out cleanup was
 * silently skipped under test and no test could prove it ran.
 */
export function loadPurchases(): typeof import('./purchases') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./purchases');
}
