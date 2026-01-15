from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.settings import settings
from app.routes import guest, admin

app = FastAPI(title="ReduxTC UniFi Captive Portal API", version="0.1.0")

# CORS: allow frontend in dev; lock down in prod
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(guest.router, prefix="/api/guest", tags=["guest"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])

@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}

@app.get("/readyz")
def readyz() -> dict:
    # Add DB/Redis readiness checks in implementation phase
    return {"ready": True}
