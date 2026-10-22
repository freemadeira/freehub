/**
 * What each person starred in catalogs, and which links they've seen. It's
 * kept on the relay as a NIP-78 app data event, encrypted to themselves, so
 * every device agrees. A link someone else saved is new to them until it's
 * been on their screen, or they mark everything seen. No browser APIs here.
 */
import type { Link } from "@/lib/catalogs";
import type { Template } from "@/lib/model";
import { APP_DATA_KIND } from "@/lib/model";

export const CATALOGS_D = "freehub/catalogs";
/** Links seen out of order kept per catalog; older ones count as seen anyway. */
const MAX_SEEN = 500;
const MAX_STARS = 1000;
/** Stars taken off remembered, so an older device's copy can't put them back. */
const MAX_UNSTARRED = 200;

/** Whether a link is starred, as last changed on some device. */
export interface StarMark {
  id: string;
  starred: boolean;
  /** When it was starred or not, in milliseconds. */
  at: number;
}

/**
 * What someone has seen of one catalog: every link saved up to `upTo`, in
 * seconds, and those saved since that are in `seen`. `upTo` moves on as they
 * catch up, so `seen` stays short.
 */
export interface SeenMarks {
  upTo?: number;
  seen: string[];
}

export interface CatalogsDoc {
  /** When this person first kept marks, in seconds: older links were never news to them. */
  since?: number;
  seen: Record<string, SeenMarks>;
  stars: StarMark[];
}

export const NO_CATALOG_MARKS: CatalogsDoc = { seen: {}, stars: [] };

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...value }
    : {};
}

function time(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseStar(value: unknown): StarMark | undefined {
  const { id, starred, at } = record(value);
  const when = time(at);
  return typeof id === "string" && typeof starred === "boolean" && when
    ? { at: when, id, starred }
    : undefined;
}

export function parseCatalogsDoc(text: string): CatalogsDoc | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const fields = record(parsed);
  const seen: Record<string, SeenMarks> = {};
  for (const [catalog, marks] of Object.entries(record(fields.seen))) {
    const { upTo, seen: ids } = record(marks);
    seen[catalog] = { seen: strings(ids), upTo: time(upTo) };
  }
  return {
    seen,
    since: time(fields.since),
    stars: Array.isArray(fields.stars)
      ? fields.stars.flatMap((item: unknown) => parseStar(item) ?? [])
      : [],
  };
}

/** Each link's newest star mark, the starred and the latest unstarred kept. */
function newestStars(marks: StarMark[]): StarMark[] {
  const newest = new Map<string, StarMark>();
  for (const mark of marks) {
    const known = newest.get(mark.id);
    if (!known || mark.at > known.at) {
      newest.set(mark.id, mark);
    }
  }
  const all = [...newest.values()].toSorted((a, b) => a.at - b.at);
  return [
    ...all.filter((mark) => mark.starred).slice(-MAX_STARS),
    ...all.filter((mark) => !mark.starred).slice(-MAX_UNSTARRED),
  ].toSorted((a, b) => a.at - b.at);
}

export function serializeCatalogsDoc(doc: CatalogsDoc): string {
  const seen = Object.fromEntries(
    Object.entries(doc.seen)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([catalog, marks]) => [
        catalog,
        { seen: marks.seen.toSorted().slice(-MAX_SEEN), upTo: marks.upTo },
      ])
  );
  return JSON.stringify({
    seen,
    since: doc.since,
    stars: newestStars(doc.stars).map(({ id, starred, at }) => ({
      at,
      id,
      starred,
    })),
  });
}

/** Both copies' marks: the earliest start, the furthest caught up, every link seen, the newest star. */
export function mergeCatalogsDocs(a: CatalogsDoc, b: CatalogsDoc): CatalogsDoc {
  const seen: Record<string, SeenMarks> = { ...a.seen };
  for (const [catalog, marks] of Object.entries(b.seen)) {
    const other = seen[catalog];
    seen[catalog] = other
      ? {
          seen: [...new Set([...other.seen, ...marks.seen])],
          upTo: Math.max(other.upTo ?? 0, marks.upTo ?? 0) || undefined,
        }
      : marks;
  }
  const starts = [a.since, b.since].filter(
    (since): since is number => since !== undefined
  );
  return {
    seen,
    since: starts.length > 0 ? Math.min(...starts) : undefined,
    stars: newestStars([...a.stars, ...b.stars]),
  };
}

export function sameCatalogsDoc(a: CatalogsDoc, b: CatalogsDoc): boolean {
  return serializeCatalogsDoc(a) === serializeCatalogsDoc(b);
}

export function catalogsDocTemplate(content: string): Template {
  return { content, kind: APP_DATA_KIND, tags: [["d", CATALOGS_D]] };
}

/** The links starred, by id. */
export function starredLinks(doc: CatalogsDoc): ReadonlySet<string> {
  return new Set(
    newestStars(doc.stars)
      .filter((mark) => mark.starred)
      .map((mark) => mark.id)
  );
}

export function withStars(
  doc: CatalogsDoc,
  ids: readonly string[],
  starred: boolean,
  at: number
): CatalogsDoc {
  return {
    ...doc,
    stars: newestStars([
      ...doc.stars,
      ...ids.map((id) => ({ at, id, starred })),
    ]),
  };
}

/**
 * Up to when the person has seen everything in the catalog, in seconds:
 * where they caught up to, else up to just before they started keeping
 * marks or the catalog was made, whichever is later, so links saved in that
 * same second are still new. Nothing before marks are read.
 */
function seenUpTo(
  doc: CatalogsDoc,
  catalog: { id: string; createdAt: number }
): number | undefined {
  const marks = doc.seen[catalog.id];
  if (marks?.upTo !== undefined) {
    return marks.upTo;
  }
  return doc.since === undefined
    ? undefined
    : Math.max(doc.since, catalog.createdAt) - 1;
}

/** Whether the link is new to the person: saved by someone else since they last caught up, and not seen. */
export function isNewTo(
  doc: CatalogsDoc,
  catalog: { id: string; createdAt: number },
  link: Pick<Link, "id" | "savedAt" | "savedBy">,
  me: string
): boolean {
  const upTo = seenUpTo(doc, catalog);
  return (
    upTo !== undefined &&
    link.savedBy !== me &&
    link.savedAt > upTo &&
    !(doc.seen[catalog.id]?.seen.includes(link.id) ?? false)
  );
}

/**
 * Marks the links seen. What's seen in a row from the oldest unseen on moves
 * `upTo` along, so the list of those seen out of order stays short. Times
 * are in seconds, so it only moves past a second once every link saved in it
 * is seen.
 */
export function withSeen(
  doc: CatalogsDoc,
  catalog: { id: string; createdAt: number },
  links: readonly Pick<Link, "id" | "savedAt" | "savedBy">[],
  ids: readonly string[],
  me: string
): CatalogsDoc {
  const start = seenUpTo(doc, catalog);
  if (start === undefined) {
    return doc;
  }
  let upTo = start;
  const seen = new Set([...(doc.seen[catalog.id]?.seen ?? []), ...ids]);
  const later = links.filter((link) => link.savedAt > start);
  const seconds = [...new Set(later.map((link) => link.savedAt))].toSorted(
    (a, b) => a - b
  );
  for (const second of seconds) {
    const saved = later.filter((link) => link.savedAt === second);
    if (saved.some((link) => link.savedBy !== me && !seen.has(link.id))) {
      break;
    }
    upTo = second;
  }
  // Ones up to `upTo` are seen by it now.
  const caught = upTo;
  const settled = new Set(
    later.filter((link) => link.savedAt <= caught).map((link) => link.id)
  );
  return {
    ...doc,
    seen: {
      ...doc.seen,
      [catalog.id]: {
        seen: [...seen].filter((id) => !settled.has(id)),
        upTo,
      },
    },
  };
}

/** Everything in the catalog now counts as seen. */
export function withAllSeen(
  doc: CatalogsDoc,
  catalog: { id: string },
  now: number
): CatalogsDoc {
  return {
    ...doc,
    seen: { ...doc.seen, [catalog.id]: { seen: [], upTo: now } },
  };
}
