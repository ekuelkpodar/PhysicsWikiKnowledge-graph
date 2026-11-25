"""Gzip legacy cache entries and prune entries not in MANIFEST.txt (written by fetch)."""

import gzip
from pathlib import Path

CACHE = Path(__file__).resolve().parents[1] / "data/cache"

if __name__ == "__main__":
    n = 0
    for p in CACHE.glob("*.json"):
        p.with_suffix(".json.gz").write_bytes(gzip.compress(p.read_bytes(), mtime=0))
        p.unlink()
        n += 1
    pruned = 0
    manifest = CACHE / "MANIFEST.txt"
    if manifest.exists():
        keep = set(manifest.read_text().split())
        for p in CACHE.glob("*.json.gz"):
            if p.name.removesuffix(".json.gz") not in keep:
                p.unlink()
                pruned += 1
    print(f"compressed {n}, pruned {pruned} stale cache files")
