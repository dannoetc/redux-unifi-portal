from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()

@router.post("/login")
def login() -> dict:
    # TODO: Implement admin session auth
    return {"ok": True}
