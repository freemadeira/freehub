import { sleep } from "@/lib/utils";

export type ElementType = "node" | "way" | "relation";

export interface ElementRef {
  type: ElementType;
  id: number;
}

export interface OsmElement extends ElementRef {
  version: number;
  tags: Record<string, string>;
  /** A node's position; ways and relations have none of their own. */
  position?: { lat: number; lon: number };
}

export interface Candidate extends ElementRef {
  name: string;
  lat: number;
  lon: number;
}

/** Where OpenStreetMap's API and Overpass are, and how the sync introduces itself to them. */
export interface Osm {
  api: string;
  overpass: string;
  userAgent: string;
}

/** Gap between OSM API reads, to stay well inside its usage policy. */
const READ_INTERVAL = 1000;

const LINK = /openstreetmap\.org\/(?<type>node|way|relation)\/(?<id>\d+)/u;

export function parseOsmLink(link: string | undefined): ElementRef | undefined {
  const match = LINK.exec(link ?? "");
  const type = match?.groups?.type as ElementType | undefined;
  const id = Number(match?.groups?.id);
  return type && Number.isSafeInteger(id) ? { id, type } : undefined;
}

export function refKey({ type, id }: ElementRef): string {
  return `${type}/${id}`;
}

export function osmUrl(ref: ElementRef): string {
  return `https://www.openstreetmap.org/${refKey(ref)}`;
}

/** One read of the OSM API, paced. */
async function read(osm: Osm, path: string): Promise<Response> {
  await sleep(READ_INTERVAL);
  return fetch(`${osm.api}/api/0.6/${path}`, {
    headers: { "User-Agent": osm.userAgent },
  });
}

/** The element as OSM has it now, or "gone" when it was deleted. */
export async function fetchElement(
  osm: Osm,
  ref: ElementRef
): Promise<OsmElement | "gone"> {
  const response = await read(osm, `${refKey(ref)}.json`);
  if (response.status === 404 || response.status === 410) {
    return "gone";
  }
  if (!response.ok) {
    throw new Error(`OSM ${refKey(ref)}: HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    elements?: {
      version?: number;
      tags?: Record<string, string>;
      lat?: number;
      lon?: number;
    }[];
  };
  const element = body.elements?.[0];
  if (!element || typeof element.version !== "number") {
    throw new Error(`OSM ${refKey(ref)}: unexpected answer`);
  }
  const { lat, lon } = element;
  return {
    ...ref,
    position: lat !== undefined && lon !== undefined ? { lat, lon } : undefined,
    tags: element.tags ?? {},
    version: element.version,
  };
}

/** Whether a way or relation uses the node, in which case OSM won't let it be deleted. */
export async function nodeInUse(osm: Osm, ref: ElementRef): Promise<boolean> {
  if (ref.type !== "node") {
    return true;
  }
  for (const parent of ["ways", "relations"]) {
    // oxlint-disable-next-line no-await-in-loop -- one OSM read at a time, per its usage policy
    const response = await read(osm, `${refKey(ref)}/${parent}.json`);
    if (!response.ok) {
      throw new Error(`OSM ${refKey(ref)}/${parent}: HTTP ${response.status}`);
    }
    // oxlint-disable-next-line no-await-in-loop -- one OSM read at a time, per its usage policy
    const body = (await response.json()) as { elements?: unknown[] };
    if ((body.elements?.length ?? 0) > 0) {
      return true;
    }
  }
  return false;
}

/** Everything in the area tagged as taking bitcoin, from the Overpass API. `area` is south,west,north,east. */
export async function bitcoinElements(
  osm: Osm,
  area: string
): Promise<Candidate[]> {
  const query = `[out:json][timeout:90];
(
  nwr["currency:XBT"="yes"](${area});
  nwr["payment:bitcoin"="yes"](${area});
  nwr["payment:lightning"="yes"](${area});
  nwr["payment:onchain"="yes"](${area});
);
out center tags;`;
  const response = await fetch(osm.overpass, {
    body: new URLSearchParams({ data: query }),
    headers: { "User-Agent": osm.userAgent },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Overpass: HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    remark?: string;
    elements?: {
      type: ElementType;
      id: number;
      lat?: number;
      lon?: number;
      center?: { lat: number; lon: number };
      tags?: Record<string, string>;
    }[];
  };
  // A query Overpass cut short still answers 200, with part of the answer and a remark.
  if (body.remark) {
    throw new Error(`Overpass: ${body.remark}`);
  }
  return (body.elements ?? []).flatMap((element) => {
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (lat === undefined || lon === undefined) {
      return [];
    }
    return [
      {
        id: element.id,
        lat,
        lon,
        name: element.tags?.name ?? "",
        type: element.type,
      },
    ];
  });
}
