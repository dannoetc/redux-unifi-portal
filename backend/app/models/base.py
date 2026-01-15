from __future__ import annotations

import uuid
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

def uuid_pk() -> str:
    return str(uuid.uuid4())
