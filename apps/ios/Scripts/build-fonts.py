#!/usr/bin/env python3
"""Rebuild native fonts from the pinned @fontsource-variable web dependencies.

Requires fonttools[woff] (FontTools and Brotli). Run after bun install at repo root.
Uses Latin subsets; Core Text supplies fallback glyphs for other scripts.
"""
from pathlib import Path
import shutil

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[3]
output = root / "apps/ios/Sources/IndexUI/Resources/Fonts"
output.mkdir(parents=True, exist_ok=True)

for family, axis, variants in [
    ("geist", "wght", [("IndexSans", "Regular", 400), ("IndexSans", "Medium", 500), ("IndexSans", "Semibold", 600)]),
    ("source-serif-4", "standard", [("IndexSerif", "Semibold", 600), ("IndexSerif", "Bold", 700)]),
    ("geist-mono", "wght", [("IndexMono", "Regular", 400)]),
]:
    package = root / "packages/ui/node_modules/@fontsource-variable" / family
    if not package.exists():
        package = root / "apps/web/node_modules/@fontsource-variable" / family
    source = package / f"files/{family}-latin-{axis}-normal.woff2"
    for name, style, weight in variants:
        font = TTFont(source, recalcTimestamp=False)
        axes = {a.axisTag: (60 if a.axisTag == "opsz" else weight if a.axisTag == "wght" else a.defaultValue)
                for a in font["fvar"].axes}
        font = instantiateVariableFont(font, axes, inplace=True)
        font.flavor = None
        # Stable, private PostScript names avoid collisions with host/extension fonts.
        for name_id, value in {1: name, 2: style, 3: f"{name}-{style}", 4: f"{name} {style}",
                               6: f"{name}-{style}", 16: name, 17: style}.items():
            font["name"].removeNames(nameID=name_id)
            font["name"].setName(value, name_id, 3, 1, 0x409)
        font.save(output / f"{name}-{style}.ttf", reorderTables=False)
        print(f"Bundled {name}-{style} from {family}")
    shutil.copyfile(package / "LICENSE", output / f"{family}-LICENSE.txt")
