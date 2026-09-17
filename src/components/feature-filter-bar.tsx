import { useState } from "react";
import { Search, X } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";

export interface PropertyFilter {
  id: string;
  key: string;
  value: string;
}

interface FeatureFilterBarProps {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  existingKeys: string[];
  filters: PropertyFilter[];
  onAddFilter: (key: string, value: string) => void;
  onRemoveFilter: (id: string) => void;
}

export function FeatureFilterBar({
  searchQuery,
  onSearchQueryChange,
  existingKeys,
  filters,
  onAddFilter,
  onRemoveFilter,
}: FeatureFilterBarProps) {
  const [filterKey, setFilterKey] = useState("");
  const [filterValue, setFilterValue] = useState("");

  function handleAddFilter() {
    const trimmedKey = filterKey.trim();
    const trimmedValue = filterValue.trim();
    if (!trimmedKey || !trimmedValue) return;
    onAddFilter(trimmedKey, trimmedValue);
    setFilterKey("");
    setFilterValue("");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search all properties…"
          className="pl-9"
          aria-label="Search features"
        />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="filter-key">
            Property
          </label>
          <Input
            id="filter-key"
            list="feature-filter-existing-keys"
            value={filterKey}
            onChange={(e) => setFilterKey(e.target.value)}
            placeholder="e.g. status"
            autoComplete="off"
            className="w-40"
          />
          <datalist id="feature-filter-existing-keys">
            {existingKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </datalist>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="filter-value">
            Contains
          </label>
          <Input
            id="filter-value"
            value={filterValue}
            onChange={(e) => setFilterValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddFilter();
              }
            }}
            className="w-40"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!filterKey.trim() || !filterValue.trim()}
          onClick={handleAddFilter}
        >
          Add filter
        </Button>
      </div>
      {filters.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => (
            <span
              key={filter.id}
              className="flex items-center gap-1.5 rounded-full border bg-muted/50 py-1 pr-1 pl-3 text-xs"
            >
              <span>
                <span className="font-medium">{filter.key}</span>: {filter.value}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-5"
                onClick={() => onRemoveFilter(filter.id)}
                aria-label={`Remove filter ${filter.key}: ${filter.value}`}
              >
                <X className="size-3" />
              </Button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
