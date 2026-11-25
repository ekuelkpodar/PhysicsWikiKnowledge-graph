PY ?= .venv/bin/python
export PYTHONPATH := $(CURDIR)

.PHONY: all setup data models web web-data api kuzu api-eval api-eval-oracle test e2e lint fmt media compact-cache

all: data models web

setup:
	uv venv -p 3.11 .venv && uv pip install -p .venv -r requirements.txt
	-uv pip install -p .venv -r requirements-ml.txt   # optional: GraphSAGE comparison
	cd web && npm ci

data/processed/physicists_clean.csv: data/raw/physicists.csv src/clean.py
	$(PY) -m src.clean

data: data/processed/physicists_clean.csv
	$(PY) -m pipeline.fetch
	$(PY) -m pipeline.build_graph
	$(PY) -m pipeline.validate

models:
	$(PY) -m models.run_all

kuzu:
	$(PY) -m api.build_kuzu

api: kuzu
	$(PY) -m uvicorn api.app:app --port 8000

api-eval-oracle: kuzu
	$(PY) -m api.eval --oracle

api-eval: kuzu   # needs ANTHROPIC_API_KEY (MODEL optional)
	$(PY) -m api.eval
	$(PY) -m models.report

web-data:
	$(PY) -m models.export_web
	cd web && npm run layout

web: web-data
	cd web && npm run build

e2e:
	cd web && npm run test:e2e

media:
	cd web && (npm run preview >/dev/null 2>&1 & echo $$! > .preview.pid; sleep 3; npm run media; kill `cat .preview.pid`; rm .preview.pid)

test:
	$(PY) -m pytest -q tests
	cd web && npm test --silent

lint:
	$(PY) -m ruff check src pipeline models api tests
	$(PY) -m black --check src pipeline models api tests
	cd web && npm run lint

fmt:
	$(PY) -m ruff check --fix src pipeline models api tests
	$(PY) -m black src pipeline models api tests

compact-cache:
	$(PY) -m pipeline.compact_cache
