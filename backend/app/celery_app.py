from __future__ import annotations

from celery import Celery

from app.settings import settings


broker_url = settings.CELERY_BROKER_URL or settings.REDIS_URL
result_backend = settings.CELERY_RESULT_BACKEND or settings.REDIS_URL

celery_app = Celery("redux_unifi_portal", broker=broker_url, backend=result_backend)
celery_app.conf.task_always_eager = False
