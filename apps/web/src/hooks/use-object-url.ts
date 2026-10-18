import { useEffect, useState } from "react";

/** A temporary address for a blob, released when the blob changes or the caller unmounts. */
export function useObjectURL(blob: Blob | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const address = URL.createObjectURL(blob);
    setUrl(address);
    return () => URL.revokeObjectURL(address);
  }, [blob]);
  return url;
}
