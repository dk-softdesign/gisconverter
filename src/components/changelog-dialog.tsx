import { lazy, Suspense } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "#/components/ui/dialog";

const ChangelogContent = lazy(() => import("#/components/changelog-content"));

interface ChangelogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// An overlay rather than a page of its own, so opening it doesn't throw away
// the converted data on the main screen; the X (or Esc) returns to it as-is.
export function ChangelogDialog({ open, onOpenChange }: ChangelogDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] max-w-[calc(100%-2rem)] flex-col gap-0 p-0 sm:h-[calc(100dvh-4rem)] sm:max-w-[calc(100%-4rem)]">
        {/* The markdown has its own "Changelog" heading; these are for screen readers. */}
        <DialogTitle className="sr-only">Changelog</DialogTitle>
        <DialogDescription className="sr-only">What&apos;s new in GIS Converter.</DialogDescription>
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-10 sm:py-8">
          <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
            <ChangelogContent />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}
