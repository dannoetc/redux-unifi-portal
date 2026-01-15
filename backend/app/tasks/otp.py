from __future__ import annotations

import smtplib
from email.message import EmailMessage

from app.celery_app import celery_app
from app.settings import settings


@celery_app.task(name="send_otp_email")
def send_otp_email(to_email: str, code: str, branding: dict | None = None) -> None:
    subject_brand = branding.get("display_name") if branding else None
    subject = f"{subject_brand or 'WiFi'} verification code"
    body_lines = [
        "Your WiFi verification code:",
        code,
        "",
        "If you did not request this code, you can ignore this email.",
    ]
    if branding and branding.get("support_contact"):
        body_lines.append(f"Support: {branding['support_contact']}")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
    message["To"] = to_email
    message.set_content("\n".join(body_lines))

    with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as client:
        if settings.SMTP_USERNAME:
            client.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        client.send_message(message)
