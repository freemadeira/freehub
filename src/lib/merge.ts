import { diffIndices } from "node-diff3";

/** Lines `start` to `end` of the base, replaced by `lines` on one side. */
interface Hunk {
  mine: boolean;
  start: number;
  end: number;
  lines: string[];
}

function hunks(base: string[], edited: string[], mine: boolean): Hunk[] {
  return diffIndices(base, edited).map(({ buffer1, buffer2 }) => ({
    end: buffer1[0] + buffer1[1],
    lines: edited.slice(buffer2[0], buffer2[0] + buffer2[1]),
    mine,
    start: buffer1[0],
  }));
}

// Edits clash when they change the same lines, or add lines at the same
// place. Edits to neighbouring lines don't: ticking off two items next to
// each other in a list keeps both.
function clash(a: { start: number; end: number }, b: Hunk): boolean {
  const aAdds = a.start === a.end;
  const bAdds = b.start === b.end;
  if (aAdds && bAdds) {
    return a.start === b.start;
  }
  if (aAdds) {
    return b.start < a.start && a.start < b.end;
  }
  if (bAdds) {
    return a.start < b.start && b.start < a.end;
  }
  return a.start < b.end && b.start < a.end;
}

// The base lines from `start` to `end`, with one side's edits in that stretch.
function side(base: string[], group: Hunk[], start: number, end: number) {
  const lines: string[] = [];
  let at = start;
  for (const hunk of group) {
    lines.push(...base.slice(at, hunk.start), ...hunk.lines);
    at = hunk.end;
  }
  lines.push(...base.slice(at, end));
  return lines;
}

/**
 * Two edits of the same text, made from `base` without seeing each other,
 * merged line by line: each side's edits to different lines are kept, and
 * lines both added at the same place are all kept.
 *
 * Where both changed the same lines, `keepMine` keeps this side's version.
 * Without it, the pick depends only on the two versions, so two devices
 * merging the same pair of versions end up with the same text.
 */
export function mergeText(
  base: string,
  mine: string,
  theirs: string,
  keepMine: boolean
): string {
  if (mine === base || mine === theirs) {
    return theirs;
  }
  if (theirs === base) {
    return mine;
  }
  const original = base.split("\n");
  const all = [
    ...hunks(original, mine.split("\n"), true),
    ...hunks(original, theirs.split("\n"), false),
  ].toSorted((a, b) => a.start - b.start || a.end - b.end);

  // Hunks that clash, directly or through another, are settled together.
  const groups: { start: number; end: number; hunks: Hunk[] }[] = [];
  for (const hunk of all) {
    const group = groups.at(-1);
    if (group && clash(group, hunk)) {
      group.start = Math.min(group.start, hunk.start);
      group.end = Math.max(group.end, hunk.end);
      group.hunks.push(hunk);
    } else {
      groups.push({ end: hunk.end, hunks: [hunk], start: hunk.start });
    }
  }

  const merged: string[] = [];
  let at = 0;
  for (const { start, end, hunks: group } of groups) {
    merged.push(...original.slice(at, start));
    at = end;
    const ours = side(
      original,
      group.filter((hunk) => hunk.mine),
      start,
      end
    );
    const other = side(
      original,
      group.filter((hunk) => !hunk.mine),
      start,
      end
    );
    const both =
      group.some((hunk) => hunk.mine) && group.some((hunk) => !hunk.mine);
    if (!both || ours.join("\n") === other.join("\n")) {
      merged.push(...(group.some((hunk) => hunk.mine) ? ours : other));
      continue;
    }
    const oursFirst = !keepMine && ours.join("\n") < other.join("\n");
    const [first, last] = oursFirst ? [ours, other] : [other, ours];
    merged.push(...(start === end ? [...first, ...last] : last));
  }
  merged.push(...original.slice(at));
  return merged.join("\n");
}
