from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Any

import httpx
from botocore.exceptions import BotoCoreError, ClientError

from app.config import settings


logger = logging.getLogger(__name__)


@dataclass
class EmailSendResult:
    provider: str
    status_code: int | None = None
    message_id: str | None = None
    detail: str | None = None

    def as_metadata(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "status_code": self.status_code,
            "message_id": self.message_id,
            "detail": self.detail,
        }


def _build_otp_content(code: str, expires_minutes: int) -> tuple[str, str, str]:
    subject = "Your OTP Code"
    text = (
        f"Your one-time password is: {code}\n"
        f"It expires in {expires_minutes} minutes.\n\n"
        "If you did not request this code, please ignore this email."
    )
    html = (
        "<html><body>"
        "<h2>Your One-Time Password</h2>"
        f"<p><strong>{code}</strong></p>"
        f"<p>This code expires in {expires_minutes} minutes.</p>"
        "<p>If you did not request this code, please ignore this email.</p>"
        "</body></html>"
    )
    return subject, text, html


def _build_password_reset_content(reset_link: str, expires_minutes: int) -> tuple[str, str, str]:
    subject = "Reset your password"
    text = (
        "We received a request to reset your password.\n"
        f"Reset link: {reset_link}\n"
        f"This link expires in {expires_minutes} minutes.\n\n"
        "If you did not request this, you can ignore this email."
    )
    html = (
        "<html><body>"
        "<h2>Reset your password</h2>"
        "<p>We received a request to reset your password.</p>"
        f"<p><a href=\"{reset_link}\">Click here to reset password</a></p>"
        f"<p>This link expires in {expires_minutes} minutes.</p>"
        "<p>If you did not request this, you can ignore this email.</p>"
        "</body></html>"
    )
    return subject, text, html


def _require_sender() -> str:
    sender = (settings.effective_email_sender or "").strip()
    if not sender:
        raise RuntimeError("EMAIL_OTP_SENDER or SES_FROM_EMAIL is required for auth email delivery.")
    return sender


def _send_via_console(*, recipient: str, subject: str) -> EmailSendResult:
    logger.info("Auth email (console) recipient=%s subject=%s", recipient, subject)
    return EmailSendResult(provider="console", detail="console_no_delivery")


def _send_via_sendgrid(*, recipient: str, subject: str, text: str, html: str) -> EmailSendResult:
    api_key = (settings.sendgrid_api_key or "").strip()
    if not api_key:
        raise RuntimeError("SENDGRID_API_KEY is missing.")
    sender = _require_sender()
    payload: dict[str, Any] = {
        "personalizations": [{"to": [{"email": recipient}]}],
        "from": {"email": sender},
        "subject": subject,
        "content": [
            {"type": "text/plain", "value": text},
            {"type": "text/html", "value": html},
        ],
    }
    with httpx.Client(timeout=max(5, int(settings.smtp_timeout_seconds or 20))) as client:
        response = client.post(
            "https://api.sendgrid.com/v3/mail/send",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
    if response.status_code >= 300:
        snippet = (response.text or "")[:240]
        raise RuntimeError(f"SendGrid send failed with HTTP {response.status_code}: {snippet}")
    return EmailSendResult(
        provider="sendgrid",
        status_code=int(response.status_code),
        message_id=response.headers.get("x-message-id"),
    )


def _send_via_aws_ses(*, recipient: str, subject: str, text: str, html: str) -> EmailSendResult:
    region = (settings.effective_aws_ses_region or "").strip()
    if not region:
        raise RuntimeError("AWS_SES_REGION/AWS_REGION is missing.")
    sender = _require_sender()

    import boto3  # Imported lazily to avoid hard dependency at module import time.

    client = boto3.client(
        "sesv2",
        region_name=region,
        aws_access_key_id=(settings.aws_access_key_id or None),
        aws_secret_access_key=(settings.aws_secret_access_key or None),
        aws_session_token=(settings.aws_session_token or None),
    )
    kwargs: dict[str, Any] = {
        "FromEmailAddress": sender,
        "Destination": {"ToAddresses": [recipient]},
        "Content": {
            "Simple": {
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Text": {"Data": text, "Charset": "UTF-8"},
                    "Html": {"Data": html, "Charset": "UTF-8"},
                },
            }
        },
    }
    config_set = (settings.aws_ses_configuration_set or "").strip()
    if config_set:
        kwargs["ConfigurationSetName"] = config_set
    try:
        response = client.send_email(**kwargs)
    except (ClientError, BotoCoreError) as exc:
        raise RuntimeError(f"AWS SES send failed: {exc}") from exc
    return EmailSendResult(
        provider="aws_ses",
        status_code=200,
        message_id=str(response.get("MessageId") or "") or None,
    )


def _send_via_smtp(*, recipient: str, subject: str, text: str, html: str) -> EmailSendResult:
    host = (settings.smtp_host or "").strip()
    if not host:
        raise RuntimeError("SMTP_HOST is missing.")
    port = int(settings.smtp_port or 587)
    use_tls = bool(settings.smtp_use_tls)
    use_ssl = bool(settings.smtp_use_ssl)
    username = (settings.smtp_username or "").strip() or None
    password = (settings.smtp_password or "").strip() or None
    sender = _require_sender()

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = sender
    message["To"] = recipient
    message.set_content(text)
    message.add_alternative(html, subtype="html")

    timeout = max(5, int(settings.smtp_timeout_seconds or 20))
    context = ssl.create_default_context()
    try:
        if use_ssl:
            with smtplib.SMTP_SSL(host=host, port=port, timeout=timeout, context=context) as server:
                if username and password:
                    server.login(username, password)
                refused = server.send_message(message)
        else:
            with smtplib.SMTP(host=host, port=port, timeout=timeout) as server:
                server.ehlo()
                if use_tls:
                    server.starttls(context=context)
                    server.ehlo()
                if username and password:
                    server.login(username, password)
                refused = server.send_message(message)
    except smtplib.SMTPException as exc:
        raise RuntimeError(f"SMTP send failed: {exc}") from exc

    if refused:
        raise RuntimeError(f"SMTP rejected recipients: {list(refused.keys())}")
    return EmailSendResult(provider="smtp", status_code=250)


def send_auth_email(*, recipient: str, subject: str, text: str, html: str) -> EmailSendResult:
    provider = (settings.email_provider or "console").strip().lower()
    if provider in {"console", "dev"}:
        if (settings.environment or "").strip().lower() == "production":
            raise RuntimeError("EMAIL_PROVIDER=console is not allowed in production. Configure SendGrid, AWS SES, or SMTP.")
        return _send_via_console(recipient=recipient, subject=subject)
    if provider == "sendgrid":
        return _send_via_sendgrid(recipient=recipient, subject=subject, text=text, html=html)
    if provider in {"aws_ses", "ses"}:
        return _send_via_aws_ses(recipient=recipient, subject=subject, text=text, html=html)
    if provider == "smtp":
        return _send_via_smtp(recipient=recipient, subject=subject, text=text, html=html)
    raise RuntimeError(f"Unsupported EMAIL_PROVIDER: {provider}")


def send_otp_email(*, recipient: str, code: str, expires_minutes: int) -> EmailSendResult:
    subject, text, html = _build_otp_content(code=code, expires_minutes=expires_minutes)
    return send_auth_email(recipient=recipient, subject=subject, text=text, html=html)


def send_password_reset_email(*, recipient: str, reset_link: str, expires_minutes: int) -> EmailSendResult:
    subject, text, html = _build_password_reset_content(reset_link=reset_link, expires_minutes=expires_minutes)
    return send_auth_email(recipient=recipient, subject=subject, text=text, html=html)
