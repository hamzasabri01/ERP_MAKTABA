"""Additive and reversible School Research Assistant schema migration.

Usage:
    python -m migrations.research_module_v1 upgrade
    python -m migrations.research_module_v1 downgrade
"""
from __future__ import annotations

import argparse

from core.database import Base, engine
from models import research as research_models  # noqa: F401


TABLE_NAMES = (
    "research_requests",
    "research_outlines",
    "research_sections",
    "research_section_versions",
    "research_sources",
    "research_assets",
    "research_outputs",
    "research_status_history",
    "research_ai_usage",
    "research_settings",
)


def upgrade(bind=engine) -> None:
    # checkfirst keeps the migration idempotent on local SQLite installations.
    Base.metadata.create_all(bind=bind, tables=[Base.metadata.tables[name] for name in TABLE_NAMES], checkfirst=True)


def downgrade(bind=engine) -> None:
    # Children are dropped before parents to preserve foreign-key integrity.
    for name in reversed(TABLE_NAMES):
        Base.metadata.tables[name].drop(bind=bind, checkfirst=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("upgrade", "downgrade"))
    args = parser.parse_args()
    upgrade() if args.action == "upgrade" else downgrade()


if __name__ == "__main__":
    main()
