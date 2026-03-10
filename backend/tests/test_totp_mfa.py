from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

import pyotp
from sqlmodel import SQLModel, Session, create_engine

from app.config import settings
from app.models import AppUser, Tenant
from app.schemas import LoginRequest, TOTPDisableRequest
from app.services.auth_service import AuthService, decrypt_totp_secret, pwd_context


class TotpMfaTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
        SQLModel.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        now = datetime.now(timezone.utc)
        tenant = Tenant(name="Tenant A", slug="tenant-a", status="active")
        self.session.add(tenant)
        self.session.commit()
        self.session.refresh(tenant)
        self.tenant = tenant
        self.user = AppUser(
            full_name="MFA User",
            email="mfa.user@example.com",
            password_hash=pwd_context.hash("Str0ngPass!"),
            status="approved",
            role="user",
            access_version="v1",
            page_access="v1",
            tenant_id=tenant.id,
            auth_method="hybrid",
            created_at=now,
            updated_at=now,
        )
        self.admin = AppUser(
            full_name="Admin User",
            email="admin@example.com",
            password_hash=pwd_context.hash("Str0ngPass!"),
            status="approved",
            role="admin",
            access_version="v2",
            page_access="v1,v2,xintel",
            tenant_id=tenant.id,
            auth_method="hybrid",
            created_at=now,
            updated_at=now,
        )
        self.session.add(self.user)
        self.session.add(self.admin)
        self.session.commit()
        self.session.refresh(self.user)
        self.session.refresh(self.admin)

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    def _set_settings(self, **kwargs):
        original: dict[str, object] = {}
        for key, value in kwargs.items():
            original[key] = getattr(settings, key)
            setattr(settings, key, value)
        settings.__dict__.pop("effective_totp_issuer_name", None)
        return original

    def _restore_settings(self, original: dict[str, object]) -> None:
        for key, value in original.items():
            setattr(settings, key, value)
        settings.__dict__.pop("effective_totp_issuer_name", None)

    def _enroll_totp(self, service: AuthService) -> str:
        start = service.start_totp_setup(user=self.user, password="Str0ngPass!")
        self.assertTrue(start.qr_code_data_url.startswith("data:image/png;base64,"))
        self.assertTrue(start.otpauth_uri.startswith("otpauth://totp/"))
        current_code = pyotp.TOTP(
            start.manual_entry_key,
            interval=max(15, int(settings.totp_step_seconds or 30)),
            digits=max(6, int(settings.totp_digits or 6)),
        ).now()
        status = service.verify_totp_setup(user=self.user, code=current_code)
        self.assertTrue(status.enabled)
        self.assertFalse(status.pending_setup)
        self.session.refresh(self.user)
        decrypted = decrypt_totp_secret(self.user.totp_secret)
        self.assertEqual(decrypted, start.manual_entry_key)
        return decrypted or ""

    def test_totp_enrollment_and_login_flow(self) -> None:
        old = self._set_settings(totp_step_seconds=30, totp_digits=6)
        try:
            service = AuthService(self.session)
            secret = self._enroll_totp(service)

            with self.assertRaises(ValueError):
                service.login_password(LoginRequest(email=self.user.email, password="Str0ngPass!"))

            with self.assertRaises(ValueError):
                service.login_password(
                    LoginRequest(email=self.user.email, password="Str0ngPass!", totp_code="000000")
                )

            valid_code = pyotp.TOTP(
                secret,
                interval=max(15, int(settings.totp_step_seconds or 30)),
                digits=max(6, int(settings.totp_digits or 6)),
            ).now()
            tokens = service.login_password(
                LoginRequest(email=self.user.email, password="Str0ngPass!", totp_code=valid_code)
            )
            self.assertTrue(bool(tokens.access_token))
            self.assertTrue(bool(tokens.refresh_token))
        finally:
            self._restore_settings(old)

    def test_totp_invalid_and_expired_code_rejected(self) -> None:
        old = self._set_settings(totp_step_seconds=30, totp_digits=6)
        try:
            service = AuthService(self.session)
            secret = self._enroll_totp(service)
            expired_code = pyotp.TOTP(
                secret,
                interval=max(15, int(settings.totp_step_seconds or 30)),
                digits=max(6, int(settings.totp_digits or 6)),
            ).at(datetime.now(timezone.utc) - timedelta(minutes=5))
            with self.assertRaises(ValueError):
                service.login_password(
                    LoginRequest(email=self.user.email, password="Str0ngPass!", totp_code=expired_code)
                )
        finally:
            self._restore_settings(old)

    def test_totp_disable_and_admin_reset(self) -> None:
        old = self._set_settings(totp_step_seconds=30, totp_digits=6)
        try:
            service = AuthService(self.session)
            secret = self._enroll_totp(service)
            disable_code = pyotp.TOTP(
                secret,
                interval=max(15, int(settings.totp_step_seconds or 30)),
                digits=max(6, int(settings.totp_digits or 6)),
            ).now()
            result = service.disable_totp(
                user=self.user,
                payload=TOTPDisableRequest(password="Str0ngPass!", code=disable_code),
            )
            self.assertTrue(result.ok)
            self.session.refresh(self.user)
            self.assertFalse(bool(self.user.totp_enabled))

            # Re-enable then admin reset.
            secret = self._enroll_totp(service)
            self.assertTrue(bool(secret))
            service.admin_reset_totp(actor=self.admin, target=self.user)
            self.session.refresh(self.user)
            self.assertFalse(bool(self.user.totp_enabled))
            self.assertIsNone(self.user.totp_secret)
        finally:
            self._restore_settings(old)

    def test_login_without_totp_remains_functional(self) -> None:
        service = AuthService(self.session)
        tokens = service.login_password(LoginRequest(email=self.user.email, password="Str0ngPass!"))
        self.assertTrue(bool(tokens.access_token))
        self.assertTrue(bool(tokens.refresh_token))


if __name__ == "__main__":
    unittest.main()
