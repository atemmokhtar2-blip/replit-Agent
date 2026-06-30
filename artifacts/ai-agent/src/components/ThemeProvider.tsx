import React, { createContext, useContext, useEffect } from "react";

type ThemeProviderState = {
  theme: "dark";
  setTheme: (theme: "dark") => void;
};

const initialState: ThemeProviderState = {
  theme: "dark",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  ...props
}: {
  children: React.ReactNode;
  defaultTheme?: string;
  storageKey?: string;
}) {
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "system");
    root.classList.add("dark");
    localStorage.setItem("vite-ui-theme", "dark");
  }, []);

  return (
    <ThemeProviderContext.Provider {...props} value={initialState}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");
  return context;
};
