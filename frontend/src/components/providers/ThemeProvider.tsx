import React, { createContext, useContext, useEffect } from 'react';
import { Theme, defaultTheme } from '@/config/theme';

type ThemeContextType = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({
  theme = defaultTheme,
  children,
}: {
  theme?: Theme;
  children: React.ReactNode;
}) {
  useEffect(() => {
    // Apply theme CSS variables
    const root = document.documentElement;
    
    root.style.setProperty('--theme-bg-primary', theme.colors.background.primary);
    root.style.setProperty('--theme-bg-secondary', theme.colors.background.secondary);
    root.style.setProperty('--theme-bg-accent', theme.colors.background.accent);
    
    root.style.setProperty('--theme-fg-primary', theme.colors.foreground.primary);
    root.style.setProperty('--theme-fg-secondary', theme.colors.foreground.secondary);
    root.style.setProperty('--theme-fg-muted', theme.colors.foreground.muted);
    
    root.style.setProperty('--theme-avatar-user-bg', theme.colors.avatar.user.background);
    root.style.setProperty('--theme-avatar-user-fg', theme.colors.avatar.user.foreground);
    root.style.setProperty('--theme-avatar-assistant-bg', theme.colors.avatar.assistant.background);
    root.style.setProperty('--theme-avatar-assistant-fg', theme.colors.avatar.assistant.foreground);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: () => {} }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
} 