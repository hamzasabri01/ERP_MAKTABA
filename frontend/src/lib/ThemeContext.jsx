import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { storageGet, storageSet } from './safeStorage'

const ThemeCtx = createContext(null)
const STORAGE_KEY = 'library-sabri-theme-v2'

function getInitialTheme() {
  const saved = storageGet(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return 'light'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    storageSet(STORAGE_KEY, theme)
  }, [theme])

  const value = useMemo(() => ({
    theme,
    setTheme,
    toggleTheme: () => setTheme(current => current === 'dark' ? 'light' : 'dark'),
    isDark: theme === 'dark',
  }), [theme])

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

export function useTheme() {
  return useContext(ThemeCtx)
}
