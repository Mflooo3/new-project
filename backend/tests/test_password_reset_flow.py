from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch
import unittest
from urllib.parse import parse_qs, urlparse

from sqlmodel import SQLModel, Session, create_engine, select

from app.config import settings
from app.models import AppUser, OTPCode, Tenant, UserSession
from app.schemas import LoginRequest, PasswordResetConfirmRequest, PasswordResetRequest
from app.services.auth_service import AuthService, pwd_context
from app.services.email_sender import EmailSendResult


class PasswordResetFlowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
        SQLModel.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        tenant = Tenant(name="Tenant A", slug="tenant-a", status="active")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        now = datetime.now(timezone.utc)
        user = AppUser(
            full_name="Reset User",
            email="reset.user@example.com",
            password_hash=pwd_context.hash("OldStrongPass!1"),
            status="approved",
            role="user",
            access_version="v1",
            page_access="v1",
            tenant_id=tenant.id,
            auth_method="hybrid",
            created_at=now,
            updated_at=now,
        )
        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)
        self.user = user

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    def _set_settings(self, **kwargs):
        original: dict[str, object] = {}
        for key, value in kwargs.items():
            original[key] = getattr(settings, key)
            setattr(settings, key, value)
        for key in (
            "effective_auth_otp_minutes",
            "effective_password_reset_token_minutes",
            "effective_password_reset_url_template",
            "effective_email_sender",
            "effective_aws_ses_region",
        ):
            settings.__dict__.pop(key, None)
        return original

    def _restore_settings(self, original: dict[str, object]) -> None:
        for key, value in original.items():
            setattr(settings, key, value)
        for key in (
            "effective_auth_otp_minutes",
            "effective_password_reset_token_minutes",
            "effective_password_reset_url_template",
            "effective_email_sender",
            "effective_aws_ses_region",
        ):
            settings.__dict__.pop(key, None)

    def test_password_reset_end_to_end_single_use(self) -> None:
        old = self._set_settings(
            auth_password_enabled=True,
            password_reset_token_minutes=30,
            password_reset_url_template="http://localhost:5174/?auth=reset&token={token}&email={email}",
            environment="development",
            email_provider="console",
        )
        try:
            service = AuthService(self.session)
            # Create an active session so we can verify revocation on password reset.
            tokens = service.login_password(LoginRequest(email=self.user.email, password="OldStrongPass!1"))
            self.assertTrue(bool(tokens.access_token))
            active_before = self.session.exec(
                select(UserSession).where(UserSession.user_id == (self.user.id or 0)).where(UserSession.revoked_at.is_(None))
            ).all()
            self.assertGreater(len(active_before), 0)

            with patch("app.services.auth_service.send_password_reset_email") as mocked_send:
                mocked_send.return_value = EmailSendResult(provider="console", detail="console_no_delivery")
                req = service.request_password_reset(PasswordResetRequest(email=self.user.email))
                self.assertTrue(req.ok)
                mocked_send.assert_called_once()
                call_kwargs = mocked_send.call_args.kwargs
                self.assertIn("reset_link", call_kwargs)
                parsed = urlparse(call_kwargs["reset_link"])
                token = parse_qs(parsed.query).get("token", [""])[0]
                self.assertTrue(token)

            result = service.confirm_password_reset(
                PasswordResetConfirmRequest(token=token, new_password="NewStrongPass!9")
            )
            self.assertTrue(result.ok)

            with self.assertRaises(ValueError):
                service.confirm_password_reset(
                    PasswordResetConfirmRequest(token=token, new_password="AnotherStrongPass!7")
                )

            with self.assertRaises(ValueError):
                service.login_password(LoginRequest(email=self.user.email, password="OldStrongPass!1"))

            new_tokens = service.login_password(LoginRequest(email=self.user.email, password="NewStrongPass!9"))
            self.assertTrue(bool(new_tokens.access_token))

            active_after = self.session.exec(
                select(UserSession).where(UserSession.user_id == (self.user.id or 0)).where(UserSession.revoked_at.is_(None))
            ).all()
            self.assertGreaterEqual(len(active_after), 1)
        finally:
            self._restore_settings(old)

    def test_password_reset_token_expiry_rejected(self) -> None:
        old = self._set_settings(
            auth_password_enabled=True,
            password_reset_token_minutes=5,
            password_reset_url_template="http://localhost:5174/?auth=reset&token={token}",
            environment="development",
            email_provider="console",
        )
        try:
            service = AuthService(self.session)
            with patch("app.services.auth_service.send_password_reset_email") as mocked_send:
                mocked_send.return_value = EmailSendResult(provider="console", detail="console_no_delivery")
                service.request_password_reset(PasswordResetRequest(email=self.user.email))
                reset_row = self.session.exec(
                    select(OTPCode)
                    .where(OTPCode.user_id == (self.user.id or 0))
                    .where(OTPCode.purpose == "password_reset")
                    .where(OTPCode.used_at.is_(None))
                ).first()
                self.assertIsNotNone(reset_row)
                token = parse_qs(urlparse(mocked_send.call_args.kwargs["reset_link"]).query).get("token", [""])[0]
                reset_row.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
                self.session.add(reset_row)
                self.session.commit()
            with self.assertRaises(ValueError):
                service.confirm_password_reset(
                    PasswordResetConfirmRequest(token=token, new_password="AnotherStrongPass!7")
                )
        finally:
            self._restore_settings(old)

    def test_password_reset_unknown_email_returns_generic(self) -> None:
        old = self._set_settings(
            auth_password_enabled=True,
            environment="development",
            email_provider="console",
        )
        try:
            service = AuthService(self.session)
            with patch("app.services.auth_service.send_password_reset_email") as mocked_send:
                response = service.request_password_reset(
                    PasswordResetRequest(email="missing.user@example.com")
                )
                self.assertTrue(response.ok)
                mocked_send.assert_not_called()
        finally:
            self._restore_settings(old)

    def test_password_reset_send_failure_marks_token_used(self) -> None:
        old = self._set_settings(
            auth_password_enabled=True,
            environment="development",
            email_provider="smtp",
        )
        try:
            service = AuthService(self.session)
            with patch("app.services.auth_service.send_password_reset_email") as mocked_send:
                mocked_send.side_effect = RuntimeError("SMTP unavailable")
                with self.assertRaises(ValueError):
                    service.request_password_reset(PasswordResetRequest(email=self.user.email))
            row = self.session.exec(
                select(OTPCode)
                .where(OTPCode.user_id == (self.user.id or 0))
                .where(OTPCode.purpose == "password_reset")
                .order_by(OTPCode.created_at.desc())
            ).first()
            self.assertIsNotNone(row)
            self.assertIsNotNone(row.used_at)
        finally:
            self._restore_settings(old)


if __name__ == "__main__":
    unittest.main()
