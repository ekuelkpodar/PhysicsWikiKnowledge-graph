import { AnimatePresence, motion } from "framer-motion";
import { useMemo } from "react";
import { activeFilterCount, DEFAULT_FILTERS } from "../lib/filters";
import { useApp } from "../lib/store";
import { Button, IconX } from "./ui";

export function FilterDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { core, filters, setFilters, visible } = useApp();
  const countries = useMemo(() => {
    if (!core) return [];
    const counts = new Map<number, number>();
    core.people.c.forEach((c) => c >= 0 && counts.set(c, (counts.get(c) ?? 0) + 1));
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 60)
      .map(([i, n]) => ({ name: core.people.countries[i], n }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [core]);
  const nVisible = useMemo(() => (visible ? visible.reduce((s, v) => s + v, 0) : null), [visible]);

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
          className="absolute top-full right-2 z-40 mt-2 w-[min(92vw,340px)] rounded-xl border border-line bg-surface p-4 shadow-2xl"
          aria-label="Filters"
          role="dialog"
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg">Filters</h2>
            <Button onClick={onClose} aria-label="Close filters">
              <IconX />
            </Button>
          </div>
          <div className="space-y-3 text-sm">
            <Toggle
              label="Core physicists only"
              hint="Hides politicians, philosophers and others tagged 'physicist'"
              checked={filters.core}
              onChange={(v) => setFilters({ core: v })}
            />
            <Toggle
              label="Laureates only"
              hint="Holders of a major award"
              checked={filters.laureates}
              onChange={(v) => setFilters({ laureates: v })}
            />
            <Toggle
              label="Show predicted links"
              hint="Dashed cyan: model-suggested advisors"
              checked={filters.predicted}
              onChange={(v) => setFilters({ predicted: v })}
            />
            <Select
              label="Field community"
              value={filters.field === null ? "" : String(filters.field)}
              onChange={(v) => setFilters({ field: v === "" ? null : Number(v) })}
              options={(core?.people.communities ?? []).map((c) => ({ value: String(c.id), label: c.label }))}
            />
            <Select
              label="Country (birthplace)"
              value={filters.country ?? ""}
              onChange={(v) => setFilters({ country: v || null })}
              options={countries.map((c) => ({ value: c.name, label: `${c.name} (${c.n.toLocaleString()})` }))}
            />
            <Select
              label="Gender"
              value={filters.gender ?? ""}
              onChange={(v) => setFilters({ gender: v || null })}
              options={(core?.people.genders ?? []).filter(Boolean).map((g) => ({ value: g, label: g }))}
            />
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
            <span aria-live="polite">{nVisible !== null && `${nVisible.toLocaleString()} people match`}</span>
            <Button
              variant="outline"
              disabled={activeFilterCount(filters) === 0}
              onClick={() => setFilters({ ...DEFAULT_FILTERS, predicted: filters.predicted })}
            >
              Clear filters
            </Button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span>
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--gold)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm text-text"
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
