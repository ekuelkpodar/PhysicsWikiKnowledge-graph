"""Run every model in dependency order and regenerate models/REPORT.md."""

import sys
import time

from models import (
    data_quality,
    fields,
    genealogy,
    institutions,
    link_prediction,
    migration,
    report,
    survival,
)

STEPS = [
    ("genealogy", genealogy.main),
    ("fields", fields.main),
    ("survival", survival.main),  # needs genealogy pagerank
    ("migration", migration.main),
    ("institutions", institutions.main),
    ("data_quality", data_quality.main),
    ("link_prediction", link_prediction.main),
    ("report", report.main),
]

if __name__ == "__main__":
    only = set(sys.argv[1:])
    for name, fn in STEPS:
        if only and name not in only:
            continue
        t = time.time()
        print(f"=== {name}")
        rc = fn()
        if rc:
            sys.exit(rc)
        print(f"=== {name} done in {time.time() - t:.0f}s")
