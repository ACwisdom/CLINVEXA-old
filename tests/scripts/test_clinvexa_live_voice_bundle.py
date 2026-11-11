import os
from pathlib import Path

import pytest

from scripts.clinvexa_live_voice_bundle import model_target, quarantine_duplicate_metadata


def test_model_target_accepts_existing_hardlink_without_leaving_runtime(tmp_path: Path):
    home = tmp_path / "runtime"
    model_dir = home / "models" / "clinvexa-live"
    model_dir.mkdir(parents=True)
    source = tmp_path / "cached-model.bin"
    source.write_bytes(b"model")
    target = model_dir / "model.bin"
    os.link(source, target)

    assert model_target(home, Path("models/clinvexa-live/model.bin")) == target


def test_model_target_rejects_parent_escape(tmp_path: Path):
    home = tmp_path / "runtime"
    home.mkdir()

    with pytest.raises(RuntimeError, match="outside runtime"):
        model_target(home, Path("models/../../outside.bin"))


def test_model_target_rejects_existing_symbolic_link(tmp_path: Path):
    home = tmp_path / "runtime"
    model_dir = home / "models"
    model_dir.mkdir(parents=True)
    external = tmp_path / "outside.bin"
    external.write_bytes(b"external")
    link = model_dir / "model.bin"
    try:
        link.symlink_to(external)
    except OSError:
        pytest.skip("symbolic links unavailable on this host")

    with pytest.raises(RuntimeError, match="symbolic link"):
        model_target(home, Path("models/model.bin"))


def test_stale_distribution_metadata_is_backed_up_without_touching_active_version(tmp_path: Path):
    site = tmp_path / "site-packages"
    site.mkdir()
    active = site / "filelock-4.2.0.dist-info"
    stale = site / "filelock-4.2.4.dist-info"
    active.mkdir()
    stale.mkdir()
    backup = tmp_path / "backup"

    assert quarantine_duplicate_metadata(site, backup, {"filelock": "4.2.0"}) == [stale.name]
    assert active.is_dir()
    assert not stale.exists()
    assert len(list(backup.glob("filelock-4.2.4.dist-info.*"))) == 1
