import { useFonts } from 'expo-font';
// Deep-import ONLY the 4 weights we use, straight from the .ttf files. Importing
// the packages' NAMED exports (or even `useFonts` from them) pulls their index.js,
// which `require()`s ALL 8 weights per family — and Metro does NOT tree-shake asset
// requires, so the bundle carries ~189MB of CJK TTFs (tc 76MB + sc 113MB) even
// though 4 are used. Deep imports bypass the index → ~47MB. `useFonts` therefore
// comes from `expo-font` directly so the font package index is never evaluated.
// Full CJK coverage MUST stay: AI narrative + user names are arbitrary Chinese, so
// glyph-subsetting to "used chars" isn't safe. 4 full weights is the floor.
import NotoSerifTC_400Regular from '@expo-google-fonts/noto-serif-tc/400Regular/NotoSerifTC_400Regular.ttf';
import NotoSerifTC_700Bold from '@expo-google-fonts/noto-serif-tc/700Bold/NotoSerifTC_700Bold.ttf';
import NotoSerifSC_400Regular from '@expo-google-fonts/noto-serif-sc/400Regular/NotoSerifSC_400Regular.ttf';
import NotoSerifSC_700Bold from '@expo-google-fonts/noto-serif-sc/700Bold/NotoSerifSC_700Bold.ttf';

/**
 * Loads the serif faces used for headings + CJK text. Only 2 weights each
 * (Regular 400 / Bold 700). RN registers each weight as its own family name; the
 * theme references `NotoSerifTC` (regular). Use `NotoSerifTC_Bold` where a bold
 * heading is needed (RN custom fonts don't synthesize weight from fontWeight). SC
 * variants back the zh-CN script swap.
 */
export function useAppFonts(): [boolean, Error | null] {
  return useFonts({
    NotoSerifTC: NotoSerifTC_400Regular,
    NotoSerifTC_Bold: NotoSerifTC_700Bold,
    NotoSerifSC: NotoSerifSC_400Regular,
    NotoSerifSC_Bold: NotoSerifSC_700Bold,
  });
}
