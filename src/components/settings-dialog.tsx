import { useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Monitor, Moon, RotateCcw, Sun } from "lucide-react";

import { SearchableSelect } from "#/components/searchable-select";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { clearUserDataFn, countUserDataFn } from "#/lib/auth-functions";
import { SUPPORTED_SOURCE_CRS } from "#/lib/crs";
import {
  useResetSettings,
  useUpdateSettings,
  useSettings,
  type Basemap,
  type PreviewTab,
  type ThemePreference,
} from "#/lib/settings";
import { cn } from "#/lib/utils";

const BASEMAP_OPTIONS: { value: Basemap; label: string }[] = [
  { value: "osm", label: "OpenStreetMap" },
  { value: "carto-light", label: "Light (CARTO Positron)" },
  { value: "carto-dark", label: "Dark (CARTO Dark Matter)" },
  { value: "none", label: "None — features only" },
];

const FULL_PRECISION = "full";
const PRECISION_OPTIONS = [
  { value: FULL_PRECISION, label: "Full precision" },
  { value: "8", label: "8 decimals (≈ 1 mm)" },
  { value: "7", label: "7 decimals (≈ 1 cm)" },
  { value: "6", label: "6 decimals (≈ 10 cm)" },
  { value: "5", label: "5 decimals (≈ 1 m)" },
];

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Changes apply (and are saved to the member's account) immediately — there's no
// save button to forget.
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Changes apply right away and are saved to your account, so they follow you to any
            browser.
          </DialogDescription>
        </DialogHeader>
        <SettingsBody />
      </DialogContent>
    </Dialog>
  );
}

function SettingsBody() {
  const settings = useSettings();
  const updateSettings = useUpdateSettings();

  return (
    <div className="thin-scrollbar -mx-6 flex min-h-0 flex-col gap-6 overflow-y-auto px-6">
      <Section title="Appearance">
        <Setting label="Theme" description="System follows your operating system's setting.">
          <Segmented<ThemePreference>
            label="Theme"
            value={settings.theme}
            onChange={(theme) => updateSettings({ theme })}
            options={[
              { value: "light", label: "Light", icon: <Sun /> },
              { value: "dark", label: "Dark", icon: <Moon /> },
              { value: "system", label: "System", icon: <Monitor /> },
            ]}
          />
        </Setting>
      </Section>

      <Section title="Conversion">
        <Setting
          label="Default source coordinate system"
          description="Pre-selected for new files. DXF files may still get a detected system instead."
          htmlFor="settings-source-crs"
        >
          <SearchableSelect
            id="settings-source-crs"
            className="w-full"
            value={settings.defaultSourceCrs}
            onValueChange={(defaultSourceCrs) => updateSettings({ defaultSourceCrs })}
            options={SUPPORTED_SOURCE_CRS.map((crs) => ({
              value: crs.code,
              label: crs.label,
              keywords: [crs.code],
            }))}
            searchPlaceholder="Search coordinate systems…"
          />
        </Setting>
      </Section>

      <Section title="Preview">
        <Setting label="Open on tab" description="Which tab the preview shows after converting.">
          <Segmented<PreviewTab>
            label="Open on tab"
            value={settings.defaultTab}
            onChange={(defaultTab) => updateSettings({ defaultTab })}
            options={[
              { value: "map", label: "Map" },
              { value: "list", label: "List" },
              { value: "validation", label: "Validation" },
            ]}
          />
        </Setting>
        <Setting label="Map background" htmlFor="settings-basemap">
          <SearchableSelect
            id="settings-basemap"
            className="w-full sm:w-72"
            value={settings.basemap}
            onValueChange={(basemap) => updateSettings({ basemap: basemap as Basemap })}
            options={BASEMAP_OPTIONS}
          />
        </Setting>
        <CheckboxSetting
          id="settings-highlight-issues"
          label="Highlight validation issues on the map"
          description="The starting state of the checkbox above the map when a schema is selected."
          checked={settings.highlightIssues}
          onChange={(highlightIssues) => updateSettings({ highlightIssues })}
        />
      </Section>

      <Section title="Export">
        <Setting
          label="Coordinate precision"
          description="Decimal places kept when downloading GeoJSON. Fewer makes smaller files."
          htmlFor="settings-precision"
        >
          <SearchableSelect
            id="settings-precision"
            className="w-full sm:w-72"
            value={
              settings.coordinatePrecision === null
                ? FULL_PRECISION
                : String(settings.coordinatePrecision)
            }
            onValueChange={(value) =>
              updateSettings({
                coordinatePrecision: value === FULL_PRECISION ? null : Number(value),
              })
            }
            options={PRECISION_OPTIONS}
          />
        </Setting>
        <CheckboxSetting
          id="settings-pretty-print"
          label="Pretty-print GeoJSON"
          description="Indented and readable. Turn off for a compact, smaller file."
          checked={settings.prettyPrint}
          onChange={(prettyPrint) => updateSettings({ prettyPrint })}
        />
      </Section>

      <Section title="Saved data">
        <SavedMappingsSetting />
        <Setting label="Reset settings" description="Puts every setting above back to its default.">
          <ResetSettingsButton />
        </Setting>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="border-b pb-1.5 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Setting({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function CheckboxSetting({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

// Native radios under the hood, so arrow keys and screen readers behave as a
// radio group; the inputs are visually hidden and the labels are the buttons.
function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: React.ReactNode }[];
}) {
  const name = useId();
  return (
    <fieldset className="inline-flex w-fit rounded-lg border bg-muted p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50 [&_svg]:size-4",
            option.value === value
              ? "bg-background text-foreground shadow-sm"
              : "hover:text-foreground",
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.icon}
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

const MAPPING_PREFIX = "mapping:";

function SavedMappingsSetting() {
  const queryClient = useQueryClient();
  const queryKey = ["user-data-count", MAPPING_PREFIX];
  const { data } = useQuery({
    queryKey,
    queryFn: () => countUserDataFn({ data: { prefix: MAPPING_PREFIX } }),
    staleTime: 0,
  });
  const count = data?.count ?? 0;

  async function clear() {
    try {
      await clearUserDataFn({ data: { prefix: MAPPING_PREFIX } });
    } catch {
      toast.error("Couldn't clear saved progress — try again.");
    }
    await queryClient.invalidateQueries({ queryKey });
  }

  return (
    <Setting
      label="Saved property-mapping progress"
      description={
        count === 0
          ? "Nothing saved. Progress saved from “Match property names” shows up here."
          : `${count} saved mapping${count === 1 ? "" : "s"} from “Match property names”.`
      }
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        disabled={count === 0}
        onClick={clear}
      >
        Clear saved progress
      </Button>
    </Setting>
  );
}

// Two-step, since the dialog has no undo: the first click arms it, the second
// resets.
function ResetSettingsButton() {
  const [armed, setArmed] = useState(false);
  const resetSettings = useResetSettings();

  if (!armed) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => setArmed(true)}
      >
        <RotateCcw />
        Reset to defaults
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => {
          resetSettings();
          setArmed(false);
        }}
      >
        Yes, reset all settings
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </div>
  );
}
