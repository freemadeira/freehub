/**
 * Writes src/lib/font-families.json: every family Bunny Fonts serves, most
 * used first as Google Fonts counts it, with its category and upright
 * weights. The brand typeface picker searches it; run `pnpm fonts` now and
 * then to pick up new families.
 *
 * Bunny Fonts mirrors Google Fonts without telling Google who's looking, so
 * that's where brand pages load them from. Google's own catalog only orders them.
 */
import { writeFile } from "node:fs/promises";

interface BunnyFamily {
  familyName: string;
  category: string;
  weights: number[];
  styles: string[];
}

interface GoogleFamily {
  family: string;
  popularity: number;
}

const CATEGORIES: Record<string, string> = {
  display: "Display",
  handwriting: "Handwriting",
  monospace: "Monospace",
  "sans-serif": "Sans Serif",
  serif: "Serif",
};

async function json<T>(url: string, prefix?: RegExp): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  const body = await response.text();
  return JSON.parse(prefix ? body.replace(prefix, "") : body) as T;
}

const bunny = await json<Record<string, BunnyFamily>>(
  "https://fonts.bunny.net/list"
);
// It has been served behind an anti-hijacking prefix before.
const { familyMetadataList: google } = await json<{
  familyMetadataList: GoogleFamily[];
}>("https://fonts.google.com/metadata/fonts", /^\)\]\}'/u);
const rank = new Map(
  google.map((family) => [family.family, family.popularity])
);

const rows = Object.values(bunny)
  .filter((family) => family.weights.length > 0)
  .toSorted(
    (a, b) =>
      (rank.get(a.familyName) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.familyName) ?? Number.MAX_SAFE_INTEGER) ||
      a.familyName.localeCompare(b.familyName)
  )
  .map((family) => [
    family.familyName,
    CATEGORIES[family.category] ?? "Display",
    family.weights.toSorted((a, b) => a - b),
  ]);

await writeFile(
  new URL("../src/lib/font-families.json", import.meta.url),
  `${JSON.stringify(rows)}\n`
);
console.log(`${rows.length} families`);
