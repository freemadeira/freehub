/**
 * References to things in the app, written with `#` in comments: the writer
 * picks something from the list and sees `#Its title` while writing, and the
 * comment keeps the thing's address, which shows as what it goes to. No
 * browser APIs here.
 */

const SYNTAX = /[$()*+.?[\\\]^{|}]/gu;

/** Something picked from the `#` list while writing, by the label shown. */
export interface PickedRef {
  label: string;
  /** Its full address in the app. */
  url: string;
}

/**
 * Turns every `#Label` the writer picked into its address. Longer labels
 * win, so `#Launch plan v2` is never read as `#Launch plan`, and a label the
 * writer edited after picking it stays plain text.
 */
export function encodeRefs(text: string, picked: readonly PickedRef[]): string {
  const byLabel = new Map<string, string>();
  for (const { label, url } of picked) {
    if (label && !byLabel.has(label)) {
      byLabel.set(label, url);
    }
  }
  if (byLabel.size === 0) {
    return text;
  }
  const labels = [...byLabel.keys()]
    .toSorted((a, b) => b.length - a.length)
    .map((label) => label.replaceAll(SYNTAX, String.raw`\$&`));
  const pattern = new RegExp(
    `#(?<label>${labels.join("|")})(?![\\p{L}\\p{N}_])`,
    "gu"
  );
  return text.replace(
    pattern,
    (whole, label: string) => byLabel.get(label) ?? whole
  );
}

/**
 * The label a pick goes into the text with: its title, unless the text has
 * that `#Label` for something else already, when a number tells them apart.
 */
export function labelFor(
  title: string,
  url: string,
  text: string,
  picked: readonly PickedRef[]
): string {
  const free = (label: string) =>
    !text.includes(`#${label}`) ||
    picked.some((pick) => pick.label === label && pick.url === url);
  let label = title;
  for (let count = 2; !free(label); count += 1) {
    label = `${title} (${count})`;
  }
  return label;
}
