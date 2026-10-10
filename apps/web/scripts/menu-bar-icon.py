"""Deterministic vector PDF of the existing Index symbol for NSImage template rendering."""
from pathlib import Path
# Same two rounded shapes as src/assets/brand-symbol.svg, in bottom-left PDF coordinates.
stream = b'''0 g
3 0 m 15 0 l 16.657 0 18 1.343 18 3 c 18 45 l 18 46.657 16.657 48 15 48 c
3 48 l 1.343 48 0 46.657 0 45 c 0 3 l 0 1.343 1.343 0 3 0 c f
35.6 58 m 46.4 58 l 48.388 58 50 59.612 50 61.6 c 50 72.4 l
50 74.388 48.388 76 46.4 76 c 35.6 76 l 33.612 76 32 74.388 32 72.4 c
32 61.6 l 32 59.612 33.612 58 35.6 58 c f
'''
objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
           b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 50 76] /Resources << >> /Contents 4 0 R >>',
           b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'endstream']
pdf = b'%PDF-1.4\n'; offsets = [0]
for i, obj in enumerate(objects, 1):
    offsets.append(len(pdf)); pdf += str(i).encode() + b' 0 obj\n' + obj + b'\nendobj\n'
xref = len(pdf)
pdf += b'xref\n0 5\n0000000000 65535 f \n'
for offset in offsets[1:]: pdf += f'{offset:010d} 00000 n \n'.encode()
pdf += f'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
Path(__file__).resolve().parents[1].joinpath('src-tauri/icons/menu-bar.pdf').write_bytes(pdf)
