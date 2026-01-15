from __future__ import annotations

from sqlalchemy import create_engine
from typing import Generator

from sqlalchemy.orm import Session, sessionmaker

from app.settings import settings

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, class_=Session, autoflush=False, autocommit=False)

def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
