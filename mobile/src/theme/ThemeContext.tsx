import React, { createContext, useContext } from 'react';
import { type ColorPalette, darkColors, lightColors } from './colors';

type ThemeName = 'dark' | 'light';

interface ThemeContextValue {
  theme: ThemeName;
  colors: ColorPalette;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  colors: darkColors,
});

interface ThemeProviderProps {
  theme?: ThemeName;
  children: React.ReactNode;
}

export function ThemeProvider({ theme = 'dark', children }: ThemeProviderProps) {
  const colors = theme === 'dark' ? darkColors : lightColors;
  return (
    <ThemeContext.Provider value={{ theme, colors }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
