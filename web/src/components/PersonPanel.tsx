import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef } from "react";
import { usePersonDetail } from "../lib/data";
import { fmtLife, fmtYear, PRECISION_LABEL, wikidataUrl } from "../lib/format";
import { advisorChain, ancestorTree, countTree, descendantTree } from "../lib/genealogy";
import { useApp } from "../lib/store";
import { FLAG, type PeopleData, type PersonDetail } from "../lib/types";
import { TidyTree } from "./TidyTree";
import { Avatar, Button, Chip, IconChevron, IconExternal, IconX, LoadingBlock } from "./ui";

export function PersonPanel() {
  const { core, selected, select } = useApp();
  const qid = core && selected !== null ? core.people.id[selected] : null;
  const detail = usePersonDetail(qid, selected);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (selected === null) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, select]);

  return (
    <AnimatePresence>
      {core && selected !== null && (
        <motion.aside
          key="panel"
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
          className="fixed top-0 right-0 bottom-0 z-40 flex w-full flex-col border-l border-line bg-surface shadow-2xl sm:w-[440px]"
          aria-label={`Details for ${core.people.name[selected]}`}
          role="complementary"
          data-testid="person-panel"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2">
            <span className="text-xs tracking-[0.18em] text-muted uppercase">Person</span>
            <Button ref={closeRef} onClick={() => select(null)} aria-label="Close person panel">
              <IconX />
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <PersonBody i={selected} people={core.people} detail={detail.data} loading={detail.loading} />
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function PersonBody({ i, people, detail, loading }: { i: number; people: PeopleData; detail: PersonDetail | null; loading: boolean }) {
  const { core, select } = useApp();
  const adj = core!.adj;
  const laureate = !!(people.f[i] & FLAG.laureate);
  const chain = useMemo(() => advisorChain(adj, i, (k) => people.d[k]), [adj, i, people.d]);
  const up = useMemo(() => ancestorTree(adj, i, 4, 60), [adj, i]);
  const down = useMemo(() => descendantTree(adj, i, 6, 400), [adj, i]);
  const nUp = countTree(up) - 1;
  const nDown = countTree(down) - 1;

  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <Avatar name={people.name[i]} img={people.img[i] || undefined} size={72} gold={laureate} />
        <div className="min-w-0">
          <h2 className="font-display text-2xl leading-tight">{people.name[i]}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted">
            <span className="tabular-nums">{fmtLife(people.by[i], people.dy[i])}</span>
            {people.bp[i] !== 2 && <Chip>{PRECISION_LABEL[people.bp[i]]}</Chip>}
            {!!(people.f[i] & FLAG.deathMissing) && <Chip tone="danger">death date missing</Chip>}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {laureate && <Chip tone="gold">laureate</Chip>}
            {!!(people.f[i] & FLAG.nobel) && <Chip tone="gold">Nobel</Chip>}
            {!(people.f[i] & FLAG.core) && <Chip>not core physics</Chip>}
            {!(people.f[i] & FLAG.seed) && <Chip>via genealogy</Chip>}
          </div>
        </div>
      </div>

      {loading && <LoadingBlock rows={2} label="Loading details" />}
      {detail?.desc && <p className="text-sm leading-relaxed">{detail.desc}</p>}
      <div className="flex flex-wrap gap-3 text-sm">
        {detail?.wiki && (
          <a className="inline-flex items-center gap-1 text-cyan hover:underline" href={detail.wiki} target="_blank" rel="noreferrer">
            Wikipedia <IconExternal className="h-3 w-3" />
          </a>
        )}
        <a
          className="inline-flex items-center gap-1 text-cyan hover:underline"
          href={wikidataUrl(people.id[i])}
          target="_blank"
          rel="noreferrer"
        >
          Wikidata {people.id[i]} <IconExternal className="h-3 w-3" />
        </a>
      </div>
      {detail && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {detail.place && (
            <>
              <dt className="text-muted">Born</dt>
              <dd>
                {detail.place}
                {detail.bcountry && `, ${detail.bcountry}`}
              </dd>
            </>
          )}
          {detail.fields.length > 0 && (
            <>
              <dt className="text-muted">Fields</dt>
              <dd>{detail.fields.slice(0, 6).join(", ")}</dd>
            </>
          )}
          {people.d[i] > 0 && (
            <>
              <dt className="text-muted">Descendants</dt>
              <dd>
                {people.d[i].toLocaleString()} academic descendants
                {people.dl[i] > 0 && <span className="text-gold">, {people.dl[i]} laureates</span>}
              </dd>
            </>
          )}
        </dl>
      )}

      {chain.length > 1 && (
        <Section title="Advisor chain" hint="Following the most prolific advisor at each step">
          <ol className="flex flex-wrap items-center gap-1 text-sm">
            {chain.map((k, n) => (
              <li key={k} className="flex items-center gap-1">
                {n > 0 && <IconChevron className="h-3 w-3 text-muted" />}
                {k === i ? (
                  <span className="font-medium">{people.name[k]}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => select(k)}
                    className={"rounded px-1 hover:bg-surface-2 " + (people.f[k] & FLAG.laureate ? "text-gold" : "text-cyan")}
                  >
                    {people.name[k]}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </Section>
      )}

      {(nUp > 0 || nDown > 0) && (
        <Section
          title="Family tree"
          hint={`${nUp} ancestors · ${nDown} descendants shown. Click a name to open it, Shift+click or Space to fold.`}
        >
          <div className="-mx-2 rounded-lg border border-line bg-bg/40 py-2">
            {nUp > 0 && (
              <TidyTree
                title="Ancestors"
                root={up}
                people={people}
                layout="up"
                onSelect={select}
                initialDepth={3}
                levelGap={44}
                width={380}
                showLabels={false}
              />
            )}
            {nDown > 0 && (
              <TidyTree
                title="Descendants"
                root={down}
                people={people}
                layout="down"
                onSelect={select}
                initialDepth={2}
                levelGap={44}
                width={380}
                showLabels={false}
              />
            )}
          </div>
        </Section>
      )}

      {detail && detail.awards.length > 0 && (
        <Section title="Awards">
          <Timeline by={people.by[i]} dy={people.dy[i]} awards={detail.awards} />
          <ul className="mt-2 space-y-1 text-sm">
            {detail.awards.map(([label, year, major], k) => (
              <li key={k} className="flex justify-between gap-3">
                <span className={major ? "text-gold" : ""}>{label}</span>
                <span className="text-muted tabular-nums">{year ?? "—"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {detail && detail.inst.length > 0 && (
        <Section title="Institutions over time" hint="Hatched bars have imputed dates">
          <Gantt by={people.by[i]} dy={people.dy[i]} inst={detail.inst} />
        </Section>
      )}

      {detail && detail.predicted.length > 0 && (
        <Section title="Predicted advisors" hint="Model suggestions, not facts. Verify before editing Wikidata.">
          <ul className="space-y-2">
            {detail.predicted.map((pr) => (
              <li key={pr.advisor} className="rounded-lg border border-dashed border-cyan/50 p-2 text-sm">
                <div className="flex items-center justify-between">
                  <button type="button" className="text-cyan hover:underline" onClick={() => select(pr.advisor)}>
                    {people.name[pr.advisor]}
                  </button>
                  <span className="text-xs text-muted tabular-nums">score {pr.score.toFixed(2)}</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {pr.inst.map((s) => (
                    <Chip key={s} tone="cyan">
                      {s}
                    </Chip>
                  ))}
                  {pr.fields.map((s) => (
                    <Chip key={s}>{s}</Chip>
                  ))}
                  {pr.gap !== null && <Chip>{pr.gap}y older</Chip>}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {detail && detail.quality.length > 0 && (
        <Section title="Data-quality warnings">
          <ul className="space-y-1 text-sm">
            {detail.quality.map((q) => (
              <li key={q} className="flex gap-2 text-danger">
                <span aria-hidden>⚠</span>
                {q}
              </li>
            ))}
          </ul>
          <a
            className="mt-2 inline-flex items-center gap-1 text-sm text-cyan hover:underline"
            href={wikidataUrl(people.id[i])}
            target="_blank"
            rel="noreferrer"
          >
            Review on Wikidata <IconExternal className="h-3 w-3" />
          </a>
        </Section>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-display text-lg">{title}</h3>
      {hint && <p className="mb-2 text-xs text-muted">{hint}</p>}
      {children}
    </section>
  );
}

function span(by: number | null, dy: number | null, items: (number | null)[]) {
  const ys = items.filter((x): x is number => x !== null);
  const lo = by ?? (ys.length ? Math.min(...ys) - 30 : 1900);
  const hi = Math.max(dy ?? Math.min(2025, (by ?? lo) + 85), ...ys, lo + 20);
  return [lo, hi] as const;
}

function Timeline({ by, dy, awards }: { by: number | null; dy: number | null; awards: PersonDetail["awards"] }) {
  const [lo, hi] = span(
    by,
    dy,
    awards.map((a) => a[1]),
  );
  const W = 380;
  const x = (y: number) => 8 + ((y - lo) / (hi - lo)) * (W - 16);
  return (
    <svg width="100%" viewBox={`0 0 ${W} 38`} role="img" aria-label="Award timeline">
      <line x1={8} x2={W - 8} y1={18} y2={18} stroke="var(--line)" strokeWidth={2} />
      <text x={8} y={34} fontSize={9} fill="var(--muted)">
        {fmtYear(lo)}
      </text>
      <text x={W - 8} y={34} fontSize={9} fill="var(--muted)" textAnchor="end">
        {fmtYear(hi)}
      </text>
      {awards
        .filter((a) => a[1] !== null)
        .map(([label, y, major], k) => (
          <circle key={k} cx={x(y!)} cy={18} r={major ? 5 : 3} fill={major ? "var(--gold)" : "var(--node)"} stroke="var(--bg)">
            <title>
              {label} ({y})
            </title>
          </circle>
        ))}
    </svg>
  );
}

function Gantt({ by, dy, inst }: { by: number | null; dy: number | null; inst: PersonDetail["inst"] }) {
  const rows = inst.slice(0, 12);
  const [lo, hi] = span(
    by,
    dy,
    rows.flatMap((r) => [r[1], r[2]]),
  );
  const W = 380;
  const RH = 18;
  const x = (y: number) => 110 + ((y - lo) / (hi - lo)) * (W - 118);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${rows.length * RH + 16}`} role="img" aria-label="Institutions timeline">
      <defs>
        <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="2" height="4" fill="var(--node)" />
        </pattern>
      </defs>
      {rows.map(([label, s, e, kind, inferred], k) => {
        const s0 = s ?? (by !== null ? by + (kind === "educated" ? 18 : 27) : lo);
        const e0 = e ?? Math.min(s0 + (kind === "educated" ? 6 : 10), hi);
        return (
          <g key={k} transform={`translate(0,${k * RH})`}>
            <text x={0} y={12} fontSize={10} fill="var(--text)">
              {label.length > 19 ? label.slice(0, 18) + "…" : label}
              <title>{`${label} (${kind}) ${s ?? "?"}–${e ?? "?"}`}</title>
            </text>
            <rect
              x={x(s0)}
              y={4}
              width={Math.max(3, x(e0) - x(s0))}
              height={10}
              rx={2}
              fill={inferred ? "url(#hatch)" : kind === "educated" ? "var(--cyan)" : "var(--gold-soft)"}
              opacity={0.85}
            />
          </g>
        );
      })}
      <text x={110} y={rows.length * RH + 12} fontSize={9} fill="var(--muted)">
        {fmtYear(lo)}
      </text>
      <text x={W - 8} y={rows.length * RH + 12} fontSize={9} fill="var(--muted)" textAnchor="end">
        {fmtYear(hi)}
      </text>
    </svg>
  );
}
