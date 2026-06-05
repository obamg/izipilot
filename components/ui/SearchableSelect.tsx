"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

export interface SearchableOption {
  value: string;
  label: string;
  /** Optional extra text matched by the search filter (kept invisible). */
  searchHaystack?: string;
}

export interface SearchableGroup {
  /** Group label shown as a non-selectable header. Pass empty/undefined to skip. */
  label?: string;
  options: SearchableOption[];
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  /** Flat options or grouped options. Both supported. */
  options: SearchableOption[] | SearchableGroup[];
  /** Always-visible "select all" / clear option at the top of the list. */
  allOption?: { value: string; label: string };
  /** Shown on the button when no value is selected (or value matches allOption.value). */
  placeholder?: string;
  /** Accessible label for the button. */
  ariaLabel?: string;
  /** Additional classes for the button. */
  className?: string;
  /** Disable the whole control. */
  disabled?: boolean;
  /** Text shown when the search filter yields no matches. */
  emptyLabel?: string;
  /** Max height (px) of the scrollable list. Defaults to 280. */
  maxListHeight?: number;
}

function isGrouped(
  options: SearchableOption[] | SearchableGroup[]
): options is SearchableGroup[] {
  return options.length > 0 && (options[0] as SearchableGroup).options !== undefined;
}

function normalize(s: string): string {
  // Diacritic-insensitive, lower-case match — helps with FR titles like
  // "Atteindre 50k MAU" or "Réduire". Strips combining marks via NFD.
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function SearchableSelect({
  value,
  onChange,
  options,
  allOption,
  placeholder = "Sélectionner…",
  ariaLabel,
  className = "",
  disabled = false,
  emptyLabel = "Aucun résultat",
  maxListHeight = 280,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const groups: SearchableGroup[] = useMemo(
    () => (isGrouped(options) ? options : [{ options }]),
    [options]
  );

  // Flat, filtered, in-display-order list. activeIndex points into this array.
  const filteredFlat = useMemo(() => {
    const q = normalize(query.trim());
    const out: Array<{ group?: string; option: SearchableOption }> = [];
    if (allOption) out.push({ option: allOption });
    for (const g of groups) {
      const matching = g.options.filter((o) => {
        if (!q) return true;
        const hay = normalize(`${o.label} ${o.searchHaystack ?? ""}`);
        return hay.includes(q);
      });
      if (matching.length === 0) continue;
      for (let i = 0; i < matching.length; i++) {
        out.push({ group: i === 0 ? g.label : undefined, option: matching[i] });
      }
    }
    return out;
  }, [groups, query, allOption]);

  // Label of the current value, for the button face.
  const currentLabel = useMemo(() => {
    if (allOption && value === allOption.value) return allOption.label;
    for (const g of groups) {
      for (const o of g.options) {
        if (o.value === value) return o.label;
      }
    }
    return placeholder;
  }, [value, groups, allOption, placeholder]);

  const isPlaceholder = !value || (allOption ? value === allOption.value : false);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  }, []);

  // Click-outside + Escape
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, close]);

  // Focus the search input when opening, scroll active option into view.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-index="${activeIndex}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  // Reset activeIndex when filter shrinks below the current one.
  useEffect(() => {
    if (activeIndex >= filteredFlat.length) setActiveIndex(0);
  }, [filteredFlat.length, activeIndex]);

  function handleListKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filteredFlat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const picked = filteredFlat[activeIndex]?.option;
      if (picked) {
        onChange(picked.value);
        close();
        buttonRef.current?.focus();
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(Math.max(0, filteredFlat.length - 1));
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        className={`izi-form-input flex items-center justify-between gap-2 rounded-[7px] border border-border-soft bg-white px-2.5 py-1.5 text-left text-dark hover:border-teal-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
      >
        <span className={`truncate ${isPlaceholder ? "text-izi-gray" : ""}`}>
          {currentLabel}
        </span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-3.5 h-3.5 shrink-0 text-izi-gray"
          aria-hidden="true"
        >
          <polyline points="5 8 10 13 15 8" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute left-0 z-[var(--z-dropdown)] mt-1 w-[min(20rem,90vw)] rounded-[8px] border border-border-soft bg-white shadow-lg"
          role="dialog"
        >
          <div className="border-b border-border-soft p-2">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleListKey}
              placeholder="Rechercher…"
              aria-label="Filtrer les options"
              className="izi-form-input w-full rounded-[5px] border border-border-soft bg-white px-2 py-1.5 text-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            className="overflow-y-auto p-1"
            style={{ maxHeight: maxListHeight }}
          >
            {filteredFlat.length === 0 ? (
              <div className="px-2 py-3 text-center text-[11px] text-izi-gray">
                {emptyLabel}
              </div>
            ) : (
              filteredFlat.map(({ group, option }, i) => {
                const isActive = i === activeIndex;
                const isSelected = option.value === value;
                return (
                  <div key={`${i}-${option.value}`}>
                    {group !== undefined && group !== "" && (
                      <div className="px-2 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-[0.07em] text-izi-gray">
                        {group}
                      </div>
                    )}
                    <button
                      type="button"
                      role="option"
                      data-index={i}
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => {
                        onChange(option.value);
                        close();
                        buttonRef.current?.focus();
                      }}
                      className={`flex w-full items-center justify-between gap-2 rounded-[5px] px-2 py-1.5 text-left text-[11px] transition-colors ${
                        isActive ? "bg-teal-lt" : ""
                      } ${isSelected ? "text-teal font-semibold" : "text-dark"}`}
                    >
                      <span className="truncate">{option.label}</span>
                      {isSelected && (
                        <svg
                          viewBox="0 0 20 20"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="w-3.5 h-3.5 shrink-0"
                          aria-hidden="true"
                        >
                          <polyline points="4 10 8 14 16 6" />
                        </svg>
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
