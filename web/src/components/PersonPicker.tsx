import Fuse from "fuse.js";
import { useId, useMemo, useRef, useState } from "react";
import { fmtLife } from "../lib/format";
import type { Core } from "../lib/store";

/** Accessible combobox for picking one person by name. */
export function PersonPicker({
  core,
  value,
  onChange,
  label,
  placeholder = "Type a name…",
}: {
  core: Core;
  value: number | null;
  onChange: (i: number | null) => void;
  label: string;
  placeholder?: string;
}) {
  const p = core.people;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const fuse = useRef<Fuse<number> | null>(null);
  const results = useMemo(() => {
    if (q.trim().length < 2) return [];
    fuse.current ??= new Fuse(
      Array.from({ length: p.n }, (_, i) => i),
      { keys: [{ name: "n", getFn: (i) => p.name[i] }], threshold: 0.3, ignoreLocation: true },
    );
    return fuse.current.search(q, { limit: 8 }).map((r) => r.item);
  }, [q, p]);

  const choose = (i: number) => {
    onChange(i);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={results.length ? `${id}-${active}` : undefined}
        value={open ? q : value !== null ? p.name[value] : q}
        placeholder={placeholder}
        onFocus={() => {
          setOpen(true);
          setQ("");
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === "Enter" && results[active] !== undefined) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        className="w-full rounded-md border border-line bg-bg px-3 py-2 text-sm"
      />
      {open && results.length > 0 && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-line bg-surface shadow-xl"
        >
          {results.map((i, k) => (
            <li
              id={`${id}-${k}`}
              key={i}
              role="option"
              aria-selected={k === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(i);
              }}
              className={"flex cursor-pointer justify-between px-3 py-1.5 text-sm " + (k === active ? "bg-surface-2" : "")}
            >
              <span>{p.name[i]}</span>
              <span className="text-xs text-muted">{fmtLife(p.by[i], p.dy[i])}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
