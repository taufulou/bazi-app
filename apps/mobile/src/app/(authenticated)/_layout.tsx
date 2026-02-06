import { useAuth } from '@clerk/clerk-expo';
import { Redirect, Stack } from 'expo-router';

export default function AuthenticatedLayout() {
  const { isSignedIn, isLoaded } = useAuth();

  if (!isLoaded) {
    return null; // Or a loading spinner
  }

  if (!isSignedIn) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#1a1a2e' },
        headerTintColor: '#e8d5b7',
        headerTitleStyle: { fontWeight: 'bold' },
        contentStyle: { backgroundColor: '#1a1a2e' },
      }}
    >
      <Stack.Screen
        name="dashboard"
        options={{
          title: '八字命理',
          headerLargeTitle: true,
        }}
      />
    </Stack>
  );
}
