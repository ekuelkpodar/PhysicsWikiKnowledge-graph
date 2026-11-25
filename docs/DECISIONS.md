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
- **Genealogy expansion (asymmetric).** Seed people list 10,823 doctoral students (P185)
  who are not in the seed, mostly Mathematics Genealogy Project imports without an English
  article, plus 1,205 advisors outside the seed. **Hop 1** follows P184/P185/P1066 in both
  directions and fetches full data for those ~12k people, so non-seed students count as
  real descendants. **Hop 2** goes **up only** (P184/P1066): it extends lineages toward
  their roots but does not walk down into tens of thousands more students. Non-seed people
  are `nodes_person` rows with `is_seed=false`. They count in genealogy metrics but are
  excluded from seed-level statistics (survival, migration, quality).
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

## Web

- **Sigma v3, not v4.** npm now ships sigma 4, which replaces `nodeReducer`/`edgeReducer`
  with a new styles/primitives engine. We pinned the mature v3 API (3.0.x).
- **TypeScript 6.0**, because typescript-eslint does not support TS 7 yet.
- **HashRouter + relative base.** This works on GitHub Pages under any repo name with no
  404.html trick. Filters live in the hash query string, so every view is a shareable
  deep link.
- **Gzip.** GitHub Pages compresses JSON on the fly. We keep the JSON compact (columnar
  arrays, rounded floats) instead of shipping `.gz` files that Pages would not serve with
  the right `Content-Encoding`.
- **Concepts posing as people.** Genealogy links occasionally point at concepts. Q413 *physics* was recorded as someone's teacher. Any QID that is also the target of a field, award, employer or similar statement is dropped from `nodes_person` and logged in `data/graph/build_notes.json`.
- **Horizon edges dropped.** ADVISED edges are kept only when both ends were fetched. The 27,900 hop‑1→hop‑2 student links point to people we never fetched, and keeping them would inflate descendant counts with empty nodes.
- **Country normalisation.** Common historical states map to modern successors (`graph_utils.COUNTRY_ALIASES`): Soviet Union/Russian Empire → Russia, Kingdom of Prussia/German Reich → Germany, Austria‑Hungary → Austria, and so on. Multi‑successor states go to their core territory. This approximation matches the today's‑borders policy above.
- **Award labels audited.** The major‑award list is matched against the labels that actually exist (for example "ICTP Dirac Medal", "Sakurai Prize", "The Shaw Prize in Astronomy"). An eval question caught the original mismatch. `is_nobel` covers the three science Nobels only.

## Models

- **Genealogy yield.** Laureate yield = laureate descendants / descendants, shrunk toward the base rate with prior weight k=50. Founders need ≥20 descendants. This stops a 3‑person tree with one laureate from ranking first.
- **Link prediction.** Negatives are 1 random plus 1 hard per positive (the hard one shares an institution). P1066 "student of" is excluded from training so it can serve as an independent check. node2vec uses p=q=1 (DeepWalk walks) and single‑threaded Word2Vec for determinism. GraphSAGE is reported but loses; its numbers vary a little between runs (torch nondeterminism). LR probabilities saturate for prolific advisors, so the UI shows each prediction's rank instead of a "100%" score.
- **Survival.** The clock starts at birth+27 (PhD proxy). An award before that is set to t=0.5, and an award after death or the horizon is not an event. Population: seed core physicists born 1850–1985. `has_recorded_advisor` is a control, because simply having an advisor on Wikidata is a fame marker. The PH test flags `laureate_advisor` and two cohorts; the UI says to read their HRs as time‑averaged.
- **Migration.** Moves are dated by employment start; 71% are imputed as birth+27. Shock detection needs ≥60 people per origin and ≥15 per decade, because smaller samples produced spurious spikes.

## API / eval

- **Kùzu** (embedded) rather than Neo4j: no server, and it opens read‑only.
- **Schema prompt label hints.** The prompt lists a few non‑obvious Wikidata labels ("Joseph John Thomson", "Fields medal"). A production system would add an entity‑resolution step instead.
- **Eval status.** 30 questions with DuckDB ground truth and gold Cypher. The oracle run scores 30/30, which validates the load and the harness. The LLM run (`make api-eval`) needs `ANTHROPIC_API_KEY` and **has not been run**: there were no credentials in the build environment.

## Media

- Homebrew's ffmpeg on the build machine couldn't load (missing libx265), so `record-media.mjs` accepts `FFMPEG=`. The static binary from `imageio-ffmpeg` was used.
