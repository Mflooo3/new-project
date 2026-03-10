from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch
import unittest

from sqlmodel import SQLModel, Session, create_engine, select

from app.config import settings
from app.models import AppUser, OTPCode, Tenant
from app.schemas import LoginRequest, OTPRequest, OTPVerifyRequest, UserRegisterRequest
from app.services.auth_service import AuthService, pwd_context


class AuthOtpFlowTests(unittest.TestCase):
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
            full_name="OTP User",
            email="otp.user@example.com",
            password_hash=pwd_context.hash("Str0ngPass!"),
            status="approved",
            role="user",
            access_version="v2",
            page_access="v1,v2,xintel",
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
        settings.__dict__.pop("effective_auth_otp_minutes", None)
        settings.__dict__.pop("effective_email_sender", None)
        settings.__dict__.pop("effective_aws_ses_region", None)
        return original

    def _restore_settings(self, original: dict[str, object]) -> None:
        for key, value in original.items():
            setattr(settings, key, value)
        settings.__dict__.pop("effective_auth_otp_minutes", None)
        settings.__dict__.pop("effective_email_sender", None)
        settings.__dict__.pop("effective_aws_ses_region", None)

    def test_otp_request_and_verify_single_use(self) -> None:
        old = self._set_settings(
            auth_email_otp_enabled=True,
            otp_resend_cooldown_seconds=0,
            environment="development",
        )
        try:
            service = AuthService(self.session)
            with patch("app.services.auth_service.send_otp_email") as mocked_send:
                res = service.request_otp(OTPRequest(email=self.user.email, purpose="login"))
                self.assertTrue(res.ok)
                self.assertTrue(res.dev_code)
                otp_row = self.session.exec(select(OTPCode).where(OTPCode.user_id == (self.user.id or 0))).first()
                self.assertIsNotNone(otp_row)
                self.assertNotEqual(otp_row.code_hash, res.dev_code)
                mocked_send.assert_called_once()

                tokens = service.verify_otp(
                    OTPVerifyRequest(email=self.user.email, code=res.dev_code or "", purpose="login")
                )
                self.assertTrue(bool(tokens.access_token))
                self.assertTrue(bool(tokens.refresh_token))

                with self.assertRaises(ValueError):
                    service.verify_otp(
                        OTPVerifyRequest(email=self.user.email, code=res.dev_code or "", purpose="login")
                    )
        finally:
            self._restore_settings(old)

    def test_otp_resend_cooldown_is_enforced(self) -> None:
        old = self._set_settings(
            auth_email_otp_enabled=True,
            otp_resend_cooldown_seconds=120,
            environment="development",
        )
        try:
            service = AuthService(self.session)
            with patch("app.services.auth_service.send_otp_email"):
                first = service.request_otp(OTPRequest(email=self.user.email, purpose="login"))
                self.assertTrue(first.ok)
                with self.assertRaises(ValueError):
                    service.request_otp(OTPRequest(email=self.user.email, purpose="login"))
        finally:
            self._restore_settings(old)

    def test_password_login_fails_when_page_access_missing(self) -> None:
        old = self._set_settings(auth_password_enabled=True)
        try:
            self.user.page_access = ""
            self.session.add(self.user)
            self.session.commit()
            service = AuthService(self.session)
            with self.assertRaises(ValueError):
                service.login_password(LoginRequest(email=self.user.email, password="Str0ngPass!"))
        finally:
            self._restore_settings(old)

    def test_register_auto_provisions_tenant_membership(self) -> None:
        service = AuthService(self.session)
        res = service.register(
            UserRegisterRequest(
                full_name="New Workspace User",
                email="new.workspace.user@example.com",
                password="StrongPass123!",
            )
        )
        self.assertGreater(res.user_id, 0)
        user = self.session.get(AppUser, res.user_id)
        self.assertIsNotNone(user)
        self.assertIsNotNone(user.tenant_id)
        tenant = self.session.get(Tenant, user.tenant_id or 0)
        self.assertIsNotNone(tenant)
        self.assertEqual(user.status, "pending")

    def test_login_auto_repairs_missing_tenant_for_non_super_admin(self) -> None:
        old = self._set_settings(auth_password_enabled=True)
        try:
            self.user.tenant_id = None
            self.session.add(self.user)
            self.session.commit()
            service = AuthService(self.session)
            tokens = service.login_password(LoginRequest(email=self.user.email, password="Str0ngPass!"))
            self.assertTrue(bool(tokens.access_token))
            self.assertIsNotNone(tokens.user.tenant_id)
        finally:
            self._restore_settings(old)


if __name__ == "__main__":
    unittest.main()
