import { useMemo, useState } from "react";
import { Button, Chip, EmptyState, ErrorState, IconExternal, LoadingBlock, PageHeader, Stat } from "../components/ui";
import { useJSON } from "../lib/data";
import { downloadCSV } from "../lib/export";
import { fmtYear } from "../lib/format";
import { useApp } from "../lib/store";

interface Item {
  qid: string;
  name: string;
  description: string | null;
  birth_year: number | null;
  death_year: number | null;
  score: number;
  rule_score: number;
  if_score: number;
  rules: string[];
  reasons: string[];
  url: string;
}
export interface QualityData {
  summary: Record<string, number> & { rule_counts: Record<string, number> };
  rules: Record<string, { weight: number; text: string }>;
  items: Item[];
}

export default function Quality() {
  const { core, select } = useApp();
  const res = useJSON<QualityData>("quality.json");
  const [rule, setRule] = useState<string | null>(null);
  const [onlyRules, setOnlyRules] = useState(false);
  const [limit, setLimit] = useState(60);
  const items = useMemo(
    () => (res.data?.items ?? []).filter((it) => (!rule || it.rules.includes(rule)) && (!onlyRules || it.rule_score > 0)),
    [res.data, rule, onlyRules],
  );
  if (res.error) return <ErrorState error={res.error} />;
  if (!res.data)
    return (
      <div className="p-8">
        <LoadingBlock rows={10} />
      </div>
    );
  const s = res.data.summary;
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <PageHeader kicker="Data quality" title="What Wikidata gets wrong (and what we did about it)">
        Every number on this site inherits Wikidata's gaps. Here they are, counted. The ranked list below combines explicit rules (e.g. a
        student born before their advisor) with an isolation forest that flags records that look unlike the rest. Each item links straight
        to Wikidata so it can be fixed at the source.
      </PageHeader>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Conflicting dates"
          value={s.conflicts.toLocaleString()}
          hint={`${s.multi_statement} people have several statements; ${s.conflicts} genuinely disagree`}
        />
        <Stat
          label="Year-only births"
          value={s.year_only_births.toLocaleString()}
          hint="Stored as “1 January YYYY”; never treated as a real date"
        />
        <Stat label="Implausible lifespans" value={s.implausible_lifespans.toLocaleString()} hint="Death before birth or older than 110" />
        <Stat
          label="Missing deaths, born < 1910"
          value={s.death_missing_pre1910.toLocaleString()}
          hint={`Of ${s.missing_deaths.toLocaleString()} without a death date; treated as missing, not alive`}
        />
        <Stat
          label="Not core physicists"
          value={s.not_core_physicists.toLocaleString()}
          hint="Tagged 'physicist' but with no physics field, award or employer"
        />
        <Stat label="BCE births" value={s.bce_births} hint="Stored as negative years" />
        <Stat label="Missing birth year" value={s.missing_births.toLocaleString()} />
        <Stat label="Flagged by a rule" value={s.flagged_by_any_rule.toLocaleString()} tone="gold" />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Button variant={rule === null ? "solid" : "outline"} onClick={() => setRule(null)} className="text-xs">
          All
        </Button>
        {Object.entries(res.data.rules)
          .filter(([k]) => s.rule_counts[k] > 0)
          .map(([k, r]) => (
            <Button
              key={k}
              variant={rule === k ? "solid" : "outline"}
              onClick={() => setRule(rule === k ? null : k)}
              aria-pressed={rule === k}
              className="text-xs"
            >
              {r.text} · {s.rule_counts[k]}
            </Button>
          ))}
        <label className="ml-2 flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={onlyRules} onChange={(e) => setOnlyRules(e.target.checked)} className="accent-[var(--gold)]" />{" "}
          Rule hits only (hide pure outliers)
        </label>
        <Button
          variant="outline"
          className="ml-auto"
          onClick={() =>
            downloadCSV(
              "wikidata-anomalies.csv",
              items.map((it) => ({ ...it, reasons: it.reasons.join("; "), rules: it.rules.join("; ") })),
              ["qid", "name", "birth_year", "death_year", "score", "rule_score", "if_score", "reasons", "url"],
            )
          }
        >
          Export CSV
        </Button>
      </div>
      {items.length === 0 ? (
        <EmptyState title="Nothing flagged under this filter" action={<Button onClick={() => setRule(null)}>Clear filter</Button>} />
      ) : (
        <ol className="divide-y divide-line rounded-xl border border-line" data-testid="anomalies">
          {items.slice(0, limit).map((it, n) => (
            <li key={it.qid} className="flex flex-wrap items-start gap-3 px-4 py-3">
              <span className="w-7 pt-0.5 text-right text-xs text-muted tabular-nums">{n + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  {core?.index.has(it.qid) ? (
                    <button type="button" className="font-medium hover:underline" onClick={() => select(core.index.get(it.qid)!)}>
                      {it.name}
                    </button>
                  ) : (
                    <span className="font-medium">{it.name}</span>
                  )}
                  <span className="text-xs text-muted">
                    {fmtYear(it.birth_year)}–{it.death_year !== null ? fmtYear(it.death_year) : "?"}
                  </span>
                  {it.description && <span className="truncate text-xs text-muted">{it.description}</span>}
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {it.reasons.map((r) => (
                    <Chip key={r} tone="danger">
                      {r}
                    </Chip>
                  ))}
                  {it.if_score > 0.6 && <Chip>unusual record (outlier score {it.if_score.toFixed(2)})</Chip>}
                </div>
              </div>
              <a
                href={it.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-cyan hover:underline"
              >
                {it.qid} <IconExternal className="h-3 w-3" />
              </a>
            </li>
          ))}
        </ol>
      )}
      {items.length > limit && (
        <div className="mt-4 text-center">
          <Button variant="outline" onClick={() => setLimit((l) => l + 100)}>
            Show more ({(items.length - limit).toLocaleString()} left)
          </Button>
        </div>
      )}
    </div>
  );
}
