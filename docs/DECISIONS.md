# Decisions log

Choices made while building, with the reasoning. Newest sections at the bottom.

## Phase 0: inputs

- **Missing starter files.** The brief assumed `data/raw/physicists.csv`, `src/clean.py`
  and `sparql/*.rq` already existed. Only the README was in the repo. The CSV was found
  at `~/Desktop/physicists.csv` and copied, not moved, into `data/raw/`. It matches the
  brief: 11,931 unique QIDs. `clean.py` and all SPARQL templates were written from scratch.
- **Row count.** pandas reads 12,256 data rows; the brief says 12,255. One row is an exact
  duplicate. The difference does not affect anything downstream, because we dedupe by QID.
- **"275 conflicting people".** This is the number of people with more than one raw row
  (`multi_statement`). 53 of those only restate the same year at different precision
  ("1 January 1900" vs "3 May 1900"). We flag the other **220** as `has_conflict`
  (different years, or two different day-precision dates). The UI shows both numbers.
- **Choosing among conflicting dates.** Keep the most precise value; break ties by the most
  frequent value, then the earliest. Wikidata ranks are not in the export. The full
  enrichment step pulls precision but does not override the CSV dates for seed people.
- **"1 January YYYY" = year precision.** We never treat it as a real date. `birth_date` is
  null and `birth_precision='year'`.
- **BCE.** Stored as negative years with no year 0 (287 BCE → −287). Lifespans that cross
  the era boundary are off by one, which is acceptable here.
- **Missing deaths.** A person with no death date who was born before 1910 is flagged
  `death_missing_suspect` with `vital_status='death_missing'`. We never treat them as
  alive or censored, and the survival model excludes them.

## Phase 1: enrichment

- **One query per property family, not per property.** `02_edges.rq` uses
  `VALUES ?prop {wdt:...}` for 11 unqualified properties. `03_award_dates.rq` handles the
  three qualified ones (P166/P108/P69) through `p:/ps:/pq:`. Deprecated-rank statements
  are excluded. Batches hold 400 QIDs (300 for the heavier qualified query), and every
  request is a POST, so URL length is not a problem.
- **Cache.** Each response is written to `data/cache/<sha256(normalised query)[:24]>.json.gz`.
  The cache is committed so that `make all` runs from a fresh clone without hitting
  Wikidata. `OFFLINE=1` makes a cache miss a hard error.
- **Politeness.** One request at a time, at least 1 s apart. Exponential backoff runs from
  2 s up to 120 s on 429/5xx, and `Retry-After` is honoured. The User-Agent names the
  project and repo URL. Set `REPO_URL` to the real GitHub URL before re-fetching.
- **Genealogy expansion.** Many advisors of "physicists" are mathematicians or chemists
  who are not in the seed. We follow P184/P185/P1066 for **2 hops** beyond the seed and
  fetch metadata, awards and employers for those people. They become `nodes_person`
  rows with `is_seed=false`. They count toward genealogy, but they are hidden by the
  "core physicists" filter and are excluded from seed-level statistics.
- **ADVISED symmetrization.** P184 on a student and P185 on an advisor merge into a single
  `advisor → student` edge. The edge keeps `via_p184`, `via_p185` and `both_directions`
  as provenance flags.
- **Cycle breaking.** Repeatedly find a cycle and drop its least plausible edge. The least
  plausible edge is the one where the student was born the most years before the advisor;
  ties go to the edge recorded in one direction only, then to lexical order. Removed
  edges are logged in `data/graph/advised_cycles_removed.json` and the quality report.
- **Major awards.** A curated label list in `pipeline/graph_utils.py::MAJOR_AWARDS`
  (Nobel ×3, Wolf, Dirac, Breakthrough, Fields, Abel, Planck Medal, Copley, Lorentz,
  Einstein, Franklin, Hughes, Matteucci, Buckley, Heineman, Sakurai, Fermi, Boltzmann,
  Crafoord, Rumford, Shaw-Astronomy, Kavli, Newton, RAS Gold, Bruce, Holweck,
  Comstock). We match labels rather than QIDs so the list is readable and auditable.
  "Laureate" in the app means a holder of at least one major award.
- **`is_core_physicist`.** True if any of these signals fires: the English description
  matches physicist/astronomer/cosmologist; a field of work matches a physics regex; an
  occupation other than plain "physicist" matches physicist/astronomer; an award label
  contains "physic" or is major; an employer or school name contains "physics"
  (or CERN/Fermilab/…). The individual `sig_*` columns are kept so the heuristic can be
  audited.
- **Birth country = P17 of the birthplace, using today's borders.** Wikidata gives the
  current country for most places, so Königsberg maps to Russia and Lemberg to Ukraine.
  This is a known, documented distortion in the migration view. Historical states are
  not reconstructed.
