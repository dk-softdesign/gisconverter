// oxlint-disable typescript/no-base-to-string
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  Download,
  FolderOpen,
  Globe,
  Loader2,
  Redo2,
  Settings as SettingsIcon,
  Undo2,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import { BulkEditDialog } from "#/components/bulk-edit-dialog";
import { SearchableSelect } from "#/components/searchable-select";
import {
  CrsDetectionHint,
  commonCrsMatches,
  type CrsDetection,
  type FileCrsMatches,
} from "#/components/crs-detection-hint";
import { FeatureFilterBar, type PropertyFilter } from "#/components/feature-filter-bar";
import { FeatureList } from "#/components/feature-list";
import { GeoJsonMap } from "#/components/geojson-map";
import { LayerLegend } from "#/components/layer-legend";
import { PropertyEditDialog } from "#/components/property-edit-dialog";
import { SettingsDialog } from "#/components/settings-dialog";
import { SidePanel } from "#/components/side-panel";
import { SchemaValidationPanel } from "#/components/schema-validation-panel";
import { ThemeToggle } from "#/components/theme-toggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { collectFilesFromDataTransfer } from "#/lib/collect-files";
import { SUPPORTED_SOURCE_CRS } from "#/lib/crs";
import { groupNameOf, ISSUE_COLORS } from "#/lib/layer-colors";
import type { PropertyRecord } from "#/lib/property-value";
import { getSchemaEntry } from "#/lib/gis-schemas";
import { NO_GEOMETRY_ERROR_CODE } from "#/lib/no-geometry";
import { roundCoordinates } from "#/lib/round-coordinates";
import { useSettings } from "#/lib/settings";
import {
  validateLayer,
  worstSeverity,
  type FeatureValidationResult,
  type IssueSeverity,
} from "#/lib/schema-validation";
import { useUndoHistory } from "#/lib/undo-history";
import { cn } from "#/lib/utils";

// One toast slot for edit/undo notices, so a new change replaces the previous
// toast instead of stacking Undo buttons that would each undo the latest step.
const HISTORY_TOAST_ID = "edit-history";

function plural(count: number, noun: string) {
  if (count === 1) return `${count} ${noun}`;
  return `${count} ${noun.endsWith("y") ? `${noun.slice(0, -1)}ies` : `${noun}s`}`;
}

// Ctrl/Cmd+Z inside a text field or a dialog belongs to that field/dialog,
// not to the app-level history.
function isOwnUndoContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[role="dialog"]')) return true;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

const SUPPORTED_EXTENSIONS = [
  ".dxf",
  ".zip",
  ".xlsx",
  ".geojson",
  ".json",
  ".kml",
  ".kmz",
  ".gpkg",
];

function isSupportedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export const Route = createFileRoute("/")({ component: Home });

interface ConvertResponse {
  featureCollection: GeoJSON.FeatureCollection;
  warnings: string[];
}

function stringifyPropertyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

// A file the server converted fine except that it found no geometry in it;
// the user is asked whether to import its records with properties only.
interface NoGeometryFile {
  file: File;
  index: number;
  message: string;
  recordCount: number;
}

type ConvertOutcome =
  | { file: File; data: ConvertResponse }
  | { file: File; error: string }
  | { file: File; noGeometry: NoGeometryFile };

interface FileStatus {
  file: File;
  status: "pending" | "done" | "error";
  error?: string;
}

// Outline buttons restyled for the always-dark app header.
const HEADER_BUTTON_CLASS =
  "border-white/20 bg-transparent text-zinc-50 hover:bg-white/10 hover:text-zinc-50 dark:border-white/20 dark:bg-transparent dark:hover:bg-white/10";

function WarningsAlert({ warnings }: { warnings: string[] }) {
  return (
    <Alert>
      <AlertTitle>Heads up</AlertTitle>
      <AlertDescription>
        {warnings.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
      </AlertDescription>
    </Alert>
  );
}

function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const settings = useSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // null until the user (or CRS detection) picks one for the current files;
  // until then the default from Settings applies.
  const [sourceCrsChoice, setSourceCrs] = useState<string | null>(null);
  const sourceCrs = sourceCrsChoice ?? settings.defaultSourceCrs;
  const [crsDetection, setCrsDetection] = useState<CrsDetection | null>(null);
  const detectionRequestId = useRef(0);
  const [status, setStatus] = useState<"idle" | "converting" | "error">("idle");
  // While set, the no-geometry prompt is open; `resolve` receives the answer.
  const [noGeometryPrompt, setNoGeometryPrompt] = useState<{
    files: NoGeometryFile[];
    resolve: (importAnyway: boolean) => void;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Every change to the converted data goes through this history, so it can
  // be undone. `result` is the current version.
  const history = useUndoHistory<ConvertResponse | null>(null);
  const result = history.present;
  const [isDragging, setIsDragging] = useState(false);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [layerSchemaIds, setLayerSchemaIds] = useState<Record<string, string | null>>({});
  const [layerDuplicateKeys, setLayerDuplicateKeys] = useState<Record<string, string | null>>({});
  const [selectedFeatures, setSelectedFeatures] = useState<Set<GeoJSON.Feature>>(new Set());
  // Column-level changes staged from the List tab: key → new name, or null to
  // delete. Nothing touches the data until they're applied.
  const [pendingColumnChanges, setPendingColumnChanges] = useState<Record<string, string | null>>(
    {},
  );
  const [editingFeature, setEditingFeature] = useState<GeoJSON.Feature | null>(null);
  const [editSessionId, setEditSessionId] = useState(0);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditSessionId, setBulkEditSessionId] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [propertyFilters, setPropertyFilters] = useState<PropertyFilter[]>([]);
  const [isUploadCollapsed, setIsUploadCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState("map");
  // null follows the default from Settings until the checkbox is used.
  const [highlightIssuesChoice, setHighlightIssues] = useState<boolean | null>(null);
  const highlightIssues = highlightIssuesChoice ?? settings.highlightIssues;
  const [focusFeature, setFocusFeature] = useState<GeoJSON.Feature | null>(null);
  // Bumps per conversion; the map only re-fits its view when this (or the
  // visible layers) change.
  const [conversionId, setConversionId] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextFilterId = useRef(0);

  // After a conversion the upload form collapses and the page switches to a
  // working layout: source info in a side panel, the preview filling the rest.
  const previewFocused = result !== null && isUploadCollapsed;

  const layers = useMemo(() => {
    if (!result) return [];
    return [...new Set(result.featureCollection.features.map((f) => groupNameOf(f)))].sort();
  }, [result]);

  const visibleFeatureCollection = useMemo((): GeoJSON.FeatureCollection => {
    if (!result) return { type: "FeatureCollection", features: [] };
    if (hiddenLayers.size === 0) return result.featureCollection;
    return {
      type: "FeatureCollection",
      features: result.featureCollection.features.filter((f) => !hiddenLayers.has(groupNameOf(f))),
    };
  }, [result, hiddenLayers]);

  const featuresByLayer = useMemo(() => {
    const map: Record<string, GeoJSON.Feature[]> = {};
    for (const layer of layers) map[layer] = [];
    for (const feature of result?.featureCollection.features ?? []) {
      (map[groupNameOf(feature)] ??= []).push(feature);
    }
    return map;
  }, [result, layers]);

  // Validation runs here, once, so the Validation tab and the map's issue
  // highlighting always agree. null for a layer with nothing to check.
  const validationByLayer = useMemo(() => {
    const byLayer: Record<string, FeatureValidationResult[] | null> = {};
    for (const layer of layers) {
      const schema = getSchemaEntry(layerSchemaIds[layer])?.schema;
      const duplicateKey = layerDuplicateKeys[layer] ?? null;
      byLayer[layer] =
        schema || duplicateKey
          ? validateLayer(featuresByLayer[layer] ?? [], schema, duplicateKey)
          : null;
    }
    return byLayer;
  }, [layers, featuresByLayer, layerSchemaIds, layerDuplicateKeys]);

  const withoutGeometryCount = useMemo(
    () => visibleFeatureCollection.features.filter((f) => !f.geometry).length,
    [visibleFeatureCollection],
  );

  const isValidating = Object.values(validationByLayer).some((results) => results !== null);

  const issueSeverity = useMemo(() => {
    const severity = new Map<GeoJSON.Feature, IssueSeverity>();
    for (const [layer, results] of Object.entries(validationByLayer)) {
      for (const { featureIndex, issues } of results ?? []) {
        const feature = featuresByLayer[layer]?.[featureIndex];
        if (feature) severity.set(feature, worstSeverity(issues));
      }
    }
    return severity;
  }, [validationByLayer, featuresByLayer]);
  const issueCounts = useMemo(() => {
    const counts = { error: 0, warning: 0 };
    for (const value of issueSeverity.values()) counts[value]++;
    return counts;
  }, [issueSeverity]);
  const showIssuesOnMap = highlightIssues && isValidating;

  const hiddenLayersKey = [...hiddenLayers].sort().join(",");
  const mapFitKey = `${conversionId}:${hiddenLayersKey}`;
  // Identifies everything the map's vector layer draws — data revision,
  // visible layers and issue styling — so it remounts whenever any of them
  // change, including after edits, deletes, undo and redo.
  const mapVersion = `${history.revision}:${hiddenLayersKey}:${showIssuesOnMap ? JSON.stringify([layerSchemaIds, layerDuplicateKeys]) : ""}`;

  function selectFeatures(features: GeoJSON.Feature[]) {
    setSelectedFeatures(new Set(features));
    toast(`Selected ${plural(features.length, "feature")}`, {
      id: HISTORY_TOAST_ID,
      action: { label: "Edit selected", onClick: openBulkEdit },
    });
  }

  const clearFocusFeature = useCallback(() => setFocusFeature(null), []);

  function showOnMap(feature: GeoJSON.Feature) {
    const layer = groupNameOf(feature);
    if (hiddenLayers.has(layer)) {
      setHiddenLayers((prev) => {
        const next = new Set(prev);
        next.delete(layer);
        return next;
      });
    }
    setFocusFeature(feature);
    setActiveTab("map");
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || isOwnUndoContext(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey && history.undoLabel) {
        event.preventDefault();
        undoChange();
      } else if ((key === "y" || (key === "z" && event.shiftKey)) && history.redoLabel) {
        event.preventDefault();
        redoChange();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function commitFeatures(
    label: string,
    transform: (features: GeoJSON.Feature[]) => GeoJSON.Feature[],
    { notify = true } = {},
  ) {
    history.commit(label, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        featureCollection: {
          ...prev.featureCollection,
          features: transform(prev.featureCollection.features),
        },
      };
    });
    if (notify) {
      toast(label, {
        id: HISTORY_TOAST_ID,
        action: { label: "Undo", onClick: () => undoChange(label) },
      });
    }
  }

  // Selections hold feature object references; after undo/redo those may no
  // longer be in the data, so the selection is dropped rather than left stale.
  function undoChange(label = history.undoLabel) {
    if (!label) return;
    history.undo();
    setSelectedFeatures(new Set());
    toast(`Undone: ${label}`, {
      id: HISTORY_TOAST_ID,
      action: { label: "Redo", onClick: () => redoChange(label) },
    });
  }

  function redoChange(label = history.redoLabel) {
    if (!label) return;
    history.redo();
    setSelectedFeatures(new Set());
    toast(`Redone: ${label}`, {
      id: HISTORY_TOAST_ID,
      action: { label: "Undo", onClick: () => undoChange(label) },
    });
  }

  function toggleLayer(layer: string) {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  }

  const existingPropertyKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const feature of visibleFeatureCollection.features) {
      for (const key of Object.keys(feature.properties ?? {})) keys.add(key);
    }
    return [...keys].sort();
  }, [visibleFeatureCollection]);

  // Staged changes can outlive the keys they refer to (undo, hiding a layer,
  // another edit), so only those whose key is still present count.
  const activeColumnChanges = useMemo(() => {
    const active: Record<string, string | null> = {};
    for (const key of existingPropertyKeys) {
      if (key in pendingColumnChanges) active[key] = pendingColumnChanges[key];
    }
    return active;
  }, [existingPropertyKeys, pendingColumnChanges]);
  const activeColumnChangeCount = Object.keys(activeColumnChanges).length;

  function setPendingColumnChange(key: string, change: string | null | undefined) {
    setPendingColumnChanges((prev) => {
      const next = { ...prev };
      if (change === undefined || change === key) delete next[key];
      else next[key] = change;
      return next;
    });
  }

  // Why a staged rename of `key` to `name` can't be accepted, if it can't:
  // it would land on a property that still exists or another rename's target,
  // and one value would silently overwrite the other.
  function columnRenameError(key: string, name: string): string | null {
    if (name === "") return "Enter a property name";
    if (name === key) return null;
    const keptKeys = existingPropertyKeys.filter(
      (other) => other !== key && !(other in activeColumnChanges),
    );
    if (keptKeys.includes(name)) return `"${name}" already exists`;
    const otherTargets = Object.entries(activeColumnChanges)
      .filter(([other, target]) => other !== key && target !== null)
      .map(([, target]) => target);
    if (otherTargets.includes(name)) return `Another property is already renamed to "${name}"`;
    return null;
  }

  // Applies to every feature in the visible layers, regardless of the list's
  // search/filters — a column is changed as a whole, not row by row.
  function applyColumnChanges() {
    if (activeColumnChangeCount === 0) return;
    const visibleLayers = new Set(layers.filter((layer) => !hiddenLayers.has(layer)));
    renameProperties(
      `Renamed or removed ${plural(activeColumnChangeCount, "property")}`,
      activeColumnChanges,
      visibleLayers,
    );
    setPendingColumnChanges({});
  }

  const filteredFeatureCollection = useMemo((): GeoJSON.FeatureCollection => {
    const query = searchQuery.trim().toLowerCase();
    if (!query && propertyFilters.length === 0) return visibleFeatureCollection;
    return {
      type: "FeatureCollection",
      features: visibleFeatureCollection.features.filter((feature) => {
        const properties = feature.properties ?? {};
        if (query) {
          const matchesSearch = Object.values(properties).some((value) =>
            stringifyPropertyValue(value).toLowerCase().includes(query),
          );
          if (!matchesSearch) return false;
        }
        return propertyFilters.every((filter) =>
          stringifyPropertyValue(properties[filter.key])
            .toLowerCase()
            .includes(filter.value.toLowerCase()),
        );
      }),
    };
  }, [visibleFeatureCollection, searchQuery, propertyFilters]);

  function addPropertyFilter(key: string, value: string) {
    const id = String(nextFilterId.current++);
    setPropertyFilters((prev) => [...prev, { id, key, value }]);
  }

  function removePropertyFilter(id: string) {
    setPropertyFilters((prev) => prev.filter((filter) => filter.id !== id));
  }

  function toggleFeatureSelection(feature: GeoJSON.Feature) {
    setSelectedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(feature)) next.delete(feature);
      else next.add(feature);
      return next;
    });
  }

  function toggleAllSelection() {
    setSelectedFeatures((prev) => {
      const features = filteredFeatureCollection.features;
      const allSelected = features.length > 0 && features.every((f) => prev.has(f));
      return allSelected ? new Set() : new Set(features);
    });
  }

  function openEditDialog(feature: GeoJSON.Feature) {
    setEditingFeature(feature);
    setEditSessionId((id) => id + 1);
  }

  function updateFeatureProperties(
    target: GeoJSON.Feature,
    properties: Record<string, string | number | boolean | null>,
  ) {
    commitFeatures(
      "Edited feature properties",
      (features) => features.map((f) => (f === target ? { ...f, properties } : f)),
      { notify: false },
    );
  }

  function deleteFeature(target: GeoJSON.Feature) {
    commitFeatures("Deleted 1 feature", (features) => features.filter((f) => f !== target));
    setSelectedFeatures((prev) => {
      if (!prev.has(target)) return prev;
      const next = new Set(prev);
      next.delete(target);
      return next;
    });
  }

  function applyBulkEdit(
    updates: Map<GeoJSON.Feature, PropertyRecord>,
    removals: Set<GeoJSON.Feature>,
  ) {
    const parts = [
      removals.size > 0 && `Removed ${plural(removals.size, "feature")}`,
      updates.size > 0 && `Edited ${plural(updates.size, "feature")}`,
    ].filter(Boolean);
    commitFeatures(parts.join(", "), (features) =>
      features
        .filter((f) => !removals.has(f))
        .map((f) => (updates.has(f) ? { ...f, properties: updates.get(f)! } : f)),
    );
    setSelectedFeatures(new Set());
    setBulkEditOpen(false);
  }

  function openBulkEdit() {
    setBulkEditOpen(true);
    setBulkEditSessionId((id) => id + 1);
  }

  function setLayerSchema(layer: string, schemaId: string | null) {
    setLayerSchemaIds((prev) => ({ ...prev, [layer]: schemaId }));
  }

  // renameMap: key → new name, or null to remove the property.
  function renameProperties(
    label: string,
    renameMap: Record<string, string | null>,
    inLayers: Set<string>,
  ) {
    commitFeatures(label, (features) =>
      features.map((f) => {
        if (!inLayers.has(groupNameOf(f))) return f;
        const renamed: GeoJSON.GeoJsonProperties = {};
        for (const [key, value] of Object.entries(f.properties ?? {})) {
          if (!(key in renameMap)) {
            renamed[key] = value;
            continue;
          }
          const target = renameMap[key];
          if (target === null) continue;
          renamed[target] = value;
        }
        return { ...f, properties: renamed };
      }),
    );
  }

  function applyPropertyRename(layer: string, renameMap: Record<string, string | null>) {
    const propertyCount = Object.keys(renameMap).length;
    renameProperties(
      `Renamed or removed ${plural(propertyCount, "property")} on ${layer}`,
      renameMap,
      new Set([layer]),
    );
  }

  function selectFiles(next: File[]) {
    const supported = next.filter(isSupportedFile);
    const rejectedCount = next.length - supported.length;

    setFiles(supported);
    setFileStatuses([]);
    history.reset(null);
    setStatus(rejectedCount > 0 && supported.length === 0 ? "error" : "idle");
    setError(
      rejectedCount > 0
        ? `Skipped ${rejectedCount} unsupported file${rejectedCount === 1 ? "" : "s"} — only .dxf, .zip (Shapefile), .xlsx, .geojson, .kml/.kmz, and .gpkg (GeoPackage) are supported.`
        : null,
    );
    setSourceCrs(null);
    void detectCrs(supported);
  }

  // DXF files carry no CRS of their own, so ask the server which source CRS
  // their coordinates fit and select it, unless the default already fits.
  async function detectCrs(selected: File[]) {
    const requestId = ++detectionRequestId.current;
    const dxfFiles = selected.filter((f) => f.name.toLowerCase().endsWith(".dxf"));
    if (dxfFiles.length === 0) {
      setCrsDetection(null);
      return;
    }
    setCrsDetection({ status: "detecting" });
    const results = await Promise.all(
      dxfFiles.map(async (file): Promise<FileCrsMatches | null> => {
        const formData = new FormData();
        formData.append("file", file);
        try {
          const response = await fetch("/api/detect-crs", { method: "POST", body: formData });
          if (!response.ok) return null;
          const data = (await response.json()) as { matches: string[] };
          return { fileName: file.name, matches: data.matches };
        } catch {
          return null;
        }
      }),
    );
    // A newer selection has started its own detection; drop this stale one.
    if (requestId !== detectionRequestId.current) return;
    const detected = results.filter((r) => r !== null);
    const common = commonCrsMatches(detected);
    const defaultCrs = settings.defaultSourceCrs;
    const crs = common.includes(defaultCrs) ? defaultCrs : common[0];
    if (crs) setSourceCrs(crs);
    setCrsDetection({ status: "done", files: detected, autoSelected: crs });
  }

  async function handleConvert() {
    if (files.length === 0) return;
    setStatus("converting");
    setError(null);
    setFileStatuses(files.map((f) => ({ file: f, status: "pending" })));

    const isBatch = files.length > 1;

    const convertFile = async (
      file: File,
      index: number,
      allowNoGeometry = false,
    ): Promise<ConvertOutcome> => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("sourceCrs", sourceCrs);
      if (allowNoGeometry) formData.append("allowNoGeometry", "true");

      const setFileStatus = (update: Omit<FileStatus, "file">) =>
        setFileStatuses((prev) => prev.map((s, i) => (i === index ? { ...s, ...update } : s)));

      try {
        const response = await fetch("/api/convert", { method: "POST", body: formData });
        const data: unknown = await response.json();
        if (!response.ok) {
          const failure = data as { error?: string; code?: string; recordCount?: number };
          const message = failure.error ?? "Failed to convert this file.";
          if (failure.code === NO_GEOMETRY_ERROR_CODE) {
            setFileStatus({ status: "error", error: message });
            return {
              file,
              noGeometry: { file, index, message, recordCount: failure.recordCount ?? 0 },
            };
          }
          throw new Error(message);
        }
        setFileStatus({ status: "done" });
        return { file, data: data as ConvertResponse };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to convert this file.";
        setFileStatus({ status: "error", error: message });
        return { file, error: message };
      }
    };

    const outcomes = await Promise.all(files.map((file, index) => convertFile(file, index)));

    const noGeometryFiles = outcomes.flatMap((o) => ("noGeometry" in o ? [o.noGeometry] : []));
    if (noGeometryFiles.length > 0) {
      const importAnyway = await new Promise<boolean>((resolve) =>
        setNoGeometryPrompt({ files: noGeometryFiles, resolve }),
      );
      setNoGeometryPrompt(null);
      await Promise.all(
        noGeometryFiles.map(async ({ file, index, message }) => {
          if (!importAnyway) {
            outcomes[index] = { file, error: `${message} Not imported.` };
            return;
          }
          setFileStatuses((prev) =>
            prev.map((s, i) => (i === index ? { ...s, status: "pending", error: undefined } : s)),
          );
          outcomes[index] = await convertFile(file, index, true);
        }),
      );
    }

    const features: GeoJSON.Feature[] = [];
    const warnings: string[] = [];

    for (const outcome of outcomes) {
      if ("error" in outcome) {
        warnings.push(`${outcome.file.name}: ${outcome.error}`);
        continue;
      }
      // Every no-geometry outcome was resolved above; this only narrows the type.
      if ("noGeometry" in outcome) continue;
      for (const feature of outcome.data.featureCollection.features) {
        features.push(
          isBatch && !feature.properties?.source
            ? { ...feature, properties: { ...feature.properties, source: outcome.file.name } }
            : feature,
        );
      }
      for (const warning of outcome.data.warnings) {
        warnings.push(isBatch ? `${outcome.file.name}: ${warning}` : warning);
      }
    }

    if (features.length === 0) {
      setError(warnings.join("\n") || "Failed to convert this file.");
      setStatus("error");
      return;
    }

    history.reset({ featureCollection: { type: "FeatureCollection", features }, warnings });
    setPendingColumnChanges({});
    setHiddenLayers(new Set());
    setConversionId((id) => id + 1);
    setFocusFeature(null);
    setLayerSchemaIds({});
    setLayerDuplicateKeys({});
    setSelectedFeatures(new Set());
    setSearchQuery("");
    setPropertyFilters([]);
    setStatus("idle");
    setIsUploadCollapsed(true);
    setActiveTab(settings.defaultTab);
  }

  function downloadGeoJson() {
    if (!result) return;
    const output =
      settings.coordinatePrecision === null
        ? result.featureCollection
        : roundCoordinates(result.featureCollection, settings.coordinatePrecision);
    const blob = new Blob([JSON.stringify(output, null, settings.prettyPrint ? 2 : undefined)], {
      type: "application/geo+json; charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const baseName =
      files[0]?.name.replace(/\.(dxf|zip|xlsx|geojson|json|kml|kmz)$/i, "") ?? "converted";
    link.download =
      files.length > 1 ? `${baseName}-and-${files.length - 1}-more.geojson` : `${baseName}.geojson`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {/* Deliberately dark in both themes, so it stands apart from the page. */}
      <header className="border-b border-white/10 bg-zinc-900 text-zinc-50 shadow-md">
        <div className="flex h-14 items-center justify-between gap-4 px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-emerald-500 text-white">
              <Globe className="size-5" />
            </span>
            {/* Two lines within the fixed h-14 — the Preview card's height relies on it. */}
            <div className="flex min-w-0 flex-col">
              <h1 className="text-lg leading-tight font-semibold tracking-tight">GIS Converter</h1>
              <p className="truncate text-xs leading-tight text-zinc-400">
                Charting every coordinate: Advanced conversion for the GIS-savvy captain
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ClientOnly>
              <ThemeToggle className={HEADER_BUTTON_CLASS} />
            </ClientOnly>
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
          </div>
        </div>
      </header>
      <div className="flex w-full flex-col gap-6 p-8">
        {!previewFocused && (
          <p className="mx-auto w-full max-w-4xl text-lg text-muted-foreground">
            Convert DXF, Shapefile (zipped), Excel, KML, or GeoPackage files — one at a time or in
            bulk — to GeoJSON and preview them together on a map, or load an existing GeoJSON file
            to edit and validate it against a schema.
          </p>
        )}

        {!previewFocused && (
          <Card className="mx-auto w-full max-w-4xl">
            <>
              <CardHeader>
                <CardTitle>Convert files</CardTitle>
                <CardDescription>
                  Currently supported: DXF, Shapefile (.zip), Excel (.xlsx), KML/KMZ, GeoPackage
                  (.gpkg) → GeoJSON, plus existing GeoJSON files for editing and schema validation.
                  Select or drop multiple files, or a whole folder, to convert them together.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".dxf,.zip,.xlsx,.geojson,.json,.kml,.kmz,.gpkg"
                    multiple
                    className="hidden"
                    onChange={(e) => selectFiles([...(e.target.files ?? [])])}
                  />
                  <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDragging(true);
                    }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      void collectFilesFromDataTransfer(e.dataTransfer)
                        .then(selectFiles)
                        .catch(() => setError("Could not read the dropped files."));
                    }}
                    className={cn(
                      "flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                      isDragging
                        ? "border-primary bg-primary/5"
                        : "border-input hover:bg-accent/50",
                    )}
                  >
                    <UploadCloud className="size-8 text-muted-foreground" />
                    <p className="text-sm">
                      <span className="font-medium">
                        Drag and drop .dxf, .zip (Shapefile), .xlsx, .geojson, .kml/.kmz, or .gpkg
                        files (or a folder) here
                      </span>
                      , or click to browse.
                    </p>
                    {files.length > 0 && (
                      <span className="text-sm text-muted-foreground">
                        {files.length === 1 ? files[0].name : `${files.length} files selected`}
                      </span>
                    )}
                  </button>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium" htmlFor="source-crs">
                    Source coordinate system
                  </label>
                  <SearchableSelect
                    id="source-crs"
                    className="w-full sm:w-100"
                    value={sourceCrs}
                    onValueChange={setSourceCrs}
                    options={SUPPORTED_SOURCE_CRS.map((crs) => ({
                      value: crs.code,
                      label: crs.label,
                      keywords: [crs.code],
                    }))}
                    searchPlaceholder="Search coordinate systems…"
                  />
                  <CrsDetectionHint
                    detection={crsDetection}
                    sourceCrs={sourceCrs}
                    onUse={setSourceCrs}
                  />
                  <p className="text-sm text-muted-foreground">
                    Used when the file doesn&apos;t specify its own coordinate system — always for
                    DXF; for a Shapefile only if it has no .prj file; for Excel only if its geom
                    column (or coordinate columns) don&apos;t declare one; for GeoJSON only if it
                    has no &quot;crs&quot; member and its coordinates aren&apos;t lon/lat. The
                    output GeoJSON is always in WGS 84 (EPSG:4326). KML is always WGS 84, so this
                    setting doesn&apos;t apply to it.
                  </p>
                </div>

                <div className="flex gap-3">
                  <Button
                    type="button"
                    disabled={
                      files.length === 0 ||
                      status === "converting" ||
                      crsDetection?.status === "detecting"
                    }
                    onClick={handleConvert}
                  >
                    {status === "converting" && <Loader2 className="size-4 animate-spin" />}
                    {files.length > 1
                      ? `Convert ${files.length} files to GeoJSON`
                      : "Convert to GeoJSON"}
                  </Button>
                  {result && (
                    <Button type="button" variant="secondary" onClick={downloadGeoJson}>
                      Download GeoJSON
                    </Button>
                  )}
                  {result && (
                    // Changed their mind about replacing the current data.
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setIsUploadCollapsed(true)}
                    >
                      Back to preview
                    </Button>
                  )}
                </div>

                {status === "converting" && fileStatuses.length > 1 && (
                  <ul className="flex flex-col gap-1 text-sm">
                    {fileStatuses.map((fs) => (
                      <li key={fs.file.name} className="flex items-center gap-2">
                        {fs.status === "pending" && (
                          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                        )}
                        {fs.status === "done" && (
                          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                        )}
                        {fs.status === "error" && (
                          <XCircle className="size-3.5 shrink-0 text-destructive" />
                        )}
                        <span className={fs.status === "error" ? "text-destructive" : undefined}>
                          {fs.file.name}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {status === "error" && error && (
                  <Alert variant="destructive">
                    <AlertTitle>Conversion failed</AlertTitle>
                    <AlertDescription>
                      {error.split("\n").map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </>

            {result && result.warnings.length > 0 && (
              <CardContent className="pt-0">
                <WarningsAlert warnings={result.warnings} />
              </CardContent>
            )}
          </Card>
        )}

        {/* While the upload form is open (Change file), the preview is hidden. */}
        {result && previewFocused && (
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <SidePanel
              storageKey="gisconverter:sidePanel"
              title="Source"
              description={`${files.length === 1 ? "1 file" : `${files.length} files`} converted to GeoJSON`}
            >
              <ul className="flex flex-col gap-1.5 text-sm">
                {(fileStatuses.length > 0
                  ? fileStatuses
                  : files.map((file): FileStatus => ({ file, status: "done" }))
                ).map((fs) => (
                  <li key={fs.file.name} className="flex flex-col">
                    <span className="flex items-center gap-2">
                      {fs.status === "error" ? (
                        <XCircle className="size-3.5 shrink-0 text-destructive" />
                      ) : (
                        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                      )}
                      <span
                        className={cn("truncate", fs.status === "error" && "text-destructive")}
                        title={fs.file.name}
                      >
                        {fs.file.name}
                      </span>
                    </span>
                    {fs.error && (
                      <span className="pl-5.5 text-xs text-muted-foreground">{fs.error}</span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-2">
                <Button type="button" onClick={downloadGeoJson}>
                  <Download />
                  Download GeoJSON
                </Button>
                <Button type="button" variant="outline" onClick={() => setIsUploadCollapsed(false)}>
                  <FolderOpen />
                  {files.length > 1 ? "Change files" : "Change file"}
                </Button>
              </div>
              {result.warnings.length > 0 && <WarningsAlert warnings={result.warnings} />}
            </SidePanel>
            {/*
              Fills the window below the app header (3.5rem) and the page
              padding (2 × 2rem), with a floor for short windows. It must be a
              real height, not a min-height: the flex-1/min-h-0 chain down to
              the map and list only resolves against a definite height —
              otherwise the map collapses to nothing and the virtualized list
              grows to its full content height and renders every row at once.
              The Validation tab scrolls within it instead.
            */}
            <Card className="h-[max(36rem,calc(100dvh-7.5rem))] min-w-0 flex-1">
              <CardHeader>
                <CardTitle>Preview</CardTitle>
                <CardDescription>
                  {result.featureCollection.features.length} feature
                  {result.featureCollection.features.length === 1 ? "" : "s"}, reprojected to WGS 84
                  (EPSG:4326).
                </CardDescription>
                <CardAction className="flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!history.undoLabel}
                    title={
                      history.undoLabel ? `Undo: ${history.undoLabel} (Ctrl+Z)` : "Nothing to undo"
                    }
                    onClick={() => undoChange()}
                  >
                    <Undo2 />
                    Undo
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!history.redoLabel}
                    title={
                      history.redoLabel
                        ? `Redo: ${history.redoLabel} (Ctrl+Shift+Z)`
                        : "Nothing to redo"
                    }
                    onClick={() => redoChange()}
                  >
                    <Redo2 />
                    Redo
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
                {layers.length > 1 && (
                  <LayerLegend layers={layers} hiddenLayers={hiddenLayers} onToggle={toggleLayer} />
                )}
                <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1">
                  <TabsList>
                    <TabsTrigger value="map">Map</TabsTrigger>
                    <TabsTrigger value="list">List</TabsTrigger>
                    <TabsTrigger value="validation">Validation</TabsTrigger>
                  </TabsList>
                  <TabsContent value="map" className="flex min-h-0 flex-col gap-2">
                    {isValidating && (
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <label htmlFor="highlight-issues" className="flex items-center gap-2">
                          <Checkbox
                            id="highlight-issues"
                            checked={highlightIssues}
                            onCheckedChange={(checked) => setHighlightIssues(checked === true)}
                          />
                          Highlight validation issues
                        </label>
                        {showIssuesOnMap && (
                          <>
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <span
                                className="size-2.5 rounded-full"
                                style={{ backgroundColor: ISSUE_COLORS.error }}
                              />
                              {plural(issueCounts.error, "feature")} with errors
                            </span>
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <span
                                className="size-2.5 rounded-full"
                                style={{ backgroundColor: ISSUE_COLORS.warning }}
                              />
                              {issueCounts.warning} with warnings only
                            </span>
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <span
                                className="size-2.5 rounded-full"
                                style={{ backgroundColor: ISSUE_COLORS.ok }}
                              />
                              no issues
                            </span>
                          </>
                        )}
                      </div>
                    )}
                    <div className="isolate min-h-0 flex-1 overflow-hidden rounded-lg border">
                      <ClientOnly
                        fallback={
                          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                            Loading map…
                          </div>
                        }
                      >
                        <GeoJsonMap
                          featureCollection={visibleFeatureCollection}
                          basemap={settings.basemap}
                          version={mapVersion}
                          fitKey={mapFitKey}
                          issueSeverity={showIssuesOnMap ? issueSeverity : null}
                          focusFeature={focusFeature}
                          onFocusHandled={clearFocusFeature}
                        />
                      </ClientOnly>
                    </div>
                    {withoutGeometryCount > 0 && (
                      <p className="text-sm text-muted-foreground">
                        {withoutGeometryCount === visibleFeatureCollection.features.length
                          ? "None of the features have a geometry, so there is nothing to show on the map — see the List tab."
                          : `${plural(withoutGeometryCount, "feature")} without a geometry ${withoutGeometryCount === 1 ? "isn't" : "aren't"} shown on the map — see the List tab.`}
                      </p>
                    )}
                  </TabsContent>
                  <TabsContent value="list" className="flex min-h-0 flex-col gap-2">
                    <FeatureFilterBar
                      searchQuery={searchQuery}
                      onSearchQueryChange={setSearchQuery}
                      existingKeys={existingPropertyKeys}
                      filters={propertyFilters}
                      onAddFilter={addPropertyFilter}
                      onRemoveFilter={removePropertyFilter}
                    />
                    {(searchQuery.trim() || propertyFilters.length > 0) && (
                      <p className="text-sm text-muted-foreground">
                        {filteredFeatureCollection.features.length} of{" "}
                        {visibleFeatureCollection.features.length} features match
                      </p>
                    )}
                    {selectedFeatures.size > 0 && (
                      <div className="flex items-center justify-between rounded-lg border bg-muted/50 px-3 py-2">
                        <span className="text-sm">{selectedFeatures.size} selected</span>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setSelectedFeatures(new Set())}
                          >
                            Clear
                          </Button>
                          <Button type="button" size="sm" onClick={openBulkEdit}>
                            Edit {selectedFeatures.size} selected
                          </Button>
                        </div>
                      </div>
                    )}
                    {activeColumnChangeCount > 0 && (
                      <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/50 px-3 py-2">
                        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <span className="shrink-0">
                            {plural(activeColumnChangeCount, "pending property change")}:
                          </span>
                          {Object.entries(activeColumnChanges).map(([key, target]) =>
                            target === null ? (
                              <span key={key} className="text-destructive line-through">
                                {key}
                              </span>
                            ) : (
                              <span key={key} className="text-muted-foreground">
                                {key} → <span className="text-foreground">{target}</span>
                              </span>
                            ),
                          )}
                        </span>
                        <div className="flex shrink-0 gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPendingColumnChanges({})}
                          >
                            Cancel
                          </Button>
                          <Button type="button" size="sm" onClick={applyColumnChanges}>
                            Apply {plural(activeColumnChangeCount, "change")}
                          </Button>
                        </div>
                      </div>
                    )}
                    <FeatureList
                      pendingColumnChanges={activeColumnChanges}
                      onPendingColumnChange={setPendingColumnChange}
                      columnRenameError={columnRenameError}
                      featureCollection={filteredFeatureCollection}
                      selectedFeatures={selectedFeatures}
                      onToggleFeature={toggleFeatureSelection}
                      onToggleAll={toggleAllSelection}
                      onEditFeature={openEditDialog}
                    />
                  </TabsContent>
                  <TabsContent
                    value="validation"
                    className="thin-scrollbar min-h-0 overflow-y-auto"
                  >
                    <SchemaValidationPanel
                      layers={layers}
                      featuresByLayer={featuresByLayer}
                      validationByLayer={validationByLayer}
                      layerSchemaIds={layerSchemaIds}
                      onLayerSchemaChange={setLayerSchema}
                      layerDuplicateKeys={layerDuplicateKeys}
                      onLayerDuplicateKeyChange={(layer, key) =>
                        setLayerDuplicateKeys((prev) => ({ ...prev, [layer]: key }))
                      }
                      onDeleteFeature={deleteFeature}
                      onSelectFeatures={selectFeatures}
                      onShowOnMap={showOnMap}
                      onEditFeature={openEditDialog}
                      onApplyRename={applyPropertyRename}
                    />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        )}

        <PropertyEditDialog
          key={`edit-${editSessionId}`}
          feature={editingFeature}
          open={editingFeature !== null}
          onOpenChange={(open) => {
            if (!open) setEditingFeature(null);
          }}
          onSave={(properties) => {
            if (editingFeature) updateFeatureProperties(editingFeature, properties);
            setEditingFeature(null);
          }}
        />
        <Dialog
          open={noGeometryPrompt !== null}
          onOpenChange={(open) => {
            if (!open) noGeometryPrompt?.resolve(false);
          }}
        >
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>No geometry identified</DialogTitle>
              <DialogDescription>
                {noGeometryPrompt?.files.length === 1
                  ? "No geometry could be identified in this file."
                  : `No geometry could be identified in ${noGeometryPrompt?.files.length ?? 0} files.`}{" "}
                Import anyway with only the properties available? The records won&apos;t appear on
                the map, but can be listed, edited, validated and exported.
              </DialogDescription>
            </DialogHeader>
            <ul className="flex flex-col gap-2 text-sm">
              {noGeometryPrompt?.files.map((f) => (
                <li key={f.index}>
                  <span className="font-medium">{f.file.name}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    — {plural(f.recordCount, "record")}
                  </span>
                  <p className="text-muted-foreground">{f.message}</p>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => noGeometryPrompt?.resolve(false)}
              >
                Skip
              </Button>
              <Button type="button" onClick={() => noGeometryPrompt?.resolve(true)}>
                Import properties only
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <BulkEditDialog
          key={`bulk-edit-${bulkEditSessionId}`}
          open={bulkEditOpen}
          features={[...selectedFeatures]}
          existingKeys={existingPropertyKeys}
          onOpenChange={setBulkEditOpen}
          onApply={applyBulkEdit}
        />
      </div>
    </>
  );
}
