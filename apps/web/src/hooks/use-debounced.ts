import { useEffect, useState } from "react";
export function useDebounced<T>(value: T, delay = 250) {
  const [result, setResult] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setResult(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return result;
}
