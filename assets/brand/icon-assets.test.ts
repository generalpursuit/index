import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { it } from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const desktop = "apps/web/src-tauri/icons/";
const read = (path: string) => readFileSync(root + path);

// Decode the actual exported pixels, including the PNG frames embedded in ICO/ICNS.
// The generator emits non-interlaced 8-bit RGB/RGBA; no image-library dependency is needed.
function png(data: Buffer) {
  assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  const width = data.readUInt32BE(16),
    height = data.readUInt32BE(20);
  assert.equal(data.readUInt8(24), 8);
  assert.equal(data.readUInt8(28), 0);
  const color = data.readUInt8(25);
  assert.ok(color === 2 || color === 6);
  const channels = color === 6 ? 4 : 3,
    stride = width * channels;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < data.length;) {
    const size = data.readUInt32BE(offset);
    if (data.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(data.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  const encoded = inflateSync(Buffer.concat(chunks));
  assert.equal(encoded.length, height * (stride + 1));
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const offset = y * (stride + 1),
      filter = encoded.readUInt8(offset);
    assert.ok(filter <= 4);
    const row = Buffer.from(encoded.subarray(offset + 1, offset + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i < channels ? 0 : row.readUInt8(i - channels);
      const b = previous.readUInt8(i),
        c = i < channels ? 0 : previous.readUInt8(i - channels);
      const p = a + b - c,
        pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      const predictor = [
        0,
        a,
        b,
        Math.floor((a + b) / 2),
        pa <= pb && pa <= pc ? a : pb <= pc ? b : c,
      ][filter]!;
      row[i] = (row.readUInt8(i) + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      row.copy(pixels, offset, x * channels, x * channels + 3);
      pixels[offset + 3] = channels === 4 ? row.readUInt8(x * channels + 3) : 255;
    }
    previous = row;
  }
  return { width, height, pixels };
}

function inset(data: Buffer, fraction: number) {
  const { width, height, pixels } = png(data);
  assert.equal(width, height);
  let left = width,
    top = height,
    right = 0,
    bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels.readUInt8((y * width + x) * 4 + 3) < 128) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
    }
  }
  for (const margin of [left, top, width - right, height - bottom])
    assert.ok(Math.abs(margin - width * fraction) <= 1, `${width}px icon has ${margin}px margin`);
  // Corners must be transparent, while the middle remains solid artwork.
  assert.equal(pixels.readUInt8(3), 0);
  assert.equal(
    pixels.readUInt8((Math.floor(height / 2) * width + Math.floor(width / 2)) * 4 + 3),
    255,
  );
  return width;
}

it("every Windows ICO frame has breathing room at its native resolution", () => {
  const ico = read(desktop + "icon.ico");
  assert.equal(ico.readUInt32LE(0), 0x00010000);
  const sizes: number[] = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const entry = 6 + i * 16,
      offset = ico.readUInt32LE(entry + 12);
    const size = inset(ico.subarray(offset, offset + ico.readUInt32LE(entry + 8)), 3 / 48);
    assert.equal(size, ico.readUInt8(entry) || 256);
    sizes.push(size);
  }
  assert.deepEqual(
    sizes.toSorted((a, b) => a - b),
    [16, 24, 32, 48, 64, 256],
  );
});

it("Linux packages include a consistent inset at every PNG size, including 512px", () => {
  const config = JSON.parse(read("apps/web/src-tauri/tauri.conf.json").toString());
  for (const [file, size] of Object.entries({
    "32x32.png": 32,
    "48x48.png": 48,
    "64x64.png": 64,
    "128x128.png": 128,
    "128x128@2x.png": 256,
    "icon.png": 512,
  })) {
    assert.ok(config.bundle.icon.includes(`icons/${file}`));
    assert.equal(inset(read(desktop + file), 12 / 128), size);
  }
});

it("Mac bundle frames and both runtime choices use the same padded canvas", () => {
  for (const file of ["macos/icon.png", "macos/icon-paper.png"])
    assert.equal(inset(read(desktop + file), 100 / 1024), 512);
  const icns = read(desktop + "icon.icns");
  let frames = 0;
  for (let offset = 8; offset < icns.length;) {
    const end = offset + icns.readUInt32BE(offset + 4);
    const frame = icns.subarray(offset + 8, end);
    if (frame.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") {
      inset(frame, 100 / 1024);
      frames++;
    }
    offset = end;
  }
  assert.equal(frames, 8);
});

it("web launchers have separate padded and maskable icons with the entire symbol in the safe zone", () => {
  const manifest = JSON.parse(read("apps/web/public/manifest.webmanifest").toString());
  for (const size of [192, 512]) {
    const any = manifest.icons.find(
      (i: { sizes: string; purpose: string }) =>
        i.sizes === `${size}x${size}` && i.purpose === "any",
    );
    const maskable = manifest.icons.find(
      (i: { sizes: string; purpose: string }) =>
        i.sizes === `${size}x${size}` && i.purpose === "maskable",
    );
    assert.ok(any && maskable);
    assert.notEqual(any.src, maskable.src);
    assert.equal(inset(read("apps/web/public" + any.src), 12 / 128), size);
    const { width, height, pixels } = png(read("apps/web/public" + maskable.src));
    assert.equal(width, size);
    assert.equal(height, size);
    let symbolPixels = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const offset = (y * size + x) * 4;
        assert.equal(pixels.readUInt8(offset + 3), 255);
        if (pixels.readUInt8(offset) > 128) {
          assert.ok(Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= size * 0.4);
          symbolPixels++;
        }
      }
    }
    assert.ok(symbolPixels > size * size * 0.03);
  }
});

it("iOS and the Apple touch icon remain opaque squares for system masking", () => {
  for (const file of [
    "apps/ios/Resources/Assets.xcassets/AppIcon.appiconset/Icon.png",
    "apps/ios/Resources/Assets.xcassets/AppIconPaper.appiconset/Icon.png",
    "apps/web/public/app-icon.png",
  ]) {
    const { width, height, pixels } = png(read(file));
    assert.equal(width, height);
    assert.equal(width, file.includes("xcassets") ? 1024 : 256);
    for (let offset = 3; offset < pixels.length; offset += 4)
      assert.equal(pixels.readUInt8(offset), 255);
  }
});
