import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { Button } from "#/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";

interface SidePanelProps {
  // Where the collapsed state is remembered between visits.
  storageKey: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}

// A fixed-width left-hand panel that can be collapsed to a single button, to
// give the content next to it the full width. From the `lg` breakpoint down it
// stacks above that content instead.
export function SidePanel({ storageKey, title, description, children }: SidePanelProps) {
  // Only meant for content that renders client-side (e.g. after a user
  // action); on the server, localStorage is missing and it starts expanded.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "collapsed";
    } catch {
      return false;
    }
  });

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(storageKey, next ? "collapsed" : "expanded");
    } catch {
      // localStorage unavailable — the state just won't persist.
    }
  }

  if (collapsed) {
    return (
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0 lg:sticky lg:top-8"
        onClick={toggle}
        aria-label={`Show ${title.toLowerCase()} panel`}
        title={`Show ${title.toLowerCase()} panel`}
      >
        <PanelLeftOpen />
      </Button>
    );
  }

  return (
    <Card className="w-full shrink-0 lg:sticky lg:top-8 lg:w-75">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={toggle}
            aria-label={`Hide ${title.toLowerCase()} panel`}
            title={`Hide ${title.toLowerCase()} panel`}
          >
            <PanelLeftClose />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}
