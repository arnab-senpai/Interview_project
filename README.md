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
│       ├── practice/<topicId>.json           # Flashcards & graded quizzes, one file per topic
│       ├── lessons/                          # 10 interactive Explorer lessons (story + 3 lenses + isometric flow + chaos)
│       └── case_studies/                     # 5 tiered end-to-end case studies
└── tests/
    ├── test_hld_datasets.py        # Dataset & cross-reference integrity tests
    └── test_api.py                 # FastAPI routes, Pydantic models & SQLite persistence tests
```

## Running Locally

### 1. Backend API (FastAPI; Postgres or SQLite)
```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```
Without `SYSTEMCRAFT_DATABASE_URL` the API uses a local SQLite file, which is fine for development. To run against Postgres (what the alpha VM uses):
```powershell
docker run -d --name systemcraft-pg -e POSTGRES_USER=systemcraft -e POSTGRES_PASSWORD=systemcraft -e POSTGRES_DB=systemcraft -p 5432:5432 postgres:16
$env:SYSTEMCRAFT_DATABASE_URL = "postgresql://systemcraft:systemcraft@localhost:5432/systemcraft"
```
Alembic migrations run at startup (`backend/migrations`). To move an existing SQLite database across once: `python -m backend.scripts.copy_sqlite_to_postgres backend/systemcraft.db` (with `SYSTEMCRAFT_DATABASE_URL` set; it refuses to run if Postgres already holds learner data).

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

## Alpha Deployment (internal VM)

Every content and progress route requires sign-in; a missing or invalid token returns `401`. FastAPI serves the built frontend from the same origin, so no CORS is needed in production.

| Variable | Purpose |
| --- | --- |
| `SYSTEMCRAFT_ENV=production` | Turns on production checks: startup fails unless `SYSTEMCRAFT_JWT_SECRET` is set and at least 32 characters. |
| `SYSTEMCRAFT_JWT_SECRET` | Secret used to sign access tokens. Generate with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. |
| `SYSTEMCRAFT_CORS_ORIGINS` | Comma-separated allowed origins. Unset means the local dev origins; set it to an empty string for same-origin serving. |
| `SYSTEMCRAFT_ADMIN_USERNAMES` | Comma-separated usernames that can open the reviewer feedback view. |
| `SYSTEMCRAFT_ISSUES_URL` | Optional, e.g. `https://github.com/<owner>/<repo>/issues/new`. Adds a prefilled "GitHub issue" link to each report. |
| `SYSTEMCRAFT_DATABASE_URL` | Postgres URL, e.g. `postgresql://user:pass@host:5432/systemcraft`. Required when `SYSTEMCRAFT_ENV=production`. |
| `SYSTEMCRAFT_DB_PATH` | Optional SQLite file location for local development. The database runs in WAL mode with a 5 s busy timeout. |
| `SYSTEMCRAFT_ALLOW_GUESTS=1` | Offers "Continue as guest" on the sign-in screen. Off by default. A guest gets a signed HttpOnly cookie (10 new guests per IP per hour), is purged after 30 idle days, and their progress moves into the account they register or sign in to. |

Reviewers flag problems with the flag button on lesson steps, lenses, case study sections, flashcards and quizzes. Reports land in the `content_feedback` table with the content version they were made against.

## Writing chapters (content model v2)

Chapters live in `content/<track>/<topic>/topic.yaml`, with longer text in Markdown files next to it. A topic declares its numbers (inputs, formulas, presets), the parts and arrows its figures use, and its layers of blocks (prose, structuredTable, figure, trace, quiz, predict, spotTheBug, estimationWorksheet, designPrompt, ladder, rememberCard). The study path is `content/paths/start-here.yaml`.

```powershell
python backend/scripts/build_content.py --out data/build      # compile, validate and lint
python backend/scripts/build_content.py --update-lock         # after a deliberate change to a check
npm --prefix frontend run check:numbers                        # browser and server compute the same numbers
```

Answer keys stay on the server; checks are graded by `POST /api/attempts`. `content/grading.lock.json` stores a hash per checkable block, and CI fails if a check's question or answer changes without a `gradingVersion` bump. A learner who passed an older version sees "re-check suggested" and keeps their pass.

## Verification Tests

```powershell
python backend/scripts/validate_content.py
.\.venv\Scripts\python.exe -m pytest -v
```
Set `SYSTEMCRAFT_TEST_DATABASE_URL` to a throwaway Postgres database to run the same suite on Postgres (CI runs both).
