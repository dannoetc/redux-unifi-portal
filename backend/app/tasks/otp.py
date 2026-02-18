from __future__ import annotations

import smtplib
from email.message import EmailMessage

from app.celery_app import celery_app
from app.services.system_settings import get_effective_smtp_settings_runtime


@celery_app.task(name="send_otp_email")
def send_otp_email(to_email: str, code: str, branding: dict | None = None) -> None:
    smtp_config = get_effective_smtp_settings_runtime()
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
    message["From"] = f"{smtp_config['from_name']} <{smtp_config['from_email']}>"
    message["To"] = to_email
    message.set_content("\n".join(body_lines))

    with smtplib.SMTP(smtp_config["host"], smtp_config["port"]) as client:
        if smtp_config["username"]:
            client.login(smtp_config["username"], smtp_config["password"])
        client.send_message(message)
