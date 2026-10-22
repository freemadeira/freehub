import { useEffect, useState } from "react";

/** Text typed, trimmed, a moment after the typing stops; empty at once when cleared. */
export function useSettled(value: string, delay: number): string {
  const [settled, setSettled] = useState(() => value.trim());
  // Cleared, it's cleared now, so what's typed next doesn't bring back the old words.
  if (!value.trim() && settled !== "") {
    setSettled("");
  }
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value.trim()), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return value.trim() ? settled : "";
}
