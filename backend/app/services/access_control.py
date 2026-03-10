from __future__ import annotations

from typing import Iterable


PAGE_KEYS: tuple[str, ...] = ("v1", "v2", "xintel")


def default_pages_for_version(access_version: str | None) -> set[str]:
    version = str(access_version or "v1").strip().lower()
    if version == "v2":
        return {"v1", "v2", "xintel"}
    return {"v1"}


def _tokenize_pages(value: Iterable[str] | str | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        raw = value.replace(";", ",").replace("|", ",")
        return [part.strip().lower() for part in raw.split(",") if part.strip()]
    tokens: list[str] = []
    for item in value:
        text = str(item or "").strip().lower()
        if text:
            tokens.append(text)
    return tokens


def normalize_page_access(values: Iterable[str] | str | None, *, access_version: str | None = None) -> list[str]:
    version = None if access_version is None else str(access_version).strip().lower()
    selected = {token for token in _tokenize_pages(values) if token in PAGE_KEYS}
    if "xintel" in selected:
        selected.add("v2")
    if "v2" in selected:
        selected.add("v1")
    if version == "v2":
        selected.update(default_pages_for_version("v2"))
    elif version == "v1":
        selected = {"v1"} if not selected else ({"v1"} if "v1" in selected else {"v1"})
    elif not selected:
        selected = default_pages_for_version(version or "v1")
    return [key for key in PAGE_KEYS if key in selected]


def serialize_page_access(values: Iterable[str] | str | None, *, access_version: str | None = None) -> str:
    return ",".join(normalize_page_access(values, access_version=access_version))


def parse_page_access_string(value: str | None, *, access_version: str | None = None) -> list[str]:
    return normalize_page_access(value, access_version=access_version)
