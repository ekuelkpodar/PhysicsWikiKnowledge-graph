import { useEffect, useState } from "react";
import type { PersonDetail } from "./types";

export const DATA_BASE = `${import.meta.env.BASE_URL}data/`;
export const DETAIL_CHUNK = 500;

const cache = new Map<string, Promise<unknown>>();

export function loadJSON<T>(name: string): Promise<T> {
  let p = cache.get(name);
  if (!p) {
    p = fetch(DATA_BASE + name).then((r) => {
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(name));
    cache.set(name, p);
  }
  return p as Promise<T>;
}

export interface Resource<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
}

export function useJSON<T>(name: string | null): Resource<T> {
  const [state, setState] = useState<Resource<T>>({ data: null, error: null, loading: !!name });
  useEffect(() => {
    if (!name) return;
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    loadJSON<T>(name)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => {
      live = false;
    };
  }, [name]);
  return state;
}

export async function loadPersonDetail(qid: string, index: number): Promise<PersonDetail | null> {
  const chunk = Math.floor(index / DETAIL_CHUNK);
  const all = await loadJSON<Record<string, PersonDetail>>(`person/${chunk}.json`);
  return all[qid] ?? null;
}

export function usePersonDetail(qid: string | null, index: number | null): Resource<PersonDetail> {
  const [state, setState] = useState<Resource<PersonDetail>>({ data: null, error: null, loading: false });
  useEffect(() => {
    if (!qid || index === null || index < 0) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    let live = true;
    setState({ data: null, error: null, loading: true });
    loadPersonDetail(qid, index)
      .then((data) => live && setState({ data, error: null, loading: false }))
      .catch((error) => live && setState({ data: null, error, loading: false }));
    return () => {
      live = false;
    };
  }, [qid, index]);
  return state;
}
