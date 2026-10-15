import { Toaster as Sonner, type ToasterProps } from "sonner";

// shadcn's version reads the theme from next-themes; this app toggles a `dark`
// class itself, so the toast colors come straight from the theme's CSS
// variables instead and follow it automatically.
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
