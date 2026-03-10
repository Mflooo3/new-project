from __future__ import annotations

from datetime import datetime, timezone
import unittest

from fastapi import HTTPException
from sqlmodel import SQLModel, Session, create_engine

from app.api.routes import ai_reports, get_events
from app.models import AppUser, Event, Tenant
from app.schemas import LoginRequest
from app.services.auth_service import AuthService, decode_token, pwd_context


class AuthSessionAlignmentTests(unittest.TestCase):
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

        self.v1_user = AppUser(
            full_name="V1 User",
            email="v1.user@tenant-a.local",
            password_hash=pwd_context.hash("StrongPass123!"),
            status="approved",
            role="user",
            access_version="v1",
            page_access="v1",
            tenant_id=tenant_a.id,
            auth_method="hybrid",
            created_at=now,
            updated_at=now,
        )
        self.v2_user = AppUser(
            full_name="V2 User",
            email="v2.user@tenant-a.local",
            password_hash=pwd_context.hash("StrongPass123!"),
            status="approved",
            role="user",
            access_version="v2",
            page_access="v1,v2,xintel",
            tenant_id=tenant_a.id,
            auth_method="hybrid",
            created_at=now,
            updated_at=now,
        )
        self.session.add(self.v1_user)
        self.session.add(self.v2_user)
        self.session.commit()
        self.session.refresh(self.v1_user)
        self.session.refresh(self.v2_user)

        self.session.add(
            Event(
                tenant_id=tenant_a.id,
                source_type="news",
                source_name="WAM Official",
                url="https://www.wam.ae/en/article/example-a",
                title="Tenant A event",
                summary="Scoped event",
                severity=2,
                event_time=now,
                created_at=now,
            )
        )
        self.session.add(
            Event(
                tenant_id=tenant_b.id,
                source_type="news",
                source_name="WAM Official",
                url="https://www.wam.ae/en/article/example-b",
                title="Tenant B event",
                summary="Must not leak",
                severity=2,
                event_time=now,
                created_at=now,
            )
        )
        self.session.commit()

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    def test_access_token_contains_tenant_context(self) -> None:
        service = AuthService(self.session)
        token = service.login_password(LoginRequest(email=self.v1_user.email, password="StrongPass123!"))
        payload = decode_token(token.access_token)
        self.assertEqual(payload.get("tenant_id"), self.v1_user.tenant_id)
        self.assertEqual(payload.get("access_version"), "v1")
        self.assertEqual(payload.get("page_access"), ["v1"])

    def test_events_query_is_tenant_scoped(self) -> None:
        rows = get_events(
            limit=100,
            source_type=None,
            min_severity=1,
            query_text=None,
            trusted_only=False,
            feature="news_feed",
            event_time_from=None,
            event_time_to=None,
            user=self.v1_user,
            session=self.session,
        )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].tenant_id, self.tenant_a.id)
        self.assertEqual(rows[0].title, "Tenant A event")

    def test_v1_user_cannot_call_v2_only_reports_api(self) -> None:
        with self.assertRaises(HTTPException) as ctx:
            ai_reports(limit=10, user=self.v1_user, session=self.session)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_v2_user_can_call_v2_only_reports_api(self) -> None:
        rows = ai_reports(limit=10, user=self.v2_user, session=self.session)
        self.assertIsInstance(rows, list)


if __name__ == "__main__":
    unittest.main()
