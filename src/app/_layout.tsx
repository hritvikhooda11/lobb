import { SpaceGrotesk_500Medium, SpaceGrotesk_700Bold, useFonts } from '@expo-google-fonts/space-grotesk';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { SetupNeeded } from '@/components/setup-needed';
import { supabaseConfigured } from '@/lib/supabase';
import { AppStoreProvider, useStore } from '@/store/app-store';
import { useTheme } from '@/theme';

SplashScreen.preventAutoHideAsync();

function RootStack() {
  const { state } = useStore();
  const { colors } = useTheme();
  if (!state.ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  const signedIn = !!state.userId && !!state.profile?.communityId;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="item/[id]" options={{ presentation: 'formSheet', sheetAllowedDetents: [0.72, 1], sheetGrabberVisible: true, sheetCornerRadius: 28 }} />
        <Stack.Screen name="request/[id]" options={{ gestureEnabled: false }} />
        <Stack.Screen name="deliver/[id]" options={{ gestureEnabled: false }} />
        <Stack.Screen name="report" options={{ presentation: 'modal' }} />
        <Stack.Screen name="list-item" options={{ presentation: 'modal' }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const { dark, colors } = useTheme();
  const [loaded] = useFonts({ SpaceGrotesk_500Medium, SpaceGrotesk_700Bold });

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);
  if (!loaded) return null;

  const base = dark ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, background: colors.bg, card: colors.surface, primary: colors.primary, text: colors.text, border: colors.border } }}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {supabaseConfigured ? (
        <AppStoreProvider>
          <RootStack />
        </AppStoreProvider>
      ) : (
        <SetupNeeded />
      )}
    </ThemeProvider>
  );
}
