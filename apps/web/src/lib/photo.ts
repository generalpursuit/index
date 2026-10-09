/** Profile photos are stored as squares of this size. */
const size = 512;

/**
 * Crops a picked image to its centered square and shrinks it to 512×512, so uploads stay
 * small and every avatar is framed the same way. WebP where the browser can encode it.
 */
export async function squarePhoto(file: Blob): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas
    .getContext("2d")!
    .drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
  bitmap.close();
  const encode = (type: string) =>
    new Promise<Blob | null>((done) => canvas.toBlob(done, type, 0.86));
  const blob = (await encode("image/webp")) ?? (await encode("image/jpeg"));
  if (!blob) throw new Error("This image could not be read.");
  // Browsers without WebP encoding hand back PNG; JPEG is smaller then.
  const photo = blob.type === "image/png" ? ((await encode("image/jpeg")) ?? blob) : blob;
  return new File([photo], "photo", { type: photo.type });
}
