import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover";
import { cn } from "#/lib/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
  // Extra terms the search should match on (e.g. a property key behind a title).
  keywords?: string[];
  className?: string;
}

export interface SearchableSelectGroup {
  heading?: string;
  options: SearchableSelectOption[];
}

interface SearchableSelectProps {
  value: string | null;
  onValueChange: (value: string) => void;
  // Either a flat list or headed groups.
  options?: SearchableSelectOption[];
  groups?: SearchableSelectGroup[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  // Offer whatever is typed in the search box as a value of its own, for
  // fields where a new name (e.g. a new property key) is legitimate.
  allowCustom?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}

// The app-wide dropdown: a button that opens a search box over a scrollable
// list, so long lists (property keys, CRSes, schemas) stay usable.
export function SearchableSelect({
  value,
  onValueChange,
  options,
  groups,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No match found.",
  allowCustom = false,
  disabled,
  id,
  className,
  "aria-label": ariaLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const allGroups = groups ?? [{ options: options ?? [] }];
  const allOptions = allGroups.flatMap((group) => group.options);
  const selected = allOptions.find((option) => option.value === value);
  const customValue = search.trim();
  const showCustom =
    allowCustom && customValue !== "" && !allOptions.some((option) => option.value === customValue);

  function select(next: string) {
    onValueChange(next);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn("justify-between font-normal", selected?.className, className)}
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {selected?.label ?? (value || placeholder)}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popper-anchor-width)] min-w-56 p-0">
        {/*
          disablePointerSelection: without it, cmdk highlights whatever item is
          under the cursor on every pointermove — including the ones that slide
          under a stationary cursor while the list scrolls, which calls
          scrollIntoView on each and fights the user's own wheel scroll.
        */}
        <Command disablePointerSelection>
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList>
            {!showCustom && <CommandEmpty>{emptyText}</CommandEmpty>}
            {showCustom && (
              <CommandGroup>
                <CommandItem forceMount value={customValue} onSelect={() => select(customValue)}>
                  <Check className="size-4 opacity-0" />
                  Use &quot;{customValue}&quot;
                </CommandItem>
              </CommandGroup>
            )}
            {allGroups.map((group, index) =>
              group.options.length === 0 ? null : (
                <CommandGroup key={group.heading ?? index} heading={group.heading}>
                  {group.options.map((option) => (
                    <CommandItem
                      key={option.value}
                      value={option.value}
                      keywords={[option.label, ...(option.keywords ?? [])]}
                      className={option.className}
                      onSelect={() => select(option.value)}
                    >
                      <Check
                        className={cn(
                          "size-4",
                          option.value === value ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="truncate">{option.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ),
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
