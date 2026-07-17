// Ambient types for asset imports Metro resolves but TS doesn't know about.
// `expo/types` (referenced in expo-env.d.ts) doesn't declare these, so the deep
// `.ttf` imports in src/theme/fonts.ts (used to avoid bundling all 16 CJK weights)
// and the bundled home artwork need them. The imported value is Metro's numeric
// asset id, which `useFonts` / expo-image `source` both accept.
//
// Declaring these lets us use ES imports instead of `require()` — which keeps
// @typescript-eslint/no-require-imports quiet (the project lints --max-warnings 0).
declare module '*.ttf' {
  const asset: number;
  export default asset;
}

declare module '*.webp' {
  const asset: number;
  export default asset;
}

declare module '*.png' {
  const asset: number;
  export default asset;
}
