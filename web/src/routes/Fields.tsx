import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChartFrame } from "../components/ChartFrame";
import { Sankey } from "../components/Sankey";
import { ErrorState, LoadingBlock, PageHeader } from "../components/ui";
import { useJSON } from "../lib/data";
import { filtersToParams } from "../lib/filters";
import { communityColor } from "../lib/palette";
import { useApp } from "../lib/store";

interface FNode {
  id: string;
  cohort: number;
  people: number;
  top_fields: string[];
  label: string;
  global_community: number;
}
export interface FieldsData {
  cohort_years: number;
  global_communities: { id: number; label: string; top_fields: string[]; people: number }[];
  alluvial: { nodes: FNode[]; links: { source: string; target: string; value: number; shared_fields: string[] }[] };
  n_people_with_fields: number;
}

export default function Fields() {
  const { theme, filters } = useApp();
  const nav = useNavigate();
  const res = useJSON<FieldsData>("fields.json");
  const dark = theme === "dark";
  const byId = useMemo(() => new Map((res.data?.alluvial.nodes ?? []).map((n) => [n.id, n])), [res.data]);
  const links = useMemo(() => {
    if (!res.data) return [];
    const minVal = 3;
    return res.data.alluvial.links
      .filter((l) => l.value >= minVal && byId.has(l.source) && byId.has(l.target))
      .filter((l) => byId.get(l.source)!.cohort <= filters.year)
      .map((l) => ({ ...l, meta: l.shared_fields }));
  }, [res.data, byId, filters.year]);

  if (res.error) return <ErrorState error={res.error} />;
  const label = (id: string) => {
    const n = byId.get(id);
    return n ? `${n.top_fields[0] ?? "?"}` : id;
  };
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <PageHeader kicker="Field evolution" title="How physics reorganised itself">
        People are grouped into {res.data?.cohort_years ?? 25}-year birth cohorts. Within each cohort, fields of work that the same person
        lists are linked, and Leiden community detection finds clusters of fields. Flows connect clusters in consecutive cohorts that share
        fields; flow width is the number of people behind those shared fields. Click a flow to see that community in the graph.
      </PageHeader>
      {!res.data ? (
        <LoadingBlock rows={10} />
      ) : (
        <div className="space-y-6">
          <ChartFrame
            title="Field communities across birth cohorts"
            rows={links.map((l) => ({
              from_cohort: byId.get(l.source)!.cohort,
              from: byId.get(l.source)!.label,
              to_cohort: byId.get(l.target)!.cohort,
              to: byId.get(l.target)!.label,
              people: l.value,
              shared_fields: l.shared_fields.join("; "),
            }))}
            filename="fields-alluvial"
            explain={
              <>
                Only {res.data.n_people_with_fields.toLocaleString()} people have a specific field of work on Wikidata (generic “physics” is
                excluded), so early cohorts are thin. Colour = the overall field community the cluster belongs to. Node labels show each
                cluster's most common field.
              </>
            }
          >
            <div className="overflow-x-auto" data-testid="alluvial">
              <div className="min-w-[860px]">
                <CohortAxis nodes={res.data.alluvial.nodes} />
                <Sankey
                  title="Alluvial chart of field communities by birth cohort"
                  links={links}
                  width={1100}
                  height={620}
                  columns={8}
                  nodeLabel={label}
                  colorOf={(id) => communityColor(byId.get(id)?.global_community ?? -1, dark)}
                  onLinkClick={(l) => {
                    const gc = byId.get(l.target)?.global_community ?? -1;
                    const p = filtersToParams({ ...filters, field: gc >= 0 ? gc : null });
                    nav({ pathname: "/graph", search: `?${p}` });
                  }}
                />
              </div>
            </div>
          </ChartFrame>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {res.data.global_communities.map((c) => (
              <div key={c.id} className="rounded-xl border border-line p-4">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full" style={{ background: communityColor(c.id, dark) }} />
                  <h3 className="font-display text-lg">{c.label}</h3>
                </div>
                <p className="mt-1 text-xs text-muted">{c.people.toLocaleString()} people</p>
                <p className="mt-2 text-sm">{c.top_fields.join(", ")}</p>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

function CohortAxis({ nodes }: { nodes: FNode[] }) {
  const cohorts = [...new Set(nodes.map((n) => n.cohort))].sort((a, b) => a - b);
  return (
    <div className="mb-1 flex justify-between px-[100px] text-xs text-muted" aria-hidden>
      {cohorts.map((c) => (
        <span key={c}>born {c}s</span>
      ))}
    </div>
  );
}
