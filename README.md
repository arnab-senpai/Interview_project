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

You need **Python 3.10 or newer** (CI uses 3.12), **Node.js 20 or newer** with npm, and Git.

### 1. Clone
```bash
git clone https://github.com/arnab-senpai/Interview_project.git
cd Interview_project
```

### 2. Backend (FastAPI + SQLite)
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
Nothing is required for local development: without `SYSTEMCRAFT_JWT_SECRET` the backend creates `backend/.jwt_secret` on first start, and the default CORS list already covers the Vite dev server. To see the reviewer Feedback view, make your username an admin. Set it in the same terminal that runs the backend (the app does not read a `.env` file).

macOS / Linux:
```bash
export SYSTEMCRAFT_ADMIN_USERNAMES=yourname
```
Windows (PowerShell):
```powershell
$env:SYSTEMCRAFT_ADMIN_USERNAMES = "yourname"
```

### 4. Run the backend
```bash
python -m uvicorn backend.app.main:app --reload --port 8000
```
On first start it creates the SQLite database at `backend/systemcraft.db` (WAL mode, so you will also see `-wal` and `-shm` files). Delete those three files to start from an empty database. Check it is up at `http://127.0.0.1:8000/api/health`.

### 5. Run the frontend (second terminal)
```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```
Open `http://localhost:5173`. Vite proxies `/api/*` to FastAPI on port `8000`.

### 6. Create your account
The app opens on the sign-in screen. Choose the **Create Account** tab, and use the username you put in `SYSTEMCRAFT_ADMIN_USERNAMES` (3–32 characters, password at least 6). A **Feedback** item appears in the nav for admins.

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
| `SYSTEMCRAFT_DB_PATH` | Optional SQLite file location. The database runs in WAL mode with a 5 s busy timeout. |

Reviewers flag problems with the flag button on lesson steps, lenses, case study sections, flashcards and quizzes. Reports land in the `content_feedback` table with the content version they were made against.

## Verification Tests

With the virtual environment active:
```bash
python backend/scripts/validate_content.py
npm --prefix frontend run build   # one test checks that FastAPI serves frontend/dist
python -m pytest -v
```
