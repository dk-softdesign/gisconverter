import { CheckCircle2, Lightbulb, Loader2 } from "lucide-react";

import { Button } from "#/components/ui/button";
import { crsLabel } from "#/lib/crs";

export interface FileCrsMatches {
  fileName: string;
  // Source CRSs the file's coordinates fit, most likely first.
  matches: string[];
}

export type CrsDetection =
  | { status: "detecting" }
  // `autoSelected` is the CRS that was selected from the detection, if any.
  | { status: "done"; files: FileCrsMatches[]; autoSelected?: string };

// CRSs every file fits, in the same most-likely-first order.
export function commonCrsMatches(files: FileCrsMatches[]): string[] {
  if (files.length === 0) return [];
  return files[0].matches.filter((crs) => files.every((f) => f.matches.includes(crs)));
}

interface CrsDetectionHintProps {
  detection: CrsDetection | null;
  sourceCrs: string;
  onUse: (crs: string) => void;
}

export function CrsDetectionHint({ detection, sourceCrs, onUse }: CrsDetectionHintProps) {
  if (!detection) return null;
  if (detection.status === "detecting") {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Checking the coordinates in the file…
      </p>
    );
  }

  const { files, autoSelected } = detection;
  if (files.length === 0) return null;
  const subject = files.length === 1 ? "the file" : "the files";
  const common = commonCrsMatches(files);

  if (common.includes(sourceCrs)) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="size-3.5 shrink-0" />
        {sourceCrs === autoSelected
          ? `Selected from the coordinates in ${subject}.`
          : `Matches the coordinates in ${subject}.`}
      </p>
    );
  }

  if (common.length > 0) {
    const suggested = common[0];
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
        <Lightbulb className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="min-w-0 flex-1">
          The coordinates in {subject} don&apos;t fit the selected system. They look like{" "}
          <span className="font-medium">{crsLabel(suggested)}</span>.
        </span>
        <Button type="button" size="sm" variant="outline" onClick={() => onUse(suggested)}>
          Use {suggested}
        </Button>
      </div>
    );
  }

  if (files.every((f) => f.matches.length === 0)) {
    return (
      <p className="text-sm text-muted-foreground">
        Couldn&apos;t match the coordinates in {subject} to any of these coordinate systems.
      </p>
    );
  }

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      <p>These files seem to use different coordinate systems — convert them separately:</p>
      <ul className="mt-1 list-disc pl-5">
        {files.map((f) => (
          <li key={f.fileName}>
            {f.fileName}: {f.matches[0] ? crsLabel(f.matches[0]) : "not recognised"}
          </li>
        ))}
      </ul>
    </div>
  );
}
