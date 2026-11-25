/// <reference lib="webworker" />
import { computeVisible, type Filters } from "../lib/filters";
import type { PeopleData } from "../lib/types";

let people: PeopleData | null = null;

self.onmessage = (e: MessageEvent<{ type: "init"; people: PeopleData } | { type: "filter"; id: number; filters: Filters }>) => {
  const msg = e.data;
  if (msg.type === "init") {
    people = msg.people;
    return;
  }
  if (!people) return;
  const mask = computeVisible(people, msg.filters);
  (self as unknown as Worker).postMessage({ id: msg.id, mask }, [mask.buffer]);
};
