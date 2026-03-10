from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sqlmodel import SQLModel, Session, create_engine, select

from app.models import APIUsageLog
from app.services.api_usage_tracker import (
    estimate_openai_cost,
    extract_openai_usage,
    track_openai_api_usage,
    track_x_api_usage,
)


class ApiUsageTrackerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
        SQLModel.metadata.create_all(self.engine)
        self.session = Session(self.engine)

    def tearDown(self) -> None:
        self.session.close()
        self.engine.dispose()

    def test_extract_openai_usage_supports_responses_shape(self) -> None:
        response = SimpleNamespace(
            usage=SimpleNamespace(input_tokens=1500, output_tokens=450, total_tokens=1950)
        )
        usage = extract_openai_usage(response)
        self.assertEqual(usage["prompt_tokens"], 1500.0)
        self.assertEqual(usage["completion_tokens"], 450.0)
        self.assertEqual(usage["total_tokens"], 1950.0)

    def test_openai_and_x_cost_tracking(self) -> None:
        response = SimpleNamespace(
            usage=SimpleNamespace(input_tokens=1000, output_tokens=500, total_tokens=1500)
        )
        with patch("app.services.api_usage_tracker.settings.openai_input_cost_per_1m_tokens", 0.5), patch(
            "app.services.api_usage_tracker.settings.openai_output_cost_per_1m_tokens", 1.0
        ), patch("app.services.api_usage_tracker.settings.x_api_call_cost", 0.002):
            expected_cost = estimate_openai_cost(prompt_tokens=1000, completion_tokens=500)
            self.assertAlmostEqual(expected_cost, 0.001, places=8)
            track_openai_api_usage(
                self.session,
                user_id=10,
                tenant_id=20,
                endpoint="/ai/chat",
                response=response,
            )
            track_x_api_usage(
                self.session,
                user_id=10,
                tenant_id=20,
                endpoint="/x-intel/dashboard",
                calls=3,
            )

        rows = self.session.exec(select(APIUsageLog)).all()
        self.assertEqual(len(rows), 2)
        by_provider = {row.provider: row for row in rows}
        self.assertIn("openai", by_provider)
        self.assertIn("x", by_provider)
        self.assertAlmostEqual(float(by_provider["openai"].cost), 0.001, places=8)
        self.assertEqual(float(by_provider["openai"].usage_units), 1500.0)
        self.assertAlmostEqual(float(by_provider["x"].cost), 0.006, places=8)
        self.assertEqual(float(by_provider["x"].usage_units), 3.0)


if __name__ == "__main__":
    unittest.main()
