import { Command } from "cmdk";
import Fuse from "fuse.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtLife } from "../lib/format";
import { useApp } from "../lib/store";
import { FLAG } from "../lib/types";
import { Avatar, IconSearch } from "./ui";

/** ⌘K fuzzy search over every person; selecting opens the person panel. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { core, select } = useApp();
  const [q, setQ] = useState("");
  const fuse = useRef<Fuse<number> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !isTyping(e))) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const results = useMemo(() => {
    if (!core) return [];
    const p = core.people;
    if (!q.trim()) {
      // famous-first default list: by pagerank percentile + sitelinks proxy (descendants)
      return Array.from({ length: p.n }, (_, i) => i)
        .filter((i) => p.f[i] & FLAG.seed)
        .sort((a, b) => p.d[b] - p.d[a] || p.pr[b] - p.pr[a])
        .slice(0, 12);
    }
    if (!fuse.current) {
      fuse.current = new Fuse(
        Array.from({ length: p.n }, (_, i) => i),
        { keys: [{ name: "name", getFn: (i) => p.name[i] }], threshold: 0.32, ignoreLocation: true, minMatchCharLength: 2 },
      );
    }
    return fuse.current.search(q, { limit: 30 }).map((r) => r.item);
  }, [q, core]);

  if (!open) return null;
  const p = core?.people;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <Command
        label="Search physicists"
        shouldFilter={false}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onOpenChange(false)}
      >
        <div className="flex items-center gap-2 border-b border-line px-4">
          <IconSearch className="text-muted" />
          <Command.Input
            autoFocus
            value={q}
            onValueChange={setQ}
            placeholder={`Search ${p ? p.n.toLocaleString() : ""} people…`}
            className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-line px-1.5 text-xs text-muted">esc</kbd>
        </div>
        <Command.List className="max-h-[50vh] overflow-y-auto p-2">
          {!core && <Command.Loading>Loading names…</Command.Loading>}
          <Command.Empty className="p-6 text-center text-sm text-muted">No one matches “{q}”.</Command.Empty>
          {p &&
            results.map((i) => (
              <Command.Item
                key={i}
                value={String(i)}
                onSelect={() => {
                  select(i);
                  onOpenChange(false);
                  setQ("");
                }}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 data-[selected=true]:bg-surface-2"
              >
                <Avatar name={p.name[i]} img={p.img[i] || undefined} size={32} gold={!!(p.f[i] & FLAG.laureate)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate">{p.name[i]}</div>
                  <div className="text-xs text-muted">
                    {fmtLife(p.by[i], p.dy[i])}
                    {p.d[i] > 0 && ` · ${p.d[i].toLocaleString()} academic descendants`}
                  </div>
                </div>
                {!!(p.f[i] & FLAG.laureate) && <span className="text-xs text-gold">laureate</span>}
              </Command.Item>
            ))}
        </Command.List>
      </Command>
    </div>
  );
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}
