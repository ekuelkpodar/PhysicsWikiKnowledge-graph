import { PageHeader } from "../components/ui";
import { REPO_URL } from "../components/Shell";
import { useJSON } from "../lib/data";
import { useApp } from "../lib/store";

interface ModelCard {
  name: string;
  what: string;
  method: string;
  metrics: string;
  limits: string;
}

export default function About() {
  const { core } = useApp();
  const cards = useJSON<ModelCard[]>("model_cards.json");
  const c = core?.meta.counts;
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <PageHeader kicker="About & methods" title="How this was made">
        The Physics Family Tree is built entirely from open data and open-source code. Everything you see is precomputed, so the site runs
        as plain static files.
      </PageHeader>
      <div className="prose-like space-y-8 text-[15px] leading-relaxed">
        <section>
          <h2 className="mb-2 font-display text-2xl">Data & licensing</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>Wikidata</b> (structured facts: people, advisors, awards, employers, places) is{" "}
              <a className="text-cyan underline" href="https://creativecommons.org/publicdomain/zero/1.0/">
                CC0
              </a>
              . Snapshot via the public SPARQL endpoint, cached in the repository.
            </li>
            <li>
              <b>Wikipedia</b> links and Wikimedia Commons images are{" "}
              <a className="text-cyan underline" href="https://creativecommons.org/licenses/by-sa/4.0/">
                CC BY-SA
              </a>{" "}
              (images under their individual licences); they are linked or hot-loaded, never redistributed.
            </li>
            <li>Country outlines: Natural Earth (public domain) via world-atlas.</li>
          </ul>
          {c && (
            <p className="mt-2 text-muted">
              {c.seed?.toLocaleString()} people tagged “physicist” with an English Wikipedia article, plus {c.expanded?.toLocaleString()}{" "}
              advisors and students reached through genealogy links; {c.advised?.toLocaleString()} advisor→student links.
            </p>
          )}
        </section>
        <section>
          <h2 className="mb-3 font-display text-2xl">Pipeline</h2>
          <Pipeline />
        </section>
        <section>
          <h2 className="mb-3 font-display text-2xl">Model cards</h2>
          <div className="space-y-3">
            {(cards.data ?? []).map((m) => (
              <details key={m.name} className="rounded-xl border border-line p-4">
                <summary className="cursor-pointer font-display text-lg">{m.name}</summary>
                <dl className="mt-2 grid grid-cols-[100px_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-muted">What</dt>
                  <dd>{m.what}</dd>
                  <dt className="text-muted">Method</dt>
                  <dd>{m.method}</dd>
                  <dt className="text-muted">Metrics</dt>
                  <dd>{m.metrics}</dd>
                  <dt className="text-muted">Limits</dt>
                  <dd>{m.limits}</dd>
                </dl>
              </details>
            ))}
          </div>
        </section>
        <section>
          <h2 className="mb-2 font-display text-2xl">Known limitations</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <b>Coverage bias.</b> Wikidata over-represents famous, Western, male scientists. Absence of an advisor link usually means “not
              recorded”, not “didn't exist”.
            </li>
            <li>
              <b>“Physicist” is a broad tag</b> covering politicians, engineers and ancient philosophers. Use the “core physicists” filter.
            </li>
            <li>
              <b>Today's borders.</b> Birth countries use the current country of the birthplace (Königsberg → Russia).
            </li>
            <li>
              <b>Imputed dates.</b> Many employment spells have no start year; we impute birth + 27 and mark these as hatched bars.
            </li>
            <li>
              <b>Associations, not causes.</b> The survival model shows who tends to be recognised sooner, not why.
            </li>
          </ul>
        </section>
        <p className="text-sm text-muted">
          Source code, data cache and decisions log:{" "}
          <a href={REPO_URL} className="text-cyan underline">
            GitHub repository
          </a>
          . Built {core?.meta.generated ?? ""}.
        </p>
      </div>
    </div>
  );
}

function Pipeline() {
  const steps = [
    ["Wikidata SPARQL", "batched, cached, 1 req at a time"],
    ["clean.py", "dedupe QIDs, date precision, flags"],
    ["build_graph", "Parquet + DuckDB, symmetrise advisors, break cycles"],
    ["validate", "orphans, cycles, impossible dates"],
    ["models/", "genealogy, links, survival, migration, centrality, fields, quality"],
    ["export_web", "chunked JSON + ForceAtlas2 layout"],
    ["this site", "React · Sigma · deck.gl · Plot"],
  ];
  return (
    <ol className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-stretch" aria-label="Pipeline steps">
      {steps.map(([t, d], k) => (
        <li key={t} className="flex items-center gap-2">
          <div className="rounded-lg border border-line bg-surface px-3 py-2">
            <div className="font-mono text-sm text-gold">{t}</div>
            <div className="text-xs text-muted">{d}</div>
          </div>
          {k < steps.length - 1 && (
            <span aria-hidden className="text-muted md:inline">
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
