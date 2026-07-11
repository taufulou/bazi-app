import {
  useFonts,
  NotoSerifTC_400Regular,
  NotoSerifTC_700Bold,
} from '@expo-google-fonts/noto-serif-tc';
import {
  NotoSerifSC_400Regular,
  NotoSerifSC_700Bold,
} from '@expo-google-fonts/noto-serif-sc';

/**
 * Loads the serif faces used for headings + CJK text. Only 2 weights each
 * (Regular 400 / Bold 700) to keep the bundle small — full CJK TTFs are large.
 * RN registers each weight as its own family name; the theme references
 * `NotoSerifTC` (regular). Use `NotoSerifTC_Bold` where a bold heading is needed
 * (RN custom fonts don't synthesize weight from fontWeight). SC variants back the
 * zh-CN script swap.
 */
export function useAppFonts(): [boolean, Error | null] {
  return useFonts({
    NotoSerifTC: NotoSerifTC_400Regular,
    NotoSerifTC_Bold: NotoSerifTC_700Bold,
    NotoSerifSC: NotoSerifSC_400Regular,
    NotoSerifSC_Bold: NotoSerifSC_700Bold,
  });
}
