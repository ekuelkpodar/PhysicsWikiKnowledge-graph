"""Polite, cached, single-concurrency Wikidata SPARQL client."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import time
from collections.abc import Iterable, Iterator
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = ROOT / "data/cache"
SPARQL_DIR = ROOT / "sparql"
ENDPOINT = "https://query.wikidata.org/sparql"
REPO_URL = os.environ.get("REPO_URL", "https://github.com/PhysicsWikiKnowledge-graph")
USER_AGENT = f"PhysicsFamilyTree/0.1 ({REPO_URL}; research/visualisation) python-requests"

_session = requests.Session()
_session.headers.update({"User-Agent": USER_AGENT, "Accept": "application/sparql-results+json"})
_last_request = 0.0
MIN_INTERVAL = 1.0  # seconds between live requests (we never run concurrently)


class SparqlError(RuntimeError):
    pass


USED_KEYS: set[str] = set()  # cache keys touched this run (for pruning stale entries)


def query_hash(query: str) -> str:
    return hashlib.sha256(" ".join(query.split()).encode()).hexdigest()[:24]


def load_template(name: str) -> str:
    return (SPARQL_DIR / name).read_text()


def run_query(query: str, *, max_retries: int = 8, offline: bool | None = None) -> list[dict]:
    """Run a SPARQL query and return simplified bindings ({var: value}).

    Responses are cached on disk keyed by a hash of the whitespace-normalised query, so
    re-runs resume for free. Set OFFLINE=1 to fail fast on cache misses.
    """
    global _last_request
    offline = offline if offline is not None else os.environ.get("OFFLINE") == "1"
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    USED_KEYS.add(query_hash(query))
    path = CACHE_DIR / f"{query_hash(query)}.json.gz"
    legacy = path.with_suffix("")  # uncompressed .json from older runs
    if path.exists():
        return json.loads(gzip.decompress(path.read_bytes()))
    if legacy.exists():
        return json.loads(legacy.read_text())
    if offline:
        raise SparqlError(f"cache miss in OFFLINE mode: {path.name}")

    delay = 2.0
    for attempt in range(max_retries):
        wait = MIN_INTERVAL - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        try:
            r = _session.post(ENDPOINT, data={"query": query, "format": "json"}, timeout=120)
        except requests.RequestException as exc:  # network blip
            status, retry_after, body = None, None, str(exc)
        else:
            status, retry_after, body = r.status_code, r.headers.get("Retry-After"), r.text[:300]
            if status == 200:
                rows = [
                    {k: v["value"] for k, v in b.items()} for b in r.json()["results"]["bindings"]
                ]
                tmp = path.with_suffix(".tmp")
                tmp.write_bytes(gzip.compress(json.dumps(rows).encode(), mtime=0))
                tmp.replace(path)
                return rows
            if status not in (429, 500, 502, 503, 504):
                raise SparqlError(f"HTTP {status}: {body}")
        sleep_for = float(retry_after) if retry_after and retry_after.isdigit() else delay
        print(f"  ! {status} attempt {attempt + 1}; sleeping {sleep_for:.0f}s ({body[:80]!r})")
        time.sleep(sleep_for)
        delay = min(delay * 2, 120)
    raise SparqlError(f"gave up after {max_retries} attempts")


def batched(items: Iterable[str], size: int) -> Iterator[list[str]]:
    batch: list[str] = []
    for it in items:
        batch.append(it)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def run_batched(template: str, qids: Iterable[str], size: int = 400, label: str = "") -> list[dict]:
    """Fill `{values}` in a template with wd:Q.. ids, batch, and concatenate results."""
    qids = sorted(set(qids), key=lambda q: int(q[1:]))
    out: list[dict] = []
    batches = list(batched(qids, size))
    for i, batch in enumerate(batches, 1):
        q = template.replace("{values}", " ".join(f"wd:{x}" for x in batch))
        h = query_hash(q)
        cached = (CACHE_DIR / f"{h}.json.gz").exists() or (CACHE_DIR / f"{h}.json").exists()
        rows = run_query(q)
        if not cached:
            print(f"  [{label}] batch {i}/{len(batches)}: {len(rows):,} rows")
        out.extend(rows)
    return out


def qid(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]
