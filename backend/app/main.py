"""FastAPI entrypoint for SystemCraft Studio."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app.core.config import FRONTEND_DIST_DIR
from backend.app.db.database import init_db
from backend.app.routers import auth, curriculum, notes, practice
from backend.app.services.curriculum_loader import get_store


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    get_store()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="SystemCraft Studio API",
        version="1.0.0",
        description="Python-backed HLD/LLD/Coding Interview Prep Studio API",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)
    app.include_router(notes.router)
    app.include_router(curriculum.router)
    app.include_router(practice.router)

    if FRONTEND_DIST_DIR.exists():
        assets_dir = FRONTEND_DIST_DIR / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        @app.get("/{full_path:path}", include_in_schema=False)
        def serve_spa(full_path: str):
            if full_path == "api" or full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="API endpoint not found")
            candidate = FRONTEND_DIST_DIR / full_path
            if full_path and candidate.exists() and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(FRONTEND_DIST_DIR / "index.html")

    return app


app = create_app()
