import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "#/components/ui/button";

const THEME_STORAGE_KEY = "theme";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, isDark ? "dark" : "light");
    } catch {
      // localStorage unavailable (private browsing, etc.) — theme just won't persist.
    }
  }, [isDark]);

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={() => setIsDark((d) => !d)}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
