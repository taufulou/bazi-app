import { useAuth } from '@clerk/clerk-expo';
import { Redirect, Tabs } from 'expo-router';
import { House, Sparkles, ScrollText, Heart, User } from 'lucide-react-native';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { colors } from '../../theme';
import { useZh } from '../../lib/language';
import { E2E_BYPASS_AUTH } from '../../lib/e2e';

/**
 * Authenticated area = the 5-tab shell (首頁 / 運勢 / 解讀 / 合盤 / 我的).
 * Guards on the Clerk session before rendering the tabs.
 */
export default function AuthenticatedLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  const zh = useZh();

  if (!isLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.red} size="large" />
      </View>
    );
  }
  if (!isSignedIn && !E2E_BYPASS_AUTH) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bgCard },
        headerTitleStyle: { color: colors.textPrimary, fontWeight: '700' },
        headerTintColor: colors.textAccent,
        tabBarActiveTintColor: colors.red,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.bgCard, borderTopColor: colors.borderLight },
        /**
         * React Navigation's default tab label is 10pt. That is a LATIN default —
         * fine for "Home", below the 12pt CJK floor for 首頁/運勢/解讀/合盤/我的, and
         * it sits on the primary navigation of every single screen.
         *
         * The static guards could not see it: the size lives in a third-party
         * default, not in this app's StyleSheet. It was found by measuring the
         * rendered tree (src/dev/type-audit.ts) — the same way the web build found
         * react-datepicker rendering its calendar at 12.8px.
         *
         * lineHeight is deliberately tight (not caption's 17): the tab bar has a
         * fixed height and a loose leading pushes the label off its icon.
         */
        tabBarLabelStyle: { fontSize: 12, lineHeight: 15 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: zh('首頁'),
          // No nav bar: the web dashboard has none, 首頁 carries its own logo +
          // credit header, and the tab bar already says where you are. Reclaims
          // ~55pt so the hero banner sits near the top like web. (home.tsx adds
          // its own safe-area top inset since the header no longer supplies one.)
          headerShown: false,
          tabBarIcon: ({ color, size }) => <House color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="fortune"
        options={{
          title: zh('運勢'),
          tabBarIcon: ({ color, size }) => <Sparkles color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="readings"
        options={{
          title: zh('解讀'),
          tabBarIcon: ({ color, size }) => <ScrollText color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="compat"
        options={{
          title: zh('合盤'),
          tabBarIcon: ({ color, size }) => <Heart color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: zh('我的'),
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgPrimary,
  },
});
