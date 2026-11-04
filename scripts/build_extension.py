"""Build installable Chrome and Firefox extension bundles.

Creates:

    dist/phishingan-chrome/       unpacked Chrome build
    dist/phishingan-chrome.zip    Chrome Web Store / shareable zip
    dist/phishingan-firefox/      unpacked Firefox build
    dist/phishingan-firefox.zip   Firefox zip

Run from the repo root:

    python scripts/build_extension.py
"""

from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "extension"
DIST = ROOT / "dist"

# Files and folders that make up the extension. Keep this explicit so a local
# file can never accidentally ship.
INCLUDE = [
    "manifest.json",
    "background.js",
    "content.js",
    "popup.html",
    "popup.css",
    "popup.js",
    "lib",
    "model",
    "icons",
]


def copy_build(name: str, manifest: str | None) -> Path:
    target = DIST / name
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    for item in INCLUDE:
        source = SOURCE / item
        destination = target / item
        if source.is_dir():
            shutil.copytree(source, destination)
        else:
            shutil.copy2(source, destination)
    if manifest:
        shutil.copy2(SOURCE / manifest, target / "manifest.json")
    return target


def zip_build(folder: Path) -> Path:
    archive = folder.with_suffix(".zip")
    if archive.exists():
        archive.unlink()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as handle:
        for path in sorted(folder.rglob("*")):
            if path.is_file():
                handle.write(path, path.relative_to(folder))
    return archive


def main() -> int:
    DIST.mkdir(exist_ok=True)

    chrome = copy_build("phishingan-chrome", None)
    firefox = copy_build("phishingan-firefox", "manifest.firefox.json")

    for folder, label in ((chrome, "Chrome/Edge/Brave/Opera"), (firefox, "Firefox")):
        archive = zip_build(folder)
        size = archive.stat().st_size / 1e6
        print(f"{label:<24} {archive} ({size:.1f} MB)")

    print("\nUnpacked builds:")
    print(f"  {chrome}")
    print(f"  {firefox}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
