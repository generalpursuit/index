/** Normalize Tauri's random ICNS HashMap order without reencoding any image/mask. */
export function orderedIcns(data: Buffer): Buffer {
  if (
    data.length < 8 ||
    data.toString("ascii", 0, 4) !== "icns" ||
    data.readUInt32BE(4) !== data.length
  )
    throw new Error("Invalid generated ICNS header.");
  const elements: Buffer[] = [];
  for (let offset = 8; offset < data.length;) {
    if (offset + 8 > data.length) throw new Error("Truncated generated ICNS element.");
    const length = data.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > data.length)
      throw new Error("Invalid generated ICNS element length.");
    elements.push(data.subarray(offset, offset + length));
    offset += length;
  }
  if (!elements.length) throw new Error("Empty generated ICNS family.");
  // ICNS image/mask references use four-byte types, not element positions.
  elements.sort((a, b) => Buffer.compare(a.subarray(0, 4), b.subarray(0, 4)));
  return Buffer.concat([data.subarray(0, 8), ...elements]);
}
