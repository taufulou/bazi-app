import { ClerkProvider, ClerkLoaded } from '@clerk/clerk-expo';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { tokenCache } from '../lib/clerk-token-cache';

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
  console.warn(
    'Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY — Clerk auth will not work. ' +
    'Add it to your .env file.'
  );
}

export default function RootLayout() {
  // If no publishable key, render without Clerk (development fallback)
  if (!publishableKey) {
    return (
      <>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#1a1a2e' },
            headerTintColor: '#e8d5b7',
            headerTitleStyle: { fontWeight: 'bold' },
            contentStyle: { backgroundColor: '#1a1a2e' },
          }}
        >
          <Stack.Screen
            name="index"
            options={{ title: '八字命理', headerLargeTitle: true }}
          />
        </Stack>
      </>
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ClerkLoaded>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#1a1a2e' },
            headerTintColor: '#e8d5b7',
            headerTitleStyle: { fontWeight: 'bold' },
            contentStyle: { backgroundColor: '#1a1a2e' },
          }}
        >
          <Stack.Screen
            name="index"
            options={{ title: '八字命理', headerLargeTitle: true }}
          />
          <Stack.Screen
            name="sign-in"
            options={{ title: '登入', presentation: 'modal' }}
          />
          <Stack.Screen
            name="sign-up"
            options={{ title: '註冊', presentation: 'modal' }}
          />
          <Stack.Screen
            name="(authenticated)"
            options={{ headerShown: false }}
          />
        </Stack>
      </ClerkLoaded>
    </ClerkProvider>
  );
}
