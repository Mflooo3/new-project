from __future__ import annotations

import unittest

from app.services.access_control import (
    normalize_page_access,
    parse_page_access_string,
    serialize_page_access,
)


class AccessControlPageTests(unittest.TestCase):
    def test_v2_is_superset_of_v1(self) -> None:
        self.assertEqual(normalize_page_access(["v2"]), ["v1", "v2"])

    def test_xintel_implies_v2_and_v1(self) -> None:
        self.assertEqual(normalize_page_access(["xintel"]), ["v1", "v2", "xintel"])

    def test_default_for_v1_when_empty(self) -> None:
        self.assertEqual(normalize_page_access([], access_version="v1"), ["v1"])

    def test_default_for_v2_when_empty(self) -> None:
        self.assertEqual(normalize_page_access([], access_version="v2"), ["v1", "v2", "xintel"])

    def test_v2_superset_even_if_stored_as_v1(self) -> None:
        self.assertEqual(normalize_page_access(["v1"], access_version="v2"), ["v1", "v2", "xintel"])

    def test_v1_users_cannot_hold_v2_pages(self) -> None:
        self.assertEqual(normalize_page_access(["v1", "v2", "xintel"], access_version="v1"), ["v1"])

    def test_parse_and_serialize_are_stable(self) -> None:
        raw = "xintel,v1"
        parsed = parse_page_access_string(raw, access_version="v2")
        self.assertEqual(parsed, ["v1", "v2", "xintel"])
        self.assertEqual(serialize_page_access(parsed, access_version="v2"), "v1,v2,xintel")


if __name__ == "__main__":
    unittest.main()
