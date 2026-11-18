import hashlib
import random
import tempfile
import unittest
from dataclasses import replace
from datetime import date
from pathlib import Path

from erp_synth.__main__ import generate
from erp_synth.config import Config
from erp_synth.master import generate_master
from erp_synth.simulate import Simulator

SMALL = replace(Config(), start=date(2025, 1, 1), end=date(2025, 4, 30), n_customers=80, base_orders_per_day=8)


def fingerprint(cfg):
    rng = random.Random(cfg.seed)
    master, hidden = generate_master(cfg, rng)
    tables = Simulator(cfg, rng, master, hidden).run()
    return hashlib.sha256(repr(sorted((k, v) for k, v in tables.items())).encode()).hexdigest()


class GenerateTest(unittest.TestCase):
    def test_integrity_checks_pass(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertTrue(generate(SMALL, Path(tmp)))
            self.assertTrue((Path(tmp) / "csv" / "journal_lines.csv").exists())

    def test_deterministic_for_same_seed(self):
        self.assertEqual(fingerprint(SMALL), fingerprint(SMALL))
        self.assertNotEqual(fingerprint(SMALL), fingerprint(replace(SMALL, seed=7)))


if __name__ == "__main__":
    unittest.main()
