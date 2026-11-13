#!/usr/bin/env python3
"""Run with `python3 scripts/test_funnel_manifests.py`; no network required."""

import unittest
import xml.etree.ElementTree as ET

import dev

FUNNEL_URL = "https://test.example.ts.net"
OFFICE_NS = "{http://schemas.microsoft.com/office/appforoffice/1.1}"


class FunnelManifestTests(unittest.TestCase):
    def test_every_local_manifest_renders_to_a_funnel_manifest(self):
        for spec in dev.FUNNEL_MANIFEST_SPECS:
            with self.subTest(manifest=spec.source_path.name):
                rendered = dev.render_funnel_manifest(spec.source_path, FUNNEL_URL)

                ET.fromstring(rendered)
                self.assertNotIn("localhost", rendered)
                self.assertIn(FUNNEL_URL, rendered)

    def test_every_local_manifest_has_its_own_identity_and_output(self):
        ids = [
            ET.parse(spec.source_path).getroot().findtext(f"{OFFICE_NS}Id")
            for spec in dev.FUNNEL_MANIFEST_SPECS
        ]
        outputs = [spec.funnel.path for spec in dev.FUNNEL_MANIFEST_SPECS]

        self.assertNotIn(None, ids)
        self.assertEqual(len(set(ids)), len(ids))
        self.assertEqual(len(set(outputs)), len(outputs))


if __name__ == "__main__":
    unittest.main()
