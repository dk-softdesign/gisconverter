import { useState } from "react";
import { ClientOnly, Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ScrollText,
  Globe,
  KeyRound,
  LogOut,
  Settings as SettingsIcon,
  Users,
} from "lucide-react";

import { ChangePasswordDialog } from "#/components/change-password-dialog";
import { ChangelogDialog } from "#/components/changelog-dialog";
import { SettingsDialog } from "#/components/settings-dialog";
import { ThemeToggle } from "#/components/theme-toggle";
import { Button } from "#/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";
import { logoutFn } from "#/lib/auth-functions";
import type { SessionUser } from "#/lib/auth-types";

// Outline buttons restyled for the always-dark app header.
const HEADER_BUTTON_CLASS =
  "border-white/20 bg-transparent text-zinc-50 hover:bg-white/10 hover:text-zinc-50 dark:border-white/20 dark:bg-transparent dark:hover:bg-white/10";

// `user` is null on the sign-in pages, which only get the title and theme
// toggle.
export function AppHeader({ user }: { user: SessionUser | null }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);

  return (
    // Deliberately dark in both themes, so it stands apart from the page.
    <header className="border-b border-white/10 bg-zinc-900 text-zinc-50 shadow-md">
      <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-8">
        {/* `!`: the global `a` colour in styles.css isn't in a layer, so it beats utilities. */}
        <Link to="/" className="flex min-w-0 items-center gap-3 text-zinc-50! no-underline">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-500 text-white">
            <Globe className="size-5" />
          </span>
          {/* Two lines within the fixed h-14 — the Preview card's height relies on it. */}
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-lg leading-tight font-semibold tracking-tight">
              GIS Converter
            </h1>
            <p className="hidden truncate text-xs leading-tight text-zinc-400 sm:block">
              Charting every coordinate: Advanced conversion for the GIS-savvy captain
            </p>
          </div>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          {user && (
            <Button
              type="button"
              variant="outline"
              className={`${HEADER_BUTTON_CLASS} px-2.5 sm:px-3`}
              onClick={() => setChangelogOpen(true)}
              title="Changelog"
            >
              <ScrollText className="size-4" />
              <span className="hidden sm:inline">Changelog</span>
            </Button>
          )}
          <ClientOnly>
            <ThemeToggle className={HEADER_BUTTON_CLASS} />
          </ClientOnly>
          {user && (
            <>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={HEADER_BUTTON_CLASS}
                onClick={() => setSettingsOpen(true)}
                aria-label="Settings"
                title="Settings"
              >
                <SettingsIcon className="size-4" />
              </Button>
              <UserMenu user={user} />
              <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
              <ChangelogDialog open={changelogOpen} onOpenChange={setChangelogOpen} />
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")
  ).toUpperCase();
}

function UserMenu({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await logoutFn();
    } finally {
      // A full page load drops every bit of in-memory state (converted data
      // included) along with the session.
      window.location.assign("/login");
    }
  }

  const itemClass =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground";

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={`${HEADER_BUTTON_CLASS} gap-2 px-2`}
            aria-label={`Account: ${user.name}`}
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-emerald-500 text-xs font-semibold text-white">
              {initials(user.name) || "?"}
            </span>
            <span className="hidden max-w-32 truncate sm:inline">{user.name}</span>
            <ChevronDown className="size-4 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-60 p-1.5">
          <div className="border-b px-2 pt-1 pb-2">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            <p className="mt-0.5 text-xs text-muted-foreground capitalize">{user.role}</p>
          </div>
          <div className="flex flex-col pt-1.5">
            {user.role === "admin" && (
              <Link
                to="/members"
                className={`${itemClass} text-popover-foreground! no-underline`}
                onClick={() => setOpen(false)}
              >
                <Users />
                Members
              </Link>
            )}
            <button
              type="button"
              className={itemClass}
              onClick={() => {
                setOpen(false);
                setPasswordOpen(true);
              }}
            >
              <KeyRound />
              Change password
            </button>
            <button type="button" className={itemClass} disabled={signingOut} onClick={signOut}>
              <LogOut />
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <ChangePasswordDialog open={passwordOpen} onOpenChange={setPasswordOpen} />
    </>
  );
}
