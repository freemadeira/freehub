/** [x, y] in whatever plane the caller works in. */
export type Vec = [number, number];
/** Closed when the last point repeats the first. */
export type Ring = Vec[];

export interface Polygon {
  outer: Ring;
  holes: Ring[];
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Twice the signed area: positive when counterclockwise with y up. */
export function signedArea(ring: Ring): number {
  let sum = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index] ?? [0, 0];
    const [x2, y2] = ring[index + 1] ?? [0, 0];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

export function isClosed(ring: Ring): boolean {
  const [first] = ring;
  const last = ring.at(-1);
  return (
    first !== undefined &&
    last !== undefined &&
    ring.length > 3 &&
    first[0] === last[0] &&
    first[1] === last[1]
  );
}

export function close(ring: Ring): Ring {
  const [first] = ring;
  return first && !isClosed(ring) ? [...ring, [first[0], first[1]]] : ring;
}

export function boxOf(points: Iterable<Vec>): Box {
  const box = {
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
  };
  for (const [x, y] of points) {
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
  }
  return box;
}

export function centroid(ring: Ring): Vec {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x1, y1] = ring[index] ?? [0, 0];
    const [x2, y2] = ring[index + 1] ?? [0, 0];
    const cross = x1 * y2 - x2 * y1;
    area += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(area) < 1e-18) {
    const box = boxOf(ring);
    return [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2];
  }
  return [cx / (3 * area), cy / (3 * area)];
}

export function pointInRing([x, y]: Vec, ring: Ring): boolean {
  let inside = false;
  let previous = ring.at(-1) ?? [0, 0];
  for (const current of ring) {
    const [xi, yi] = current;
    const [xj, yj] = previous;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
    previous = current;
  }
  return inside;
}

function squaredSegmentDistance(point: Vec, from: Vec, to: Vec): number {
  let [x, y] = from;
  let dx = to[0] - x;
  let dy = to[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      [x, y] = to;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

/** Douglas–Peucker, keeping both ends. */
export function simplify(points: Vec[], tolerance: number): Vec[] {
  if (points.length <= 2 || tolerance <= 0) {
    return points;
  }
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const limit = tolerance * tolerance;
  while (stack.length > 0) {
    const [first, last] = stack.pop() ?? [0, 0];
    let farthest = 0;
    let index = -1;
    for (let at = first + 1; at < last; at += 1) {
      const distance = squaredSegmentDistance(
        points[at] ?? [0, 0],
        points[first] ?? [0, 0],
        points[last] ?? [0, 0]
      );
      if (distance > farthest) {
        farthest = distance;
        index = at;
      }
    }
    if (index !== -1 && farthest > limit) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, index) => keep[index] === 1);
}

type Edge = "left" | "right" | "top" | "bottom";

function onInnerSide([x, y]: Vec, edge: Edge, box: Box): boolean {
  switch (edge) {
    case "left": {
      return x >= box.minX;
    }
    case "right": {
      return x <= box.maxX;
    }
    case "top": {
      return y >= box.minY;
    }
    default: {
      return y <= box.maxY;
    }
  }
}

function crossing(from: Vec, to: Vec, edge: Edge, box: Box): Vec {
  const [x1, y1] = from;
  const [x2, y2] = to;
  if (edge === "left" || edge === "right") {
    const x = edge === "left" ? box.minX : box.maxX;
    return [x, y1 + ((y2 - y1) * (x - x1)) / (x2 - x1)];
  }
  const y = edge === "top" ? box.minY : box.maxY;
  return [x1 + ((x2 - x1) * (y - y1)) / (y2 - y1), y];
}

/**
 * Sutherland–Hodgman against a box. Concave rings may come back with
 * zero-width slivers along the box edge, which fill exactly like the original.
 */
export function clipRing(ring: Ring, box: Box): Ring {
  let output = ring.slice(0, -1);
  for (const edge of ["left", "right", "top", "bottom"] as const) {
    const input = output;
    output = [];
    for (let index = 0; index < input.length; index += 1) {
      const current = input[index] ?? [0, 0];
      const previous = input[(index + input.length - 1) % input.length] ?? [
        0, 0,
      ];
      const currentInside = onInnerSide(current, edge, box);
      if (currentInside) {
        if (!onInnerSide(previous, edge, box)) {
          output.push(crossing(previous, current, edge, box));
        }
        output.push(current);
      } else if (onInnerSide(previous, edge, box)) {
        output.push(crossing(previous, current, edge, box));
      }
    }
    if (output.length === 0) {
      return [];
    }
  }
  return output.length >= 3 ? close(output) : [];
}

function outcode([x, y]: Vec, box: Box): number {
  let code = 0;
  if (x < box.minX) {
    code += 1;
  } else if (x > box.maxX) {
    code += 2;
  }
  if (y < box.minY) {
    code += 4;
  } else if (y > box.maxY) {
    code += 8;
  }
  return code;
}

function sharesSide(a: number, b: number): boolean {
  for (const bit of [1, 2, 4, 8]) {
    if (Math.floor(a / bit) % 2 === 1 && Math.floor(b / bit) % 2 === 1) {
      return true;
    }
  }
  return false;
}

/** Cohen–Sutherland for one segment; undefined when it misses the box. */
function clipSegment(from: Vec, to: Vec, box: Box): [Vec, Vec] | undefined {
  let [x1, y1] = from;
  let [x2, y2] = to;
  let code1 = outcode(from, box);
  let code2 = outcode(to, box);
  for (let step = 0; step < 8; step += 1) {
    if (code1 === 0 && code2 === 0) {
      return [
        [x1, y1],
        [x2, y2],
      ];
    }
    if (sharesSide(code1, code2)) {
      return undefined;
    }
    const code = code1 === 0 ? code2 : code1;
    let x = 0;
    let y = 0;
    if (code >= 8) {
      x = x1 + ((x2 - x1) * (box.maxY - y1)) / (y2 - y1);
      y = box.maxY;
    } else if (code >= 4) {
      x = x1 + ((x2 - x1) * (box.minY - y1)) / (y2 - y1);
      y = box.minY;
    } else if (code >= 2) {
      y = y1 + ((y2 - y1) * (box.maxX - x1)) / (x2 - x1);
      x = box.maxX;
    } else {
      y = y1 + ((y2 - y1) * (box.minX - x1)) / (x2 - x1);
      x = box.minX;
    }
    if (code === code1) {
      x1 = x;
      y1 = y;
      code1 = outcode([x1, y1], box);
    } else {
      x2 = x;
      y2 = y;
      code2 = outcode([x2, y2], box);
    }
  }
  return undefined;
}

/** A line cut to a box, as the pieces that fall inside. */
export function clipLine(line: Vec[], box: Box): Vec[][] {
  const pieces: Vec[][] = [];
  let current: Vec[] = [];
  for (let index = 0; index < line.length - 1; index += 1) {
    const from = line[index] ?? [0, 0];
    const to = line[index + 1] ?? [0, 0];
    const segment = clipSegment(from, to, box);
    if (!segment) {
      if (current.length > 1) {
        pieces.push(current);
      }
      current = [];
      continue;
    }
    const [start, end] = segment;
    const last = current.at(-1);
    if (!last || last[0] !== start[0] || last[1] !== start[1]) {
      if (current.length > 1) {
        pieces.push(current);
      }
      current = [start];
    }
    current.push(end);
    // Leaving the box ends this piece.
    if (end[0] !== to[0] || end[1] !== to[1]) {
      pieces.push(current);
      current = [];
    }
  }
  if (current.length > 1) {
    pieces.push(current);
  }
  return pieces;
}

/** Points every `spacing` along a line, ends included. */
export function sampleLine(line: Vec[], spacing: number): Vec[] {
  const points: Vec[] = [];
  let carry = 0;
  for (let index = 0; index < line.length - 1; index += 1) {
    const [x1, y1] = line[index] ?? [0, 0];
    const [x2, y2] = line[index + 1] ?? [0, 0];
    const length = Math.hypot(x2 - x1, y2 - y1);
    let at = carry;
    while (at <= length) {
      const t = length === 0 ? 0 : at / length;
      points.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t]);
      at += spacing;
    }
    carry = at - length;
  }
  return points;
}
