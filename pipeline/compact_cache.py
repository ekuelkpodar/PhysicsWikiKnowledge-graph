"""Gzip any legacy uncompressed cache entries in data/cache (idempotent)."""

import gzip
from pathlib import Path

CACHE = Path(__file__).resolve().parents[1] / "data/cache"

if __name__ == "__main__":
    n = 0
    for p in CACHE.glob("*.json"):
        p.with_suffix(".json.gz").write_bytes(gzip.compress(p.read_bytes(), mtime=0))
        p.unlink()
        n += 1
    print(f"compressed {n} cache files")
