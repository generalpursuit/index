// What a paste or a drop brings to a message. Each reads its data during the event, as the
// browser hides it afterwards.

/**
 * Files to attach from a paste; none lets the text paste. Office, Numbers and Pages put a
 * picture of copied text beside it; Finder puts the files' names; "Copy Image" puts its address.
 */
export function pastedFiles(data: DataTransfer) {
  const files = [...data.files];
  const text = data.getData("text/plain").trim();
  if (!files.length || !text || !files.every((file) => file.type.startsWith("image/")))
    return files;
  const names = new Set(files.map((file) => file.name));
  const naming = text
    .split(/\r\n?|\n/)
    .every((line) => names.has(line.trim().split(/[\\/]/).pop()!));
  return naming || /^\S+:\/\/\S+$/.test(text) ? files : [];
}

/** Dropped files without folders, which arrive as files that can't be read. */
export function droppedFiles(data: DataTransfer) {
  return [...data.items].flatMap((item) => {
    // Only a known folder is skipped: files dropped by a script have no file system entry.
    if (item.kind !== "file" || item.webkitGetAsEntry()?.isDirectory) return [];
    const file = item.getAsFile();
    return file ? [file] : [];
  });
}

/** A dropped address (the first of a URI list), else dropped text. */
export function droppedText(data: DataTransfer) {
  const address = data
    .getData("text/uri-list")
    .split(/\r?\n/)
    .find((line) => line && !line.startsWith("#"));
  return (address || data.getData("text/plain")).trim();
}
