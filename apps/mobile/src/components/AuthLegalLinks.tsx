import { StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { PRIVACY_URL, TERMS_URL } from '../lib/links';
import { useZh } from '../lib/language';
import { colors, spacing, text as T } from '../theme';

/**
 * Terms + privacy under the sign-in / sign-up forms (1C item 3). `variant="consent"`
 * is the sign-up line 「註冊即表示您同意…」. In-app browser, never the system one.
 */
export function AuthLegalLinks({ variant }: { variant: 'consent' | 'links' }) {
  const zh = useZh();
  const open = (url: string) => () => void WebBrowser.openBrowserAsync(url);
  const terms = (
    <Text style={styles.link} accessibilityRole="link" onPress={open(TERMS_URL)}>
      {variant === 'consent' ? zh('《服務條款》') : zh('服務條款')}
    </Text>
  );
  const privacy = (
    <Text style={styles.link} accessibilityRole="link" onPress={open(PRIVACY_URL)}>
      {variant === 'consent' ? zh('《隱私權政策》') : zh('隱私權政策')}
    </Text>
  );
  return (
    <View style={styles.wrap}>
      {variant === 'consent' ? (
        <Text style={styles.text}>
          {zh('註冊即表示您同意')}
          {terms}
          {zh('及')}
          {privacy}
        </Text>
      ) : (
        <Text style={styles.text}>
          {terms}
          {'  ·  '}
          {privacy}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg, alignItems: 'center' },
  text: { ...T.caption, color: colors.textMuted, textAlign: 'center' },
  link: { color: colors.textSecondary, textDecorationLine: 'underline' },
});
