/**
 * Lobb design system.
 *
 * Personality: fast, playful, late-night. Dark mode is the hero theme —
 * most requests happen at night during study crunch.
 *
 *  - Violet  = brand / primary actions ("Lobb it" button, selected states)
 *  - Lime    = money & go (earnings, accept, success moments). Always dark text on lime.
 *  - Coral   = urgency (countdown < 2 min, errors, cancel)
 *  - Amber   = waiting / warning
 */
import { useColorScheme } from 'react-native';

const palette = {
  violet50: '#F3EEFF',
  violet300: '#B69CFF',
  violet500: '#9B6BFF',
  violet600: '#7444FF',
  violet900: '#2A1A55',
  lime400: '#C8FF3D',
  lime600: '#8BC400',
  coral400: '#FF5D73',
  coral600: '#E8384F',
  amber400: '#FFC53D',
  amber600: '#D98E00',
  mint400: '#3DDC97',
  mint600: '#12A86B',
  ink950: '#16111F',
  ink900: '#221B30',
  ink800: '#2E2541',
  ink700: '#3D3354',
  ink400: '#BDB4D6',
  paper50: '#F6F5FA',
  paper100: '#F1EDFA',
  paper200: '#E4DEF2',
  paper600: '#5F5778',
  paper950: '#150F22',
};

export const darkColors = {
  bg: palette.ink950,
  surface: palette.ink900,
  surfaceHigh: palette.ink800,
  border: palette.ink700,
  text: '#F5F2FF',
  textMuted: palette.ink400,
  primary: palette.violet500,
  primarySoft: 'rgba(155, 107, 255, 0.24)',
  onPrimary: '#FFFFFF',
  accent: palette.lime400,
  accentSoft: 'rgba(200, 255, 61, 0.18)',
  onAccent: palette.ink950,
  danger: palette.coral400,
  dangerSoft: 'rgba(255, 93, 115, 0.16)',
  warning: palette.amber400,
  warningSoft: 'rgba(255, 197, 61, 0.16)',
  success: palette.mint400,
  successSoft: 'rgba(61, 220, 151, 0.16)',
  glow: 'rgba(155, 107, 255, 0.55)',
};

export type ThemeColors = typeof darkColors;

export const lightColors: ThemeColors = {
  bg: palette.paper50,
  surface: '#FFFFFF',
  surfaceHigh: palette.paper100,
  border: palette.paper200,
  text: palette.paper950,
  textMuted: palette.paper600,
  primary: palette.violet600,
  primarySoft: palette.violet50,
  onPrimary: '#FFFFFF',
  accent: palette.lime400,
  accentSoft: 'rgba(139, 196, 0, 0.14)',
  onAccent: palette.ink950,
  danger: palette.coral600,
  dangerSoft: 'rgba(232, 56, 79, 0.10)',
  warning: palette.amber600,
  warningSoft: 'rgba(217, 142, 0, 0.12)',
  success: palette.mint600,
  successSoft: 'rgba(18, 168, 107, 0.12)',
  glow: 'rgba(109, 60, 240, 0.25)',
};

/** Category tints, used for item tiles. Same in both themes; tiles render them at low opacity. */
export const categoryTint = {
  snacks: '#FFB547',
  drinks: '#4CC9F0',
  toiletries: '#FF7AC6',
  electronics: '#8B5CF6',
  household: '#3DDC97',
  alcohol: '#E8566C',
} as const;

export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  displayMedium: 'SpaceGrotesk_500Medium',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const;

export function useTheme() {
  const scheme = useColorScheme();
  const dark = scheme !== 'light';
  return { colors: dark ? darkColors : lightColors, dark };
}
