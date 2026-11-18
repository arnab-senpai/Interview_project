"""Automated integrity tests for SystemCraft Studio HLD curriculum datasets."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.scripts.validate_content import validate_all


class TestHldDatasets(unittest.TestCase):
    def test_all_datasets_pass_schema_and_cross_references(self) -> None:
        summary = validate_all()
        self.assertEqual(summary["errors"], [], f"Validation errors: {summary['errors']}")
        self.assertEqual(summary["tracks"], 3)
        self.assertEqual(summary["layers"], 7)
        self.assertEqual(summary["planned_lessons"], 33)
        self.assertEqual(summary["ready_lessons"], 17)
        self.assertEqual(summary["planned_case_studies"], 34)
        self.assertEqual(summary["ready_case_studies"], 13)
        self.assertEqual(summary["modules"], 6)
        self.assertEqual(summary["patterns"], 12)
        self.assertEqual(summary["ddia_chapters"], 12)
        self.assertGreaterEqual(summary["pragmatic_principles"], 6)
        self.assertGreaterEqual(summary["flashcards"], 55)
        self.assertGreaterEqual(summary["quizzes"], 55)


if __name__ == "__main__":
    unittest.main()
