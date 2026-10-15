import { Moon, Sun } from "lucide-react";

import { Button } from "#/components/ui/button";
import { updateSettings, useResolvedTheme } from "#/lib/settings";

// Quick switch between light and dark; "System" is chosen in Settings.
export function ThemeToggle({ className }: { className?: string }) {
  const isDark = useResolvedTheme() === "dark";

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className={className}
      onClick={() => updateSettings({ theme: isDark ? "light" : "dark" })}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
