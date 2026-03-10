from __future__ import annotations

from datetime import datetime, timedelta, timezone
import unittest

from sqlmodel import SQLModel, Session, create_engine, select

from app.api.iam_routes import admin_active_sessions, admin_user_approve, admin_user_auth_reset, admin_user_create, admin_user_delete
from app.models import AppUser, Tenant, UserSession
from app.schemas import AdminUserCreateRequest, UserApproveRequest, UserAuthResetRequest


class AdminUserManagementAndSessionsTests(unittest.TestCase):
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

        admin = AppUser(
            full_name="Tenant Admin",
            email="admin@tenant-a.local",
            password_hash="hash",
            status="approved",
            role="admin",
            access_version="v2",
            page_access="v1,v2,xintel",
            tenant_id=tenant.id,
            auth_method="hybrid",
            created_at=now,
            updated_at=now,
        )
        self.session.add(admin)
        self.session.commit()
        self.session.refresh(admin)
        self.admin = admin

        super_admin = AppUser(
            full_name="Super Admin",
            email="super.admin@platform.local",
            password_hash="hash",
            status="approved",
            role="super_admin",
            access_version="v2",
            page_access="v1,v2,xintel",
            tenant_id=None,
            auth_method="hybrid",
            created_at=now,
            updated_at=now,
        )
        self.session.add(super_admin)
        self.session.commit()
        self.session.refresh(super_admin)
        self.super_admin = super_admin

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    def test_admin_can_create_user_and_delete(self) -> None:
        created = admin_user_create(
            payload=AdminUserCreateRequest(
                full_name="Created User",
                email="created.user@tenant-a.local",
                password="StrongPass123!",
                tenant_id=self.tenant.id,
                role="user",
                access_version="v1",
                auth_method="hybrid",
                status="approved",
            ),
            user=self.admin,
            session=self.session,
        )
        self.assertEqual(created.email, "created.user@tenant-a.local")
        self.assertEqual(created.tenant_id, self.tenant.id)
        self.assertEqual(created.status, "approved")

        delete_res = admin_user_delete(
            user_id=created.id,
            user=self.admin,
            session=self.session,
        )
        self.assertTrue(delete_res.ok)
        self.assertEqual(delete_res.deleted_user_id, created.id)
        deleted = self.session.get(AppUser, created.id)
        self.assertIsNone(deleted)

    def test_active_sessions_endpoint_returns_live_rows(self) -> None:
        now = datetime.now(timezone.utc)
        user = AppUser(
            full_name="Session User",
            email="session.user@tenant-a.local",
            password_hash="hash",
            status="approved",
            role="user",
            access_version="v1",
            page_access="v1",
            tenant_id=self.tenant.id,
            auth_method="hybrid",
            created_at=now,
            updated_at=now,
        )
        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)

        sess = UserSession(
            user_id=user.id or 0,
            session_id="sid-live-1",
            session_token_hash="hash-token",
            ip_address="127.0.0.1",
            user_agent="pytest",
            created_at=now - timedelta(minutes=5),
            last_seen_at=now - timedelta(minutes=1),
            expires_at=now + timedelta(hours=2),
            revoked_at=None,
        )
        self.session.add(sess)
        self.session.commit()

        rows = admin_active_sessions(user=self.admin, session=self.session, tenant_id=None, limit=200)
        self.assertGreaterEqual(len(rows), 1)
        session_ids = {row.session_id for row in rows}
        self.assertIn("sid-live-1", session_ids)

    def test_admin_can_reset_user_totp(self) -> None:
        now = datetime.now(timezone.utc)
        row = AppUser(
            full_name="Totp User",
            email="totp.user@tenant-a.local",
            password_hash="hash",
            status="approved",
            role="user",
            access_version="v1",
            page_access="v1",
            tenant_id=self.tenant.id,
            auth_method="hybrid",
            totp_enabled=True,
            totp_secret="encrypted-secret",
            totp_enabled_at=now,
            created_at=now,
            updated_at=now,
        )
        self.session.add(row)
        self.session.commit()
        self.session.refresh(row)

        updated = admin_user_auth_reset(
            user_id=row.id or 0,
            payload=UserAuthResetRequest(reset_password=False, reset_otp=False, reset_totp=True),
            user=self.admin,
            session=self.session,
        )
        self.assertFalse(updated.totp_enabled)
        reloaded = self.session.get(AppUser, row.id)
        self.assertIsNotNone(reloaded)
        self.assertFalse(bool(reloaded.totp_enabled))
        self.assertIsNone(reloaded.totp_secret)

    def test_super_admin_create_user_without_tenant_auto_provisions_membership(self) -> None:
        created = admin_user_create(
            payload=AdminUserCreateRequest(
                full_name="Auto Tenant User",
                email="auto.tenant.user@platform.local",
                password="StrongPass123!",
                tenant_id=None,
                role="user",
                access_version="v1",
                auth_method="hybrid",
                status="approved",
            ),
            user=self.super_admin,
            session=self.session,
        )
        self.assertIsNotNone(created.tenant_id)
        tenant = self.session.get(Tenant, created.tenant_id or 0)
        self.assertIsNotNone(tenant)

    def test_approve_without_tenant_uses_existing_or_auto_provision(self) -> None:
        now = datetime.now(timezone.utc)
        row = AppUser(
            full_name="Pending No Tenant",
            email="pending.no.tenant@platform.local",
            password_hash="hash",
            status="pending",
            role="user",
            access_version="v1",
            page_access="v1",
            tenant_id=None,
            auth_method="hybrid",
            created_at=now,
            updated_at=now,
        )
        self.session.add(row)
        self.session.commit()
        self.session.refresh(row)

        approved = admin_user_approve(
            user_id=row.id or 0,
            payload=UserApproveRequest(
                tenant_id=None,
                access_version="v1",
                role="user",
                page_access=["v1"],
            ),
            user=self.super_admin,
            session=self.session,
        )
        self.assertEqual(approved.status, "approved")
        self.assertIsNotNone(approved.tenant_id)


if __name__ == "__main__":
    unittest.main()
