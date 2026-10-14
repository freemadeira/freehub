import type { PerspectiveCamera } from "three";
import { Frustum, Group, Matrix4, Vector3 } from "three";

import { CarBatch } from "./car-batch.ts";
import type { Car, Lane, Move } from "./driving.ts";
import {
  accelerate,
  advance,
  BRAKE,
  BUS_ROADS,
  clash,
  contested,
  desiredSpeed,
  endOf,
  eta,
  FLOW,
  gapAhead,
  KINDS,
  laneKey,
  lanesOf,
  leave,
  lengthOf,
  placeCar,
  prepareTurn,
  startOf,
  wanted,
} from "./driving.ts";
import type { SharedUniforms } from "./materials.ts";
import type { RoadGraphData } from "./protocol.ts";
import { generator } from "./random.ts";
import type { Placement, RoadEdge, RoadNode } from "./road-network.ts";
import { bendSpeed, laneOffset, placeOn, RoadNetwork } from "./road-network.ts";
import type { Vehicles } from "./vehicles.ts";

/** Meters from the camera where cars fade out; past it they aren't drawn. */
const FADE = [700, 1300] as const;
/** Meters out from a junction where cars count as coming up to it. */
const COMING = 45;
/** Seconds ahead a bigger road's car makes a smaller road's wait. */
const YIELD = 3;
/** Seconds waited before a car goes anyway, so nothing jams for good. */
const PATIENCE = 9;
/** Seconds between topping up or thinning out the traffic. */
const TEND = 0.5;

export interface CarOptions {
  vehicles: Vehicles;
  shared: SharedUniforms;
  /** Multiplies how many cars there are. */
  density: number;
  shadows: boolean;
}

/**
 * Cars driving the roads of the closest tiles. Each follows the car ahead,
 * slows for bends and turns, waits its turn at junctions, picks a way on at
 * every node, and comes and goes only out of sight, out of tunnel mouths, or
 * where the roads in play end.
 */
export class Cars {
  readonly group = new Group();
  private readonly network = new RoadNetwork();
  private readonly lanes = new Map<string, Lane>();
  private readonly cars = new Set<Car>();
  private readonly batches: CarBatch[];
  private readonly density: number;
  private readonly random = generator(0.4142);
  private readonly frustum = new Frustum();
  private readonly matrix = new Matrix4();
  private readonly point = new Vector3();
  private readonly camera = new Vector3();
  private readonly scratch: Placement = {
    heading: 0,
    pitch: 0,
    x: 0,
    y: 0,
    z: 0,
  };
  /** Junctions with cars coming up to them this step. */
  private readonly approached: RoadNode[] = [];
  private clock = 0;
  private tended = 0;
  /** 0 by day to 1 at night, when half as many are out. */
  private night = 0;
  /** Cars the lanes in play hold at the busiest time of day. */
  private target = 0;

  constructor(options: CarOptions) {
    this.density = options.density;
    this.group.name = "cars";
    this.batches = KINDS.map(
      (kind) =>
        new CarBatch(
          options.vehicles[kind.shape],
          options.shared,
          kind.tints,
          options.shadows
        )
    );
    this.group.add(...this.batches.map((batch) => batch.mesh));
  }

  /** The roads in play: the closest tiles' graphs, by tile. */
  sync(tiles: Map<string, RoadGraphData>): void {
    let changed = false;
    for (const key of this.network.keys()) {
      if (!tiles.has(key)) {
        this.network.remove(key);
        changed = true;
      }
    }
    const added: RoadEdge[] = [];
    for (const [key, data] of tiles) {
      if (!this.network.has(key)) {
        added.push(...this.network.add(key, data));
        changed = true;
      }
    }
    if (changed) {
      this.forgetGone();
      this.populate(added);
    }
  }

  /** Drops the lanes of tiles gone, their cars, and plans that led there. */
  private forgetGone() {
    for (const [key, lane] of this.lanes) {
      if (!lane.edge.alive) {
        for (const car of lane.cars.splice(0)) {
          this.remove(car);
        }
        this.lanes.delete(key);
      }
    }
    for (const car of this.cars) {
      if (car.next && !car.next.edge.alive) {
        car.next = undefined;
        car.move = undefined;
        car.cleared = false;
        car.signal = 0;
      }
      if (car.from && !car.from.lane.edge.alive) {
        car.from = undefined;
      }
    }
  }

  /** New roads come in far off: fills them as they'd be. */
  private populate(edges: RoadEdge[]) {
    const fresh: Lane[] = [];
    for (const edge of edges) {
      for (const forward of [true, false]) {
        for (let index = 0; index < lanesOf(edge, forward); index += 1) {
          fresh.push(this.laneFor(edge, forward, index));
        }
      }
    }
    this.target = 0;
    for (const lane of this.lanes.values()) {
      this.target += wanted(lane, this.density);
    }
    for (const lane of fresh) {
      const count = Math.floor(
        wanted(lane, this.density) * this.busy() + this.random()
      );
      const spots = Array.from(
        { length: count },
        () => this.random() * lane.edge.length
      ).toSorted((a, b) => b - a);
      let last = Number.POSITIVE_INFINITY;
      for (const s of spots) {
        if (last - s > 12) {
          this.spawn(lane, s, false);
          last = s;
        }
      }
    }
  }

  private laneFor(edge: RoadEdge, forward: boolean, index: number): Lane {
    const key = laneKey(edge, forward, index);
    let lane = this.lanes.get(key);
    if (!lane) {
      lane = {
        arrive: placeOn(edge, forward, edge.length, 0, this.scratch).heading,
        cars: [],
        edge,
        forward,
        index,
        leave: placeOn(edge, forward, 0, 0, this.scratch).heading,
        right: laneOffset(edge, forward, index),
      };
      this.lanes.set(key, lane);
    }
    return lane;
  }

  /** Share of the busiest time's traffic out now. */
  private busy(): number {
    return 1 - 0.5 * this.night;
  }

  private spawn(lane: Lane, s: number, rising: boolean) {
    const flow = FLOW[lane.edge.kind];
    if (!flow) {
      return;
    }
    // Mostly cars, some vans, and buses on the main roads.
    let kind = 0;
    const roll = this.random();
    if (roll > 0.94 && BUS_ROADS.has(lane.edge.kind)) {
      kind = 2;
    } else if (roll > 0.8) {
      kind = 1;
    }
    const pace = 0.85 + 0.3 * this.random();
    const car: Car = {
      accel: 0,
      braking: false,
      cleared: false,
      kind,
      lane,
      limit: 30,
      pace,
      phase: this.random() * 0.9,
      placed: { heading: 0, pitch: 0, x: 0, y: 0, z: 0 },
      reach: 0,
      rising,
      s,
      scale: 1,
      signal: 0,
      speed: Math.min(flow.speed * pace, bendSpeed(lane.edge, lane.forward, s)),
      tint: Math.floor(this.random() * 8),
      waited: 0,
    };
    // Into its lane in order, the car furthest along first.
    const at = lane.cars.findIndex((other) => other.s < s);
    lane.cars.splice(at === -1 ? lane.cars.length : at, 0, car);
    this.cars.add(car);
    placeCar(car, this.scratch);
  }

  private remove(car: Car) {
    const { cars } = car.lane;
    const at = cars.indexOf(car);
    if (at !== -1) {
      cars.splice(at, 1);
    }
    this.cars.delete(car);
    leave(endOf(car.lane), car);
    leave(startOf(car.lane), car);
  }

  /** Picks the way on at the end of a car's lane, or none where roads end. */
  private choose(car: Car): Lane | undefined {
    const { lane } = car;
    const node = endOf(lane);
    const bus = KINDS[car.kind]?.shape === "bus";
    let total = 0;
    const options: { lane: Lane; weight: number }[] = [];
    for (const { edge, forward } of node.ends) {
      const lanes = lanesOf(edge, forward);
      const flow = FLOW[edge.kind];
      if (edge.alive && lanes > 0 && edge !== lane.edge && flow) {
        const next = this.laneFor(
          edge,
          forward,
          Math.min(lane.index, lanes - 1)
        );
        const straight = Math.cos(next.leave - lane.arrive);
        const weight =
          flow.weight *
          (bus && !BUS_ROADS.has(edge.kind) ? 0.05 : 1) *
          (0.15 + 0.85 * ((1 + straight) / 2) ** 2);
        options.push({ lane: next, weight });
        total += weight;
      }
    }
    if (options.length === 0) {
      // A dead end: turn round, if the road runs both ways.
      const back = lanesOf(lane.edge, !lane.forward) > 0;
      return node.open || node.portal || !back
        ? undefined
        : this.laneFor(lane.edge, !lane.forward, 0);
    }
    let pick = this.random() * total;
    for (const option of options) {
      pick -= option.weight;
      if (pick <= 0) {
        return option.lane;
      }
    }
    return options.at(-1)?.lane;
  }

  /** The way across, for a car that's picked its next lane at a junction. */
  private moveOf(car: Car, to: Lane): Move | undefined {
    const from = car.lane;
    if (!contested(from, to)) {
      return undefined;
    }
    const node = endOf(from);
    const before = placeOn(
      from.edge,
      from.forward,
      Math.max(0, from.edge.length - 4),
      from.right,
      this.scratch
    );
    const enter = Math.atan2(before.z - node.z, before.x - node.x);
    const after = placeOn(
      to.edge,
      to.forward,
      Math.min(4, to.edge.length),
      to.right,
      this.scratch
    );
    return {
      from,
      in: enter,
      node,
      out: Math.atan2(after.z - node.z, after.x - node.x),
      rank: FLOW[from.edge.kind]?.weight ?? 1,
      to,
    };
  }

  /**
   * Clears a car across the junction ahead once it's close enough that it
   * would otherwise have to brake for it: when nothing crossing gets in its
   * way, there's room on the far side, and no car from a bigger road is
   * about to arrive across its path.
   */
  private ask(car: Car): void {
    const { move } = car;
    if (!move || car.cleared) {
      return;
    }
    const stop = car.lane.edge.length - car.s - car.reach - 1.5;
    if (stop > (car.speed * car.speed) / (2 * BRAKE) + 3) {
      return;
    }
    const last = move.to.cars.at(-1);
    const room = !last || last.s > lengthOf(last) + 3;
    const against = (other: object) => {
      const them = other as Car;
      return (
        them !== car &&
        this.cars.has(them) &&
        them.move !== undefined &&
        clash(move, them.move)
      );
    };
    const blocked = move.node.crossing.some(against);
    const yields = move.node.coming.some(
      (other) =>
        against(other) &&
        ((other as Car).move?.rank ?? 0) > move.rank &&
        eta(other as Car) < YIELD
    );
    if ((room && !blocked && !yields) || car.waited > PATIENCE) {
      car.cleared = true;
      move.node.crossing.push(car);
    }
  }

  /** Lanes cars can come from unseen: out of tunnels and in from the edge. */
  private sources(): Lane[] {
    const result: Lane[] = [];
    for (const lane of this.lanes.values()) {
      const node = startOf(lane);
      if ((node.portal || node.open) && node.ends.length === 1) {
        result.push(lane);
      }
    }
    return result;
  }

  private seen(placed: Placement): boolean {
    this.point.set(placed.x, placed.y, placed.z);
    return (
      this.point.distanceTo(this.camera) < FADE[1] &&
      this.frustum.containsPoint(this.point)
    );
  }

  /** Brings a car in where nobody sees it come: a tunnel, an edge, or afar. */
  private bringOne(lanes: Lane[], sources: Lane[]) {
    const source =
      sources.length > 0 && this.random() < 0.5
        ? sources[Math.floor(this.random() * sources.length)]
        : undefined;
    if (source) {
      const first = source.cars.at(-1);
      const mouth = startOf(source);
      placeOn(source.edge, source.forward, 0, source.right, this.scratch);
      // Out of a tunnel in plain view, or in from the edge unseen.
      if (
        (mouth.portal || !this.seen(this.scratch)) &&
        (!first || first.s > 15)
      ) {
        this.spawn(source, 0, mouth.portal);
      }
      return;
    }
    const lane = lanes[Math.floor(this.random() * lanes.length)] as Lane;
    const s = this.random() * lane.edge.length;
    placeOn(lane.edge, lane.forward, s, lane.right, this.scratch);
    const clear = lane.cars.every((other) => Math.abs(other.s - s) > 15);
    if (clear && wanted(lane, 1) > 0 && !this.seen(this.scratch)) {
      this.spawn(lane, s, false);
    }
  }

  /** Keeps the roads about as busy as they should be, out of sight. */
  private tend(): void {
    const goal = this.target * this.busy();
    const lanes = [...this.lanes.values()];
    if (lanes.length === 0) {
      return;
    }
    if (this.cars.size < goal - 1) {
      const sources = this.sources();
      for (let round = 0; round < 12 && this.cars.size < goal; round += 1) {
        this.bringOne(lanes, sources);
      }
      return;
    }
    let removed = 0;
    for (const car of this.cars) {
      if (this.cars.size <= goal + 3 || removed >= 8) {
        break;
      }
      if (!this.seen(car.placed)) {
        this.remove(car);
        removed += 1;
      }
    }
  }

  /**
   * Moves the cars on by `delta` seconds; frozen, they stay put. `night`
   * goes from 0 by day to 1 at night, when fewer are out.
   */
  update(
    delta: number,
    camera: PerspectiveCamera,
    frozen: boolean,
    night: number
  ): void {
    this.camera.copy(camera.position);
    this.matrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.matrix);
    this.night = night;
    if (!frozen && delta > 0) {
      this.clock += delta;
      this.step(Math.min(delta, 0.1));
      if (this.clock - this.tended > TEND) {
        this.tended = this.clock;
        this.tend();
      }
    }
    this.draw();
  }

  /** Who's coming up to each junction, afresh. */
  private gather() {
    for (const node of this.approached) {
      node.coming.length = 0;
    }
    this.approached.length = 0;
    for (const car of this.cars) {
      const { move } = car;
      if (move && !car.cleared && car.lane.edge.length - car.s < COMING) {
        if (move.node.coming.length === 0) {
          this.approached.push(move.node);
        }
        move.node.coming.push(car);
      }
    }
  }

  /** How a car means to drive this step: its next turn, and its pace. */
  private decide(car: Car, index: number) {
    const { lane } = car;
    if (!car.next && lane.edge.length - car.s < Math.max(40, car.speed * 4)) {
      car.next = this.choose(car);
      car.move = car.next ? this.moveOf(car, car.next) : undefined;
      car.cleared = false;
      if (car.next) {
        prepareTurn(car, car.next);
      }
    }
    this.ask(car);
    const { gap, speed } = gapAhead(car, index);
    car.accel = accelerate(
      car.speed,
      desiredSpeed(car),
      gap,
      car.speed - speed
    );
  }

  private step(delta: number): void {
    this.gather();
    // Decide first, from where everyone was; then move.
    for (const lane of this.lanes.values()) {
      for (const [index, car] of lane.cars.entries()) {
        this.decide(car, index);
      }
    }
    const leaving: Car[] = [];
    for (const car of this.cars) {
      const before = car.speed;
      car.speed = Math.max(0, car.speed + car.accel * delta);
      car.braking = car.accel < -0.8 || (car.speed < 0.3 && before < 0.5);
      car.waited = car.speed < 0.5 ? car.waited + delta : 0;
      car.s += car.speed * delta;
      if (car.from && car.s > car.from.reach + 2) {
        leave(startOf(car.lane), car);
        car.from = undefined;
        car.move = undefined;
        car.cleared = false;
      }
      if (car.s >= car.lane.edge.length && !advance(car)) {
        leaving.push(car);
      }
    }
    for (const car of leaving) {
      this.remove(car);
    }
  }

  private draw(): void {
    const { camera } = this;
    for (const car of this.cars) {
      const { placed } = car;
      // Far off, where it was last will do.
      const ax = placed.x - camera.x;
      const az = placed.z - camera.z;
      if (ax * ax + az * az <= (FADE[1] + 100) ** 2) {
        placeCar(car, this.scratch);
        const dx = placed.x - camera.x;
        const dy = placed.y - camera.y;
        const dz = placed.z - camera.z;
        // oxlint-disable-next-line unicorn/prefer-modern-math-apis -- hypot is ten times slower, and this runs for every car every frame
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        this.point.set(placed.x, placed.y, placed.z);
        if (
          distance < FADE[1] &&
          (distance < 30 || this.frustum.containsPoint(this.point))
        ) {
          const fade = Math.min(
            1,
            Math.max(0, (FADE[1] - distance) / (FADE[1] - FADE[0]))
          );
          this.batches[car.kind]?.push(
            placed,
            car.scale * fade * fade * (3 - 2 * fade),
            car.tint,
            (car.braking ? 1 : 0) + car.signal + car.phase
          );
        }
      }
    }
    for (const batch of this.batches) {
      batch.flush();
    }
  }

  /**
   * The cars around a point: each within `radius` counts, 1 right at the
   * point down to 0 at the edge.
   */
  near(x: number, z: number, radius: number): number {
    const reach = radius * radius;
    let sum = 0;
    for (const car of this.cars) {
      const dx = car.placed.x - x;
      const dz = car.placed.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < reach) {
        sum += 1 - d2 / reach;
      }
    }
    return sum;
  }

  dispose(): void {
    for (const batch of this.batches) {
      batch.dispose();
    }
  }
}
