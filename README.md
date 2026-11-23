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

You need **Python 3.10 or newer** (CI uses 3.12), **Node.js 20 or newer** with npm, and Git. Docker is only needed if you want to run against Postgres.

### 1. Clone
```bash
git clone https://github.com/arnab-senpai/Interview_project.git
cd Interview_project
```

### 2. Backend environment
macOS / Linux:
```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
```
Windows (PowerShell):
```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1   # if blocked: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
python -m pip install -r backend/requirements.txt
```

### 3. Local settings
Nothing is required for local development. Without `SYSTEMCRAFT_JWT_SECRET` the backend writes a dev secret to `backend/.jwt_secret` on first start, the default CORS list covers the Vite dev server, and without `SYSTEMCRAFT_DATABASE_URL` it uses SQLite. Set these in the terminal that runs the backend (the app does not read a `.env` file):

| | macOS / Linux | Windows (PowerShell) |
| --- | --- | --- |
| See the reviewer Feedback view | `export SYSTEMCRAFT_ADMIN_USERNAMES=yourname` | `$env:SYSTEMCRAFT_ADMIN_USERNAMES = "yourname"` |
| Offer "Continue as guest" (optional) | `export SYSTEMCRAFT_ALLOW_GUESTS=1` | `$env:SYSTEMCRAFT_ALLOW_GUESTS = "1"` |

Leave `SYSTEMCRAFT_ENV` unset locally; production mode also requires Postgres.

### 4. Run the backend
```bash
python -m uvicorn backend.app.main:app --reload --port 8000
```
On first start it creates the SQLite database at `backend/systemcraft.db` (WAL mode, so `-wal` and `-shm` files appear next to it). Stop the server and delete those three files to start from an empty database. Check it is up at `http://127.0.0.1:8000/api/health`.

To run against Postgres instead (what the alpha VM uses):
```bash
docker run -d --name systemcraft-pg -e POSTGRES_USER=systemcraft -e POSTGRES_PASSWORD=systemcraft -e POSTGRES_DB=systemcraft -p 5432:5432 postgres:16
export SYSTEMCRAFT_DATABASE_URL=postgresql://systemcraft:systemcraft@localhost:5432/systemcraft   # PowerShell: $env:SYSTEMCRAFT_DATABASE_URL = "..."
```
Alembic migrations run at startup (`backend/migrations`). To move an existing SQLite database across once: `python -m backend.scripts.copy_sqlite_to_postgres backend/systemcraft.db` (with `SYSTEMCRAFT_DATABASE_URL` set; it refuses to run if Postgres already holds learner data).

### 5. Run the frontend (second terminal, from the repo folder)
```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```
Open `http://localhost:5173`. Vite proxies `/api/*` to FastAPI on port `8000`.

### 6. Create your account
On the sign-in screen pick the **Create Account** tab and use the username you put in `SYSTEMCRAFT_ADMIN_USERNAMES` (3–32 characters, password at least 6). Admins get a **Feedback** item in the nav.

### Single-server mode (FastAPI serves the built frontend)
```bash
npm --prefix frontend run build
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```
Open `http://127.0.0.1:8000`.

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

Run these with the virtual environment active, in a terminal without `SYSTEMCRAFT_ALLOW_GUESTS` set (one test checks that guests are off by default):
```bash
python backend/scripts/validate_content.py
npm --prefix frontend run build                  # one test checks that FastAPI serves frontend/dist
python backend/scripts/build_content.py --out data/build
npm --prefix frontend run check:numbers
python -m pytest -v
```
Set `SYSTEMCRAFT_TEST_DATABASE_URL` to a throwaway Postgres database to run the same suite on Postgres (CI runs both).
