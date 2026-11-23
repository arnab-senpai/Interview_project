"""FastAPI entrypoint for SystemCraft Studio."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.app.core.config import FRONTEND_DIST_DIR, get_cors_origins
from backend.app.db.database import init_db
from backend.app.routers import admin, auth, curriculum, feedback, me, notes, placement, practice, review, session, topics
from backend.app.services.auth import check_jwt_secret_config
from backend.app.services.content_store import get_content
from backend.app.services.curriculum_loader import get_store
from backend.app.services.guest import purge_idle_guests


@asynccontextmanager
async def lifespan(_app: FastAPI):
    check_jwt_secret_config()
    init_db()
    purge_idle_guests()
    get_store()
    get_content()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="SystemCraft Studio API",
        version="1.0.0",
        description="Python-backed HLD/LLD/Coding Interview Prep Studio API",
        lifespan=lifespan,
    )

    cors_origins = get_cors_origins()
    if cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(auth.router)
    app.include_router(session.router)
    app.include_router(topics.router)
    app.include_router(me.router)
    app.include_router(review.router)
    app.include_router(placement.router)
    app.include_router(feedback.router)
    app.include_router(admin.router)
    app.include_router(notes.router)
    app.include_router(curriculum.public_router)
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
