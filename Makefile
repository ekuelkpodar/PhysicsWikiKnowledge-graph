PY ?= .venv/bin/python
export PYTHONPATH := $(CURDIR)

.PHONY: all setup data clean-data models api-eval web test lint fmt compact-cache

all: data models web

setup:
	uv venv -p 3.11 .venv && uv pip install -p .venv -r requirements.txt
	cd web && npm ci

data/processed/physicists_clean.csv: data/raw/physicists.csv src/clean.py
	$(PY) -m src.clean

data: data/processed/physicists_clean.csv
	$(PY) -m pipeline.fetch
	$(PY) -m pipeline.build_graph
	$(PY) -m pipeline.validate

models:
	$(PY) -m models.run_all

api-eval:
	$(PY) -m api.eval

web:
	$(PY) -m models.export_web
	cd web && npm run build

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
