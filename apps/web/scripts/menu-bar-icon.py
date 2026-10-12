#!/usr/bin/env python3
"""Convert the canonical symbol to a vector PDF for NSImage template rendering."""
import argparse
import os
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'assets/brand/symbol/symbol-black.svg'
OUTPUT = ROOT / 'apps/web/src-tauri/icons/menu-bar.pdf'


def render(converter, output):
    # The SVG viewBox owns the geometry and aspect ratio; no duplicate paths.
    _, _, width, height = map(float, ET.parse(SOURCE).getroot().attrib['viewBox'].split())
    if width <= 0 or height <= 0:
        raise ValueError('The canonical symbol needs a positive viewBox.')
    subprocess.run([
        converter, '--format', 'pdf1.4', '--width', f'{width:g}pt', '--height', f'{height:g}pt',
        '--page-width', f'{width:g}pt', '--page-height', f'{height:g}pt',
        '--output', str(output), str(SOURCE),
    ], check=True, env={**os.environ, 'SOURCE_DATE_EPOCH': '0'})
    data = output.read_bytes()
    bounds = f'/MediaBox [ 0 0 {width:g} {height:g} ]'.encode()
    if not data.startswith(b'%PDF-1.4') or bounds not in data or b'/Subtype /Image' in data:
        raise ValueError('Expected a vector PDF with the canonical symbol dimensions.')
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Compare without changing the output.')
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--rsvg-convert', default=os.environ.get('RSVG_CONVERT', 'rsvg-convert'))
    args = parser.parse_args()
    try:
        with tempfile.TemporaryDirectory(prefix='index-menu-icon-') as folder:
            data = render(args.rsvg_convert, Path(folder) / 'menu-bar.pdf')
        if args.check:
            if not args.output.exists() or args.output.read_bytes() != data:
                parser.exit(1, f'Missing or stale menu-bar icon: {args.output}\nRun python3 apps/web/scripts/menu-bar-icon.py\n')
        else:
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_bytes(data)
    except FileNotFoundError as error:
        parser.exit(1, f'{error}\nInstall librsvg (rsvg-convert with pdf1.4 support), or set RSVG_CONVERT to its executable.\n')
    except (ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f'Menu-bar icon generation failed: {error}\n')


if __name__ == '__main__':
    main()
