import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config_metadata import (
    REFERENCE,
    introduction_versions,
    prepare_config_release,
    validate_released_reference,
    version_key,
)


class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git("init", "-q")
        (self.repo / REFERENCE).parent.mkdir(parents=True)

    def git(self, *args):
        return subprocess.check_output(
            ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", *args],
            cwd=self.repo, text=True,
        ).strip()

    def snapshot(self, keys, tag=None):
        (self.repo / REFERENCE).write_text(json.dumps(dict.fromkeys(keys, {})))
        self.git("add", ".")
        self.git("commit", "-qm", "Snapshot")
        if tag:
            self.git("tag", tag)

    def test_first_released_presence_and_distinct_alias_names(self):
        self.snapshot(["legacy", "removed"], "0.6.0")
        self.snapshot(["legacy", "temporary"])
        self.snapshot(["legacy", "renamed"], "0.6.1")
        self.snapshot(["legacy", "renamed", "removed"], "v0.7.0")
        self.snapshot(["legacy", "renamed", "removed", "temporary", "new"])
        self.git("tag", "sidecar-1.0.0")
        self.assertEqual(introduction_versions(self.repo, {"legacy", "renamed", "removed", "temporary", "new"}), {
            "legacy": "0.6.0", "renamed": "0.6.1", "removed": "0.6.0",
            "temporary": "unreleased", "new": "unreleased",
        })

    def test_unmerged_tags_are_not_part_of_the_release_lineage(self):
        self.snapshot(["old"], "0.6.0")
        branch = self.git("branch", "--show-current")
        self.git("checkout", "-qb", "other")
        self.snapshot(["old", "new", "other-branch"], "0.6.1")
        self.git("checkout", "-q", branch)
        self.snapshot(["old", "new"])
        self.assertEqual(introduction_versions(self.repo, {"new"}), {"new": "unreleased"})

    def test_prerelease_and_baseline(self):
        (self.repo / "README").write_text("Before reference")
        self.git("add", ".")
        self.git("commit", "-qm", "Before reference")
        self.git("tag", "0.5.0")
        self.snapshot(["old"], "0.6.0-rc.1")
        self.snapshot(["old", "new"], "0.6.0")
        self.assertEqual(introduction_versions(self.repo, {"old", "new"}), {"old": "0.6.0-rc.1", "new": "0.6.0"})

    def test_incomplete_history_is_an_error(self):
        self.snapshot(["old"])
        with self.assertRaisesRegex(ValueError, "No release tags"):
            introduction_versions(self.repo, {"old"})
        self.git("tag", "0.6.0")
        shallow = self.repo / "shallow-clone"
        self.git("clone", "-q", "--depth=1", self.repo.as_uri(), str(shallow))
        with self.assertRaisesRegex(ValueError, "full history"):
            introduction_versions(shallow, {"old"})



class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        (self.repo / REFERENCE).parent.mkdir(parents=True)
        self.source = self.repo / "backend/erato_config/src/config.rs"
        self.source.parent.mkdir(parents=True)
        self.source.write_text('''#[facet(erato_config::introduced_in(version = "unreleased"))]
new: bool,
#[facet(erato_config::introduced_in(
    version = "unreleased",
    under = "special.path"
))]
scoped: bool,
#[facet(erato_config::introduced_in(version = "0.6.0"))]
old: bool,
const UNRELATED: &str = "unreleased";
''')
        self.reference("unreleased")

    def reference(self, version):
        (self.repo / REFERENCE).write_text(json.dumps({
            "old": {"stability": "stable", "introduced_in": "0.6.0"},
            "new": {"stability": "unstable", "introduced_in": version},
        }))

    def test_release_changes_only_unreleased_dates_and_returns_files_to_commit(self):
        def regenerate(*args, **kwargs):
            self.assertEqual(kwargs, {"cwd": self.repo / "backend", "check": True})
            self.reference("0.8.0")
        run = Mock(side_effect=regenerate)
        paths = prepare_config_release(self.repo, "0.8.0", run=run)
        self.assertEqual(set(paths), {self.repo / REFERENCE, self.source})
        self.assertIn('version = "0.8.0",\n    under = "special.path"', self.source.read_text())
        self.assertIn('introduced_in(version = "0.8.0")', self.source.read_text())
        self.assertIn('introduced_in(version = "0.6.0")', self.source.read_text())
        self.assertIn('UNRELATED: &str = "unreleased"', self.source.read_text())
        run.assert_called_once()
        validate_released_reference(self.repo)
        # Running again never re-dates an already released key.
        source = self.source.read_text()
        prepare_config_release(self.repo, "0.8.1", run=Mock())
        self.assertEqual(source, self.source.read_text())

    def test_failed_generation_prevents_successful_release_preparation(self):
        run = Mock(side_effect=subprocess.CalledProcessError(1, ["cargo"]))
        with self.assertRaises(subprocess.CalledProcessError):
            prepare_config_release(self.repo, "0.8.0", run=run)

    def test_unresolved_or_missing_versions_block_release(self):
        with self.assertRaisesRegex(ValueError, "new.*no released"):
            validate_released_reference(self.repo)
        with self.assertRaisesRegex(ValueError, "new.*no released"):
            prepare_config_release(self.repo, "0.8.0", run=Mock())
        self.reference(None)
        with self.assertRaises(ValueError):
            validate_released_reference(self.repo)

    def test_tag_command_never_tags_or_pushes_when_metadata_validation_fails(self):
        script = Path(__file__).resolve().parents[1] / "tag-release.py"
        spec = importlib.util.spec_from_file_location("tag_release_test", script)
        module = importlib.util.module_from_spec(spec)
        # The release entry point uses tomlkit only to read the package version.
        # Keep this test dependency-free and exercise its actual ordering of
        # validation, tag creation, and push with all external commands mocked.
        parser = Mock(parse=Mock(return_value={"package": {"version": "0.8.0"}}))
        with patch.dict(sys.modules, {"tomlkit": parser}):
            spec.loader.exec_module(module)
        cargo = self.repo / "backend/erato/Cargo.toml"
        cargo.parent.mkdir(parents=True)
        cargo.write_text('[package]\nversion = "0.8.0"\n')
        module.__file__ = str(self.repo / "scripts/tag-release.py")

        def fake_git(args, check=True):
            output = ""
            code = 0
            if args == ["rev-parse", "--abbrev-ref", "HEAD"]:
                output = "main"
            elif args in (["rev-parse", "HEAD"], ["rev-parse", "origin/main"]):
                output = "same-commit"
            elif args == ["rev-parse", "0.8.0"]:
                code = 1
            return subprocess.CompletedProcess(args, code, stdout=output)

        for generation_error in [None, subprocess.CalledProcessError(1, ["cargo"])]:
            with self.subTest(generation_error=generation_error):
                git = Mock(side_effect=fake_git)
                with patch.object(module, "run_git_command", git), patch.object(
                    module.subprocess, "run", side_effect=generation_error
                ), patch("builtins.print"):
                    with self.assertRaises(SystemExit) as error:
                        module.main()
                self.assertEqual(error.exception.code, 1)
                self.assertFalse(any(call.args[0][0] in {"tag", "push"} for call in git.call_args_list))

    def test_invalid_version_fails_before_changes(self):
        before = self.source.read_text()
        with self.assertRaises(ValueError):
            prepare_config_release(self.repo, "unreleased", run=Mock())
        self.assertEqual(self.source.read_text(), before)
        for bad in ["01.2.3", "1.2.3-01", "1.2", "v1.2.3"]:
            with self.assertRaises(ValueError):
                version_key(bad)


if __name__ == "__main__":
    unittest.main()
