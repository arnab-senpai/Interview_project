# SystemCraft Studio — End-to-End Interview Prep Platform

An interactive, blueprint-styled engineering learning studio for **High-Level Design (HLD)**, **Low-Level Design (LLD)**, and **Coding Rounds** — built on a **Python (FastAPI + Pydantic v2 + SQLite)** backend and a **React + TypeScript** isometric blueprint frontend inspired by *Protocol Explorer* and the pedagogical style of *Designing Data-Intensive Applications (DDIA)* & *The Pragmatic Programmer*.

## Project Structure

```text
.
├── backend/
│   ├── requirements.txt            # FastAPI, Uvicorn, Pydantic v2, Pytest
│   ├── app/
│   │   ├── main.py                 # FastAPI app + SPA static serving + SQLite lifespan
│   │   ├── core/config.py          # Paths & DB configuration
│   │   ├── db/database.py          # SQLite persistence (progress, SM-2, quizzes, estimates, rubrics)
│   │   ├── schemas/hld.py          # Strict Pydantic v2 models
│   │   ├── services/               # Curriculum loader/search, SM-2 scheduler, Capacity Estimator
│   │   └── routers/                # /api/hld/*, /api/progress/*, /api/flashcards, /api/quizzes, /api/estimator/*
│   └── scripts/
│       └── validate_content.py     # Zero-dependency validator for all JSON datasets
├── frontend/
│   ├── package.json                # React 18, TypeScript, Vite, Lucide Icons
│   └── src/
│       ├── types/hld.ts            # Matching TypeScript interfaces
│       ├── api/client.ts           # Typed FastAPI client
│       └── components/             # IsometricCanvas, ExplorerWorkspace, CaseStudiesView, CapacityLabView, PracticeAndDdiaView, SearchModal
├── data/
│   ├── curriculum_tracks.json      # Track 1 (HLD active), Track 2 (LLD), Track 3 (Coding Rounds)
│   └── hld/
│       ├── curriculum_index.json             # 7 Layers · 32 Lessons (10 ready) · 30 Case Studies (5 ready)
│       ├── ddia_and_pragmatic_foundations.json # 12 DDIA chapters + 6 Pragmatic Programmer principles
│       ├── reference_numbers_and_rubric.json # 45-min framework, L3–L7 rubric, latency numbers, GenAI metrics
│       ├── patterns.json                     # 12 reusable HLD pattern playbooks
│       ├── flashcards_and_quizzes.json       # 25 SM-2 flashcards & 25 scenario quizzes
│       ├── lessons/                          # 10 interactive Explorer lessons (story + 3 lenses + isometric flow + chaos)
│       └── case_studies/                     # 5 tiered end-to-end case studies
└── tests/
    ├── test_hld_datasets.py        # Dataset & cross-reference integrity tests
    └── test_api.py                 # FastAPI routes, Pydantic models & SQLite persistence tests
```

## Running Locally

### 1. Backend API (FastAPI + SQLite)
```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

### 2. Frontend Dev Server (React + Vite + TypeScript)
```powershell
npm --prefix frontend install
npm --prefix frontend run dev
```
Open `http://localhost:5173` (Vite proxies `/api/*` directly to FastAPI on port `8000`).

### 3. Single-Server Production Mode (FastAPI serves built Vite bundle)
```powershell
npm --prefix frontend run build
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

## Verification Tests

```powershell
python backend/scripts/validate_content.py
.\.venv\Scripts\python.exe -m pytest -v
```
