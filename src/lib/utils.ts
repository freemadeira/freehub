import { npubEncode } from "applesauce-core/helpers/pointers";

export class TimeoutError extends Error {
  override name = "TimeoutError";
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(() => timeout.reject(new TimeoutError(message)), ms);
  try {
    return await Promise.race([promise, timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}

export function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<undefined>();
  setTimeout(resolve, ms);
  return promise;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function shortNpub(pubkey: string): string {
  const npub = npubEncode(pubkey);
  return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
}

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Storage blocked: state just won't survive a reload.
  }
}

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;
const fineSize = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const wholeSize = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 0,
});

/** A file's size as people read it, like "2.4 MB" or "820 KB". */
export function formatBytes(bytes: number): string {
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < BYTE_UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${(size < 10 ? fineSize : wholeSize).format(size)} ${BYTE_UNITS[unit]}`;
}
