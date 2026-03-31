/**
 * Color palettes extracted from Monobank-style dark UI.
 * Each palette is a flat object so components can destructure what they need.
 */

export interface ColorPalette {
  // Backgrounds
  background: string;
  card: string;
  cardSecondary: string;

  // Text
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;

  // Borders & dividers
  border: string;
  borderLight: string;

  // Bottom sheet
  sheetBackground: string;
  sheetHandle: string;

  // Tab bar
  tabBarBackground: string;
  tabBarBorder: string;
  tabBarGlow: [string, string];
  tabActiveColor: string;
  tabInactiveColor: string;

  // Inputs
  inputBackground: string;
  placeholderColor: string;

  // Buttons
  primaryButton: string;
  primaryButtonText: string;
  disabledButton: string;
  pillButton: string;
  pillButtonText: string;

  // Accents (shared across themes)
  accentBlue: string;
  accentBlueDark: string;
  accentGreen: string;
  accentGreenDark: string;
  accentRed: string;
  accentOrange: string;
  accentSuccess: string;

  // Semantic surfaces
  successBackground: string;
  successText: string;
  errorBackground: string;
  errorText: string;
  infoBackground: string;

  // Header gradients
  homeGradient: string[];
  earnGradient: string[];
  assetsGradient: string[];
  moreGradient: string[];

  // Onboarding (purple gradient screens)
  onboardingGradient: string[];
  onboardingText: string;
  onboardingTextMuted: string;
  onboardingButton: string;
  onboardingButtonText: string;

  // Misc
  shadowColor: string;
  overlay: string;
  moreButtonBg: string;
  moreButtonText: string;
  notificationBg: string;
  notificationBorder: string;
  badge: string;
}

export const darkColors: ColorPalette = {
  // Backgrounds — deep navy from Monobank
  background: '#111827',
  card: '#1E293B',
  cardSecondary: '#283548',

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#94A3B8',
  textTertiary: '#64748B',

  // Borders
  border: '#334155',
  borderLight: '#1E293B',

  // Bottom sheet
  sheetBackground: '#1E293B',
  sheetHandle: '#4B5563',

  // Tab bar
  tabBarBackground: '#1E293B',
  tabBarBorder: '#334155',
  tabBarGlow: ['rgba(30, 41, 59, 0)', 'rgba(17, 24, 39, 0.95)'],
  tabActiveColor: '#F95357',
  tabInactiveColor: '#64748B',

  // Inputs
  inputBackground: '#283548',
  placeholderColor: '#64748B',

  // Buttons
  primaryButton: '#FFFFFF',
  primaryButtonText: '#111827',
  disabledButton: '#334155',
  pillButton: '#334155',
  pillButtonText: '#FFFFFF',

  // Accents
  accentBlue: '#3985D8',
  accentBlueDark: '#175DA3',
  accentGreen: '#19C394',
  accentGreenDark: '#1E8260',
  accentRed: '#F95357',
  accentOrange: '#E67E22',
  accentSuccess: '#28A745',

  // Semantic
  successBackground: '#0D3320',
  successText: '#4ADE80',
  errorBackground: '#3B1111',
  errorText: '#F87171',
  infoBackground: '#1E3A5F',

  // Header gradients — earn/assets keep original vibrant colors
  homeGradient: ['#0B2545', '#133E6B', '#1B4F7A', '#111827'],
  earnGradient: ['#1E8260', '#19C394'],
  assetsGradient: ['#104982', '#3985D8'],
  moreGradient: ['#1E293B', '#334155'],

  // Onboarding (purple gradient screens)
  onboardingGradient: ['#0d0620', '#1a0e3d', '#2d1469', '#4c1d95'],
  onboardingText: '#FFFFFF',
  onboardingTextMuted: 'rgba(255, 255, 255, 0.7)',
  onboardingButton: '#FFFFFF',
  onboardingButtonText: '#1E293B',

  // Misc
  shadowColor: '#000',
  overlay: 'rgba(0, 0, 0, 0.7)',
  moreButtonBg: '#283548',
  moreButtonText: '#94A3B8',
  notificationBg: '#1E293B',
  notificationBorder: '#334155',
  badge: '#DC3545',
};

export const lightColors: ColorPalette = {
  // Backgrounds
  background: '#E8EAF1',
  card: '#FFFFFF',
  cardSecondary: '#F4F4F4',

  // Text
  textPrimary: '#000000',
  textSecondary: '#6B7B8D',
  textTertiary: '#B2B2B2',

  // Borders
  border: '#E8EAF1',
  borderLight: '#EEECEC',

  // Bottom sheet
  sheetBackground: '#FFFFFF',
  sheetHandle: '#D0D0D0',

  // Tab bar
  tabBarBackground: '#FDFDFE',
  tabBarBorder: '#EEECEC',
  tabBarGlow: ['rgba(165, 165, 165, 0)', 'rgba(165, 165, 165, 0.3)'],
  tabActiveColor: '#F95357',
  tabInactiveColor: '#B2B2B2',

  // Inputs
  inputBackground: '#F4F4F4',
  placeholderColor: '#B2B2B2',

  // Buttons
  primaryButton: '#000000',
  primaryButtonText: '#FFFFFF',
  disabledButton: '#B2B2B2',
  pillButton: '#000000',
  pillButtonText: '#FFFFFF',

  // Accents
  accentBlue: '#3985D8',
  accentBlueDark: '#175DA3',
  accentGreen: '#19C394',
  accentGreenDark: '#1E8260',
  accentRed: '#F95357',
  accentOrange: '#E67E22',
  accentSuccess: '#28A745',

  // Semantic
  successBackground: '#E8F5E9',
  successText: '#2E7D32',
  errorBackground: '#FFEBEE',
  errorText: '#F95357',
  infoBackground: '#EEF4FB',

  // Header gradients
  homeGradient: ['#175DA3', '#347AC0', '#8EB2D8', '#E8EAF1'],
  earnGradient: ['#1E8260', '#19C394'],
  assetsGradient: ['#104982', '#3985D8'],
  moreGradient: ['#475569', '#94A3B8'],

  // Onboarding (purple gradient screens)
  onboardingGradient: ['#1a0533', '#2d1b69', '#4c1d95', '#6d28d9'],
  onboardingText: '#FFFFFF',
  onboardingTextMuted: 'rgba(255, 255, 255, 0.7)',
  onboardingButton: '#FFFFFF',
  onboardingButtonText: '#6d28d9',

  // Misc
  shadowColor: '#000',
  overlay: 'rgba(0, 0, 0, 0.5)',
  moreButtonBg: '#E9EDF4',
  moreButtonText: '#294E90',
  notificationBg: '#FFFFFF',
  notificationBorder: '#9C42FF',
  badge: '#DC3545',
};
