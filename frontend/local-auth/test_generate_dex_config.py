"""Run: uv run --with bcrypt --with pyyaml python -m unittest discover -s frontend/local-auth"""
import unittest
import bcrypt
import yaml
from generate_dex_config import ROOT, PASSWORD_HASH, generate


class GeneratedDexTest(unittest.TestCase):
    def test_accounts_and_password(self):
        original = yaml.safe_load((ROOT / 'dex-config.yml').read_text())['staticPasswords']
        accounts = yaml.safe_load(generate())['staticPasswords']
        self.assertEqual(accounts[:len(original)], original)
        self.assertEqual(len(accounts), len(original) + 1000)
        self.assertEqual(len({a['email'] for a in accounts}), len(accounts))
        self.assertEqual(len({a['userID'] for a in accounts}), len(accounts))
        for number, account in enumerate(accounts[len(original):], 1):
            self.assertEqual(account['email'], f'user-{number:04d}@example.com')
            self.assertEqual(account['userID'], f'user-{number:04d}')
            self.assertEqual(account['hash'], PASSWORD_HASH)
        self.assertTrue(bcrypt.checkpw(b'password', PASSWORD_HASH.encode()))

    def test_generation_is_reproducible(self):
        self.assertEqual(generate(), generate())
