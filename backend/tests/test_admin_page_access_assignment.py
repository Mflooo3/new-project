from __future__ import annotations

from datetime import datetime, timezone
import unittest

from fastapi import HTTPException
from sqlmodel import SQLModel, Session, create_engine

from app.api.iam_routes import admin_user_page_access
from app.models import AppUser, Tenant
from app.schemas import UserPageAccessUpdateRequest


class AdminPageAccessAssignmentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
        SQLModel.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        now = datetime.now(timezone.utc)

        tenant_a = Tenant(name="Tenant A", slug="tenant-a", status="active")
        tenant_b = Tenant(name="Tenant B", slug="tenant-b", status="active")
        self.session.add(tenant_a)
        self.session.add(tenant_b)
        self.session.commit()
        self.session.refresh(tenant_a)
        self.session.refresh(tenant_b)
        self.tenant_a = tenant_a
        self.tenant_b = tenant_b

        admin = AppUser(
            full_name="Tenant Admin",
            email="admin@tenant-a.local",
            password_hash="hash",
            status="approved",
            role="admin",
            access_version="v2",
            page_access="v1,v2,xintel",
            tenant_id=tenant_a.id,
            auth_method="hybrid",
            created_at=now,
            updated_at=now,
        )
        user_a = AppUser(
            full_name="User A",
            email="user-a@tenant-a.local",
            password_hash="hash",
            status="approved",
            role="user",
            access_version="v1",
            page_access="v1",
            tenant_id=tenant_a.id,
            auth_method="hybrid",
            created_at=now,
            updated_at=now,
        )
        user_b = AppUser(
            full_name="User B",
            email="user-b@tenant-b.local",
            password_hash="hash",
            status="approved",
            role="user",
            access_version="v1",
            page_access="v1",
            tenant_id=tenant_b.id,
            auth_method="hybrid",
            created_at=now,
            updated_at=now,
        )
        self.session.add(admin)
        self.session.add(user_a)
        self.session.add(user_b)
        self.session.commit()
        self.session.refresh(admin)
        self.session.refresh(user_a)
        self.session.refresh(user_b)
        self.admin = admin
        self.user_a = user_a
        self.user_b = user_b

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    def test_admin_can_grant_new_page_access(self) -> None:
        self.user_a.access_version = "v2"
        self.session.add(self.user_a)
        self.session.commit()
        payload = UserPageAccessUpdateRequest(page_access=["xintel"])
        row = admin_user_page_access(
            user_id=self.user_a.id or 0,
            payload=payload,
            user=self.admin,
            session=self.session,
        )
        self.assertEqual(row.page_access, ["v1", "v2", "xintel"])

    def test_admin_cannot_grant_cross_tenant_user(self) -> None:
        payload = UserPageAccessUpdateRequest(page_access=["v1", "v2"])
        with self.assertRaises(HTTPException) as ctx:
            admin_user_page_access(
                user_id=self.user_b.id or 0,
                payload=payload,
                user=self.admin,
                session=self.session,
            )
        self.assertEqual(ctx.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
