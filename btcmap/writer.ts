import type { Osm, OsmElement } from "./osm";
import { refKey } from "./osm";
import type { Position, TagChange } from "./plan";

/** Most OpenStreetMap changes one run makes, so a wrong mapping can't rewrite every listing in one night. */
export const MAX_CHANGES = 50;

export type Change =
  | { kind: "edit"; changes: TagChange[] }
  | { kind: "move"; to: Position; changes: TagChange[] }
  | { kind: "delete" };

/** What became of one change: written, refused because the element changed since it was read, or left for the next run. */
export type Outcome = "written" | "conflict" | "over limit";

const CHANGESET_TAGS: Record<string, string> = {
  bot: "yes",
  comment:
    "Merchants checked in person: bitcoin acceptance, closed and relocated businesses",
  created_by: "Freehub-btcmap",
  source: "survey",
};

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "&#10;");
}

function tagsXml(tags: Record<string, string>): string {
  return Object.entries(tags)
    .map(([k, v]) => `<tag k="${escape(k)}" v="${escape(v)}"/>`)
    .join("");
}

/** The element's tags once the changes are made: a change without `to` takes the tag off. */
export function applyChanges(
  tags: Record<string, string>,
  changes: TagChange[]
): Record<string, string> {
  const next = { ...tags };
  for (const { key, to } of changes) {
    if (to === undefined) {
      delete next[key];
    } else {
      next[key] = to;
    }
  }
  return next;
}

/** One change as an osmChange document, for the element as it was read. */
export function osmChange(
  element: OsmElement,
  change: Change,
  changeset: number
): string {
  const { type, id, version } = element;
  const head = `id="${id}" version="${version}" changeset="${changeset}"`;
  const position = change.kind === "move" ? change.to : element.position;
  const at = position ? ` lat="${position.lat}" lon="${position.lon}"` : "";
  if (change.kind === "delete") {
    return `<osmChange version="0.6"><delete><${type} ${head}${at}/></delete></osmChange>`;
  }
  const tags = tagsXml(applyChanges(element.tags, change.changes));
  let inner = tags;
  if (type === "way") {
    if (!element.nodes) {
      throw new Error(`OSM ${refKey(element)}: the way's nodes weren't read`);
    }
    inner = element.nodes.map((ref) => `<nd ref="${ref}"/>`).join("") + tags;
  } else if (type === "relation") {
    if (!element.members) {
      throw new Error(
        `OSM ${refKey(element)}: the relation's members weren't read`
      );
    }
    inner =
      element.members
        .map(
          (m) =>
            `<member type="${m.type}" ref="${m.ref}" role="${escape(m.role)}"/>`
        )
        .join("") + tags;
  }
  return `<osmChange version="0.6"><modify><${type} ${head}${at}>${inner}</${type}></modify></osmChange>`;
}

/**
 * Writes the sync's changes to OpenStreetMap, as the account whose OAuth 2 token it holds:
 * one changeset per run, opened at the first change, and one upload per element, so an
 * element someone edited since it was read is refused alone and tried again next run.
 */
export class OsmWriter {
  private readonly osm: Osm;
  private readonly token: string;
  private changeset: number | undefined;
  private count = 0;

  constructor(osm: Osm, token: string) {
    this.osm = osm;
    this.token = token;
  }

  private request(method: string, path: string, body?: string) {
    return fetch(`${this.osm.api}/api/0.6/${path}`, {
      body,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "text/xml",
        "User-Agent": this.osm.userAgent,
      },
      method,
    });
  }

  private async open(): Promise<number> {
    if (this.changeset !== undefined) {
      return this.changeset;
    }
    const response = await this.request(
      "PUT",
      "changeset/create",
      `<osm><changeset>${tagsXml(CHANGESET_TAGS)}</changeset></osm>`
    );
    if (!response.ok) {
      throw new Error(
        `OSM changeset: HTTP ${response.status} ${await response.text()}`
      );
    }
    this.changeset = Number(await response.text());
    console.log(
      `Writing to OpenStreetMap in https://www.openstreetmap.org/changeset/${this.changeset}`
    );
    return this.changeset;
  }

  async apply(element: OsmElement, change: Change): Promise<Outcome> {
    if (this.count >= MAX_CHANGES) {
      return "over limit";
    }
    const changeset = await this.open();
    const response = await this.request(
      "POST",
      `changeset/${changeset}/upload`,
      osmChange(element, change, changeset)
    );
    // 409: the element's version moved on; 412: a way now uses the node. Both wait for the next run.
    if (response.status === 409 || response.status === 412) {
      return "conflict";
    }
    if (!response.ok) {
      throw new Error(
        `OSM ${refKey(element)}: HTTP ${response.status} ${await response.text()}`
      );
    }
    this.count += 1;
    return "written";
  }

  async close(): Promise<void> {
    if (this.changeset === undefined) {
      return;
    }
    const response = await this.request(
      "PUT",
      `changeset/${this.changeset}/close`
    );
    if (!response.ok) {
      console.error(
        `OSM changeset ${this.changeset} didn't close (HTTP ${response.status}); OpenStreetMap closes it after an hour anyway.`
      );
    }
    this.changeset = undefined;
  }
}
