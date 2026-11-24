import React, { createContext, useContext, useState, useEffect } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Default theme is always 'light' across all devices, regardless of OS preference.
  // Users can opt into dark mode via the toggle, and that explicit choice persists.
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('data360_theme');
    return saved === 'dark' || saved === 'light' ? (saved as Theme) : 'light';
  });

  // Apply theme class + sync browser chrome / status bar color
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    // color-scheme tells Samsung Internet / Chrome Android not to auto-darken
    document.documentElement.style.colorScheme = theme;
    // Update <meta name="theme-color"> so the browser/PWA chrome matches our theme
    const themeColor = theme === 'dark' ? '#0D1424' : '#F5F7FA';
    document
      .querySelectorAll('meta[name="theme-color"]')
      .forEach((el) => el.setAttribute('content', themeColor));
  }, [theme]);

  const toggleTheme = () => {
    setTheme(t => {
      const next = t === 'dark' ? 'light' : 'dark';
      localStorage.setItem('data360_theme', next);
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
