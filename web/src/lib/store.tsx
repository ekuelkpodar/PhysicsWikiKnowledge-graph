import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { loadJSON } from "./data";
import { computeVisible, filtersToParams, paramsToFilters, type Filters } from "./filters";
import { buildAdjacency, type Adjacency } from "./genealogy";
import type { EdgesData, LayoutData, Meta, PeopleData } from "./types";

export interface Core {
  people: PeopleData;
  layout: LayoutData;
  edges: EdgesData;
  meta: Meta;
  adj: Adjacency;
  index: Map<string, number>;
  geo: { lat: (number | null)[]; lon: (number | null)[] };
}

interface AppState {
  core: Core | null;
  error: Error | null;
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  visible: Uint8Array | null;
  selected: number | null;
  select: (i: number | null) => void;
  theme: "dark" | "light";
  toggleTheme: () => void;
  apiUp: boolean;
  imgVersion: number;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside provider");
  return v;
}

export function useCore(): Core | null {
  return useApp().core;
}

export const API_URL: string | null = (import.meta.env.VITE_ASK_API as string | undefined) ?? null;

export function AppProvider({ children }: { children: ReactNode }) {
  const [core, setCore] = useState<Core | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => paramsToFilters(params), [params]);
  const [visible, setVisible] = useState<Uint8Array | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(() => (document.documentElement.classList.contains("dark") ? "dark" : "light"));
  const [apiUp, setApiUp] = useState(false);
  const [imgVersion, setImgVersion] = useState(0);
  const worker = useRef<Worker | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    Promise.all([
      loadJSON<PeopleData>("people.json"),
      loadJSON<LayoutData>("layout.json"),
      loadJSON<EdgesData>("edges.json"),
      loadJSON<Meta>("meta.json"),
      loadJSON<Core["geo"]>("geo.json"),
    ])
      .then(([people, layout, edges, meta, geo]) => {
        const index = new Map(people.id.map((q, i) => [q, i]));
        setCore({ people, layout, edges, meta, geo, adj: buildAdjacency(people.n, edges.advised), index });
        // thumbnails are not needed for first paint; merge them in afterwards
        loadJSON<{ img: string[] }>("images.json")
          .then(({ img }) => {
            // fill in place so graph memos keyed on `core` don't rebuild; bump a version to re-render avatars
            people.img.splice(0, people.img.length, ...img);
            setImgVersion((v) => v + 1);
          })
          .catch(() => undefined);
      })
      .catch(setError);
  }, []);

  // Ask-the-graph API health check: the app is fully static without it.
  useEffect(() => {
    if (!API_URL) return;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    fetch(`${API_URL.replace(/\/$/, "")}/health`, { signal: ctl.signal })
      .then((r) => setApiUp(r.ok))
      .catch(() => setApiUp(false))
      .finally(() => clearTimeout(t));
  }, []);

  // Filtering runs in a worker; falls back to the main thread if workers are unavailable.
  useEffect(() => {
    if (!core) return;
    try {
      const w = new Worker(new URL("../workers/filter.worker.ts", import.meta.url), { type: "module" });
      w.postMessage({ type: "init", people: core.people });
      w.onmessage = (e: MessageEvent<{ id: number; mask: Uint8Array }>) => {
        if (e.data.id === reqId.current) setVisible(e.data.mask);
      };
      worker.current = w;
      return () => w.terminate();
    } catch {
      worker.current = null;
    }
  }, [core]);

  useEffect(() => {
    if (!core) return;
    const id = ++reqId.current;
    if (worker.current) worker.current.postMessage({ type: "filter", id, filters });
    else setVisible(computeVisible(core.people, filters));
  }, [core, filters]);

  const setFilters = useCallback(
    (patch: Partial<Filters>) => {
      setParams((prev) => filtersToParams({ ...paramsToFilters(prev), ...patch }, prev), { replace: true });
    },
    [setParams],
  );

  const selected = useMemo(() => {
    const q = params.get("p");
    return q && core ? (core.index.get(q) ?? null) : null;
  }, [params, core]);

  const select = useCallback(
    (i: number | null) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (i === null || !core) p.delete("p");
          else p.set("p", core.people.id[i]);
          return p;
        },
        { replace: false },
      );
    },
    [setParams, core],
  );

  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem("theme", next);
      } catch {
        /* private mode */
      }
      return next;
    });
  }, []);

  const value: AppState = {
    core,
    error,
    filters,
    setFilters,
    visible,
    selected,
    select,
    theme,
    toggleTheme,
    apiUp,
    imgVersion,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
