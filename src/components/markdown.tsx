import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "#/lib/utils";

// Renders trusted, repo-owned markdown (no raw HTML) with the typography
// plugin's `prose` styles, following the light/dark theme.
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div
      className={cn(
        "prose prose-sm max-w-none dark:prose-invert sm:prose-base",
        // The global `a` colour in styles.css is unlayered and would win.
        "prose-a:text-primary!",
        // Typography adds literal backticks around inline code; drop them.
        "prose-code:before:content-none prose-code:after:content-none",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
