import os
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import models  # noqa: F401
from api.research_schemas import ExportRegister, ResearchRequestCreate, RewriteInput, SourceCreate, SourceVerify
from api.routes import research
from core.database import Base
from models.user import Role, User


class ResearchAPIIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["RESEARCH_MODULE_ENABLED"] = "true"
        os.environ["RESEARCH_AI_PROVIDER"] = "mock"
        cls.engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
        Base.metadata.create_all(cls.engine)
        cls.Session = sessionmaker(bind=cls.engine, autocommit=False, autoflush=False)
        db = cls.Session()
        role = Role(name="Research test admin", permissions="all")
        cls.user = User(username="research-admin", password_hash="not-used", role=role, is_active=True)
        db.add(cls.user)
        db.commit()
        db.refresh(cls.user)
        db.expunge(cls.user)
        db.close()

    @classmethod
    def tearDownClass(cls):
        cls.engine.dispose()
        os.environ.pop("RESEARCH_MODULE_ENABLED", None)

    def setUp(self):
        self.db = self.Session()
        self.user = self.db.query(User).filter(User.id == self.user.id).first()

    def tearDown(self):
        self.db.close()

    def create(self, topic="Water cycle", include_references=True):
        return research.create_request(ResearchRequestCreate(
            topic=topic, subject="Science", academic_level="primary", language="en",
            language_level="simple", target_pages=2, include_references=include_references,
        ), db=self.db, user=self.user)

    def test_complete_human_controlled_workflow(self):
        created = self.create()
        request_id = created["id"]
        self.assertEqual(created["status"], "DRAFT")

        outline = research.generate_outline(request_id, db=self.db, user=self.user)
        self.assertEqual(outline["status"], "OUTLINE_READY")
        self.assertGreaterEqual(len(outline["outline"]["sections"]), 2)

        approved_outline = research.approve_outline(request_id, db=self.db, user=self.user)
        self.assertEqual(approved_outline["status"], "OUTLINE_APPROVED")

        generated = research.generate_sections(request_id, db=self.db, user=self.user)
        self.assertEqual(generated["status"], "REVIEW_REQUIRED")
        self.assertTrue(all(section["content"] for section in generated["sections"]))
        self.assertTrue(all(section["versions"] for section in generated["sections"]))

        source = research.create_source(request_id, SourceCreate(title="School science textbook", source_type="internal"), db=self.db, user=self.user)
        verified = research.verify_source(source["id"], SourceVerify(status="VERIFIED"), db=self.db, user=self.user)
        self.assertEqual(verified["verification_status"], "VERIFIED")

        quality = research.quality_check(request_id, db=self.db, user=self.user)
        self.assertIn("checks", quality)

        approved = research.approve_request(request_id, db=self.db, user=self.user)
        self.assertEqual(approved["status"], "APPROVED")
        pos = research.prepare_pos(request_id, db=self.db, user=self.user)
        self.assertEqual(pos["pricing_mode"], "manual")
        self.assertGreater(pos["suggested_price"], 0)
        exported = research.register_export(request_id, ExportRegister(file_type="pdf", page_count=2, file_size=2000), db=self.db, user=self.user)
        self.assertEqual(exported["status"], "EXPORTED")
        printed = research.mark_printed(request_id, db=self.db, user=self.user)
        self.assertEqual(printed["status"], "PRINTED")

    def test_invalid_early_approval_is_rejected(self):
        created = self.create(topic="Early approval", include_references=False)
        with self.assertRaises(HTTPException) as raised:
            research.approve_request(created["id"], db=self.db, user=self.user)
        self.assertEqual(raised.exception.status_code, 409)

    def test_outline_replacement_and_double_version_rewrite_are_atomic(self):
        created = self.create(topic="Renewable energy", include_references=False)
        request_id = created["id"]
        research.generate_outline(request_id, db=self.db, user=self.user)
        research.approve_outline(request_id, db=self.db, user=self.user)
        generated = research.generate_sections(request_id, db=self.db, user=self.user)
        section_id = generated["sections"][0]["id"]

        rewritten = research.rewrite_section(
            section_id, RewriteInput(action="simplify"), db=self.db, user=self.user,
        )
        self.assertTrue(rewritten["content"])

        research.generate_outline(request_id, db=self.db, user=self.user)
        replaced = research.approve_outline(request_id, db=self.db, user=self.user)
        orders = [section["order"] for section in replaced["sections"]]
        self.assertEqual(len(orders), len(set(orders)))
        self.assertEqual(replaced["status"], "OUTLINE_APPROVED")


if __name__ == "__main__":
    unittest.main()
