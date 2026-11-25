"""FastAPI service for "Ask the graph". Run: uvicorn api.app:app --port 8000"""

from __future__ import annotations

import os
from dataclasses import asdict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from api.text2cypher import GraphQA

app = FastAPI(title="Physics Family Tree: Ask the graph")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)
_qa: GraphQA | None = None


def qa() -> GraphQA:
    global _qa
    if _qa is None:
        _qa = GraphQA()
    return _qa


class Ask(BaseModel):
    question: str = Field(min_length=3, max_length=500)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/ask")
def ask(body: Ask):
    res = qa().ask(body.question)
    if res.error:
        raise HTTPException(status_code=422, detail=res.error)
    return asdict(res)
