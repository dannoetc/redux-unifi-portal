from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.settings import settings
from app.routes import guest, admin, oidc

app = FastAPI(title="ReduxTC UniFi Captive Portal API", version="0.1.0")

# Error envelope
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    if isinstance(exc.detail, dict):
        if exc.detail.get("ok") is False:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        if "code" in exc.detail and "message" in exc.detail:
            return JSONResponse(status_code=exc.status_code, content={"ok": False, "error": exc.detail})
    return JSONResponse(
        status_code=exc.status_code,
        content={"ok": False, "error": {"code": "HTTP_ERROR", "message": str(exc.detail)}},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={
            "ok": False,
            "error": {"code": "VALIDATION_ERROR", "message": "Validation failed.", "details": exc.errors()},
        },
    )

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
app.include_router(oidc.router, prefix="/api/oidc", tags=["oidc"])

@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}

@app.get("/readyz")
def readyz() -> dict:
    # Add DB/Redis readiness checks in implementation phase
    return {"ready": True}
