import type {
  BufferGeometry,
  Material,
  Object3D,
  PerspectiveCamera,
} from "three";
import {
  Box3,
  BufferAttribute,
  Sphere,
  BufferGeometry as Geometry,
  Frustum,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  SRGBColorSpace,
  Texture,
  Vector3,
} from "three";

import type { Frame, Square, TileId } from "./geo.ts";
import { ancestor, tileAt, tileKey, tileSquare } from "./geo.ts";
import type { HeightField } from "./heights.ts";
import type { Kit } from "./kit.ts";
import type { Materials } from "./materials.ts";
import { coastTexture } from "./materials.ts";
import type { MeshData } from "./mesh.ts";
import type { WorkerPool } from "./pool.ts";
import type { BuiltTile } from "./protocol.ts";
import { carSpots, createTraffic, disposeTraffic } from "./traffic.ts";
import type { Vehicles } from "./vehicles.ts";
import type { TreeKind } from "./worker/trees.ts";

const ROOT_ZOOM = 10;
const MAX_ZOOM = 16;
/** Refine while a texel covers more than this many pixels. */
const MAX_ERROR = 1.4;

type State = "empty" | "loading" | "ready" | "failed";

interface TileNode {
  readonly id: TileId;
  readonly key: string;
  readonly square: Square;
  readonly box: Box3;
  state: State;
  group?: Group;
  /** Its cars and people, drawn only while the camera is close enough. */
  traffic?: Mesh[];
  /** Where its cars are, in the tile, for how busy it sounds. */
  cars?: Float32Array;
  children?: TileNode[];
  /** The frame that last needed it, for the cache. */
  used: number;
  /** GPU memory it holds, roughly. */
  bytes: number;
}

/** Texture and buffer bytes of a built tile, mipmaps included. */
function bytesOf(built: BuiltTile): number {
  const textures = [built.ground, built.labels?.atlas].reduce(
    (sum, image) => sum + (image ? image.width * image.height * 4 * 1.34 : 0),
    0
  );
  const arrays = [
    ...[built.buildings, built.roads, built.structures, built.piers].flatMap(
      (mesh) => (mesh ? Object.values(mesh) : [])
    ),
    ...Object.values(built.terrain),
    built.coast?.data,
    built.traffic?.paths,
    built.traffic?.cars,
    built.traffic?.people,
    ...built.trees.flatMap((batch) => [batch.matrices, batch.colors]),
    ...(built.boats ?? []).flatMap((batch) => [batch.matrices, batch.colors]),
  ];
  const meshes = arrays.reduce(
    (sum: number, array: unknown) =>
      sum + (ArrayBuffer.isView(array) ? array.byteLength : 0),
    0
  );
  return textures + meshes;
}

function createNode(
  id: TileId,
  square: Square,
  low: number,
  high: number
): TileNode {
  return {
    // Trees and towers stand above the ground.
    box: new Box3(
      new Vector3(square.x, low - 10, square.z),
      new Vector3(square.x + square.size, high + 60, square.z + square.size)
    ),
    bytes: 0,
    id,
    key: tileKey(id),
    square,
    state: "empty",
    used: 0,
  };
}

function geometryOf(mesh: MeshData, walls: boolean): BufferGeometry {
  const geometry = new Geometry();
  geometry.setAttribute("position", new BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(mesh.normals, 3, true));
  geometry.setAttribute("color", new BufferAttribute(mesh.colors, 3, true));
  if (walls && mesh.facade && mesh.seeds) {
    geometry.setAttribute("facade", new BufferAttribute(mesh.facade, 4));
    geometry.setAttribute("seed", new BufferAttribute(mesh.seeds, 1, true));
  }
  geometry.setIndex(new BufferAttribute(mesh.indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export interface TileOptions {
  frame: Frame;
  field: HeightField;
  materials: Materials;
  kit: Kit;
  vehicles: Vehicles;
  /** Moored boats' material: shared, it rocks them on the water. */
  boat: Material;
  pool: WorkerPool;
  /** Side of the closest tiles' ground texture. */
  nearTexture: number;
  /** GPU memory the cached tiles may hold, in bytes. */
  budget: number;
  anisotropy: number;
  shadows: boolean;
}

/** Picks the tiles to draw for a view, builds them in workers and caches them. */
export class TileManager {
  readonly root = new Group();
  private readonly options: TileOptions;
  private readonly nodes = new Map<string, TileNode>();
  private readonly roots: TileNode[];
  private readonly frustum = new Frustum();
  private readonly matrix = new Matrix4();
  private frameNumber = 0;
  private loading = 0;
  private disposed = false;

  constructor(options: TileOptions) {
    this.options = options;
    this.root.name = "tiles";
    const { grid } = options.field;
    const northWest = tileAt(
      options.frame,
      { x: grid.x, z: grid.z },
      ROOT_ZOOM
    );
    const southEast = tileAt(
      options.frame,
      {
        x: grid.x + grid.width * grid.step,
        z: grid.z + grid.height * grid.step,
      },
      ROOT_ZOOM
    );
    this.roots = [];
    for (let { x } = northWest; x <= southEast.x; x += 1) {
      for (let { y } = northWest; y <= southEast.y; y += 1) {
        const node = this.node({ x, y, z: ROOT_ZOOM });
        if (node) {
          this.roots.push(node);
        }
      }
    }
  }

  /** A tile's node, or nothing for tiles that are only sea. */
  private node(id: TileId): TileNode | undefined {
    const key = tileKey(id);
    const existing = this.nodes.get(key);
    if (existing) {
      return existing;
    }
    const square = tileSquare(this.options.frame, id);
    const [low, high] = this.options.field.range(
      square.x,
      square.z,
      square.size
    );
    if (high <= 0) {
      return undefined;
    }
    const node = createNode(id, square, low, high);
    this.nodes.set(key, node);
    return node;
  }

  private childrenOf(node: TileNode): TileNode[] {
    if (!node.children) {
      const { x, y, z } = node.id;
      node.children = [
        { x: x * 2, y: y * 2, z: z + 1 },
        { x: x * 2 + 1, y: y * 2, z: z + 1 },
        { x: x * 2, y: y * 2 + 1, z: z + 1 },
        { x: x * 2 + 1, y: y * 2 + 1, z: z + 1 },
      ].flatMap((id) => {
        const child = this.node(id);
        return child ? [child] : [];
      });
    }
    return node.children;
  }

  /** How many pixels a texel of this tile covers on screen. */
  private error(
    node: TileNode,
    camera: PerspectiveCamera,
    focal: number
  ): number {
    const distance = Math.max(1, node.box.distanceToPoint(camera.position));
    const texture = node.id.z >= MAX_ZOOM ? this.options.nearTexture : 512;
    return ((node.square.size / texture) * focal) / distance;
  }

  update(camera: PerspectiveCamera, viewportHeight: number): void {
    this.frameNumber += 1;
    const focal = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    this.matrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    this.frustum.setFromProjectionMatrix(this.matrix);

    const shown = new Set<TileNode>();
    const wanted: { node: TileNode; priority: number }[] = [];
    const want = (node: TileNode) => {
      if (node.state === "empty") {
        const distance = node.box.distanceToPoint(camera.position);
        // Coarse tiles first, so the view fills in before it sharpens.
        wanted.push({ node, priority: node.id.z * 1e7 + distance });
      }
    };
    const visible = (node: TileNode) => this.frustum.intersectsBox(node.box);

    const visit = (node: TileNode) => {
      if (!visible(node)) {
        return;
      }
      node.used = this.frameNumber;
      const refine =
        node.id.z < MAX_ZOOM && this.error(node, camera, focal) > MAX_ERROR;
      if (refine) {
        const children = this.childrenOf(node).filter(visible);
        for (const child of children) {
          child.used = this.frameNumber;
          want(child);
        }
        if (
          children.every(
            (child) => child.state === "ready" || child.state === "failed"
          )
        ) {
          for (const child of children) {
            visit(child);
          }
          return;
        }
        if (node.state === "ready") {
          shown.add(node);
        } else {
          want(node);
        }
        return;
      }
      if (node.state === "ready") {
        shown.add(node);
        return;
      }
      want(node);
      // Zooming out: keep the finer tiles until this one is ready.
      const children = (node.children ?? []).filter(visible);
      if (
        children.length > 0 &&
        children.every((child) => child.state === "ready")
      ) {
        for (const child of children) {
          child.used = this.frameNumber;
          shown.add(child);
        }
      }
    };
    for (const root of this.roots) {
      visit(root);
    }

    for (const node of this.nodes.values()) {
      if (node.group) {
        node.group.visible = shown.has(node);
      }
    }
    for (const node of shown) {
      const distance = node.box.distanceToPoint(camera.position);
      for (const mesh of node.traffic ?? []) {
        mesh.visible = distance < (mesh.userData.far as number);
      }
    }

    const capacity = 6 - this.loading;
    for (const { node } of wanted
      .toSorted((a, b) => a.priority - b.priority)
      .slice(0, Math.max(0, capacity))) {
      this.load(node);
    }
    this.evict();
  }

  private async load(node: TileNode) {
    node.state = "loading";
    this.loading += 1;
    // The detail zoom's data tile, so neighbours share a worker's cache.
    const affinity = node.id.z >= 15 ? ancestor(node.id, 15) : node.id;
    try {
      const built = await this.options.pool.build(node.id, affinity);
      if (this.disposed) {
        built.ground.close();
        built.labels?.atlas.close();
        return;
      }
      this.attach(node, built);
      node.state = "ready";
    } catch (error) {
      node.state = "failed";
      console.warn(`Map tile ${node.key} failed:`, error);
    } finally {
      this.loading -= 1;
    }
  }

  private attach(node: TileNode, built: BuiltTile) {
    const { materials, kit } = this.options;
    const group = new Group();
    group.name = node.key;
    group.position.set(node.square.x, 0, node.square.z);
    group.visible = false;

    const texture = new Texture(built.ground);
    texture.colorSpace = SRGBColorSpace;
    texture.flipY = false;
    texture.anisotropy = this.options.anisotropy;
    texture.minFilter = LinearMipmapLinearFilter;
    texture.needsUpdate = true;

    const terrain = new Geometry();
    terrain.setAttribute(
      "position",
      new BufferAttribute(built.terrain.positions, 3)
    );
    terrain.setAttribute(
      "normal",
      new BufferAttribute(built.terrain.normals, 3, true)
    );
    terrain.setAttribute("uv", new BufferAttribute(built.terrain.uvs, 2));
    terrain.setIndex(new BufferAttribute(built.terrain.indices, 1));
    terrain.computeBoundingSphere();
    const coast = built.coast
      ? { scale: built.coast.scale, texture: coastTexture(built.coast) }
      : undefined;
    const ground = new Mesh(terrain, materials.terrain(texture, coast));
    ground.userData.coast = coast?.texture;
    ground.receiveShadow = this.options.shadows;
    ground.name = "terrain";
    group.add(ground);

    const solid = (
      mesh: MeshData | undefined,
      material: Material,
      name: string,
      walls = false
    ) => {
      if (!mesh) {
        return;
      }
      const geometry = geometryOf(mesh, walls);
      const object = new Mesh(geometry, material);
      object.name = name;
      object.castShadow = this.options.shadows && name !== "roads";
      object.receiveShadow = this.options.shadows;
      object.renderOrder = name === "roads" ? 1 : 2;
      group.add(object);
    };
    solid(built.roads, materials.roads, "roads");
    solid(built.buildings, materials.buildings, "buildings", true);
    solid(built.structures, materials.solid, "structures");
    solid(built.piers, materials.solid, "piers");

    for (const batch of built.trees) {
      const kind = batch.kind as TreeKind;
      const count = batch.colors.length / 3;
      const matrices = new InstancedBufferAttribute(batch.matrices, 16);
      const canopy = new InstancedMesh(
        kit.canopy[kind],
        materials.canopy,
        count
      );
      canopy.instanceMatrix = matrices;
      canopy.instanceColor = new InstancedBufferAttribute(batch.colors, 3);
      const trunk = new InstancedMesh(kit.trunk[kind], materials.trunk, count);
      trunk.instanceMatrix = matrices;
      for (const mesh of [canopy, trunk]) {
        mesh.castShadow = this.options.shadows;
        mesh.receiveShadow = this.options.shadows;
        mesh.name = `trees-${kind}`;
        mesh.renderOrder = 2;
        group.add(mesh);
      }
    }

    if (built.labels) {
      const atlas = new Texture(built.labels.atlas);
      atlas.colorSpace = SRGBColorSpace;
      atlas.flipY = false;
      atlas.anisotropy = this.options.anisotropy;
      atlas.minFilter = LinearMipmapLinearFilter;
      atlas.needsUpdate = true;
      const geometry = new Geometry();
      geometry.setAttribute(
        "position",
        new BufferAttribute(built.labels.positions, 3)
      );
      geometry.setAttribute("uv", new BufferAttribute(built.labels.uvs, 2));
      geometry.setIndex(new BufferAttribute(built.labels.indices, 1));
      geometry.computeBoundingSphere();
      const names = new Mesh(geometry, materials.label(atlas));
      names.name = "labels";
      names.renderOrder = 3;
      group.add(names);
    }

    if (built.lamps && built.lamps.length > 0) {
      const count = built.lamps.length / 4;
      const matrices = new Float32Array(count * 16);
      const matrix = new Matrix4();
      for (let index = 0; index < count; index += 1) {
        const at = index * 4;
        matrix.makeRotationY(built.lamps[at + 3] ?? 0);
        matrix.setPosition(
          built.lamps[at] ?? 0,
          built.lamps[at + 1] ?? 0,
          built.lamps[at + 2] ?? 0
        );
        matrix.toArray(matrices, index * 16);
      }
      const attribute = new InstancedBufferAttribute(matrices, 16);
      const poles = new InstancedMesh(kit.pole, materials.pole, count);
      poles.instanceMatrix = attribute;
      poles.castShadow = this.options.shadows;
      const bulbs = new InstancedMesh(kit.bulb, materials.bulb, count);
      bulbs.instanceMatrix = attribute;
      bulbs.name = "lamps";
      group.add(poles, bulbs);
    }

    for (const batch of built.boats ?? []) {
      const boats = new InstancedMesh(
        this.options.vehicles[batch.kind],
        this.options.boat,
        batch.colors.length / 3
      );
      boats.instanceMatrix = new InstancedBufferAttribute(batch.matrices, 16);
      boats.instanceColor = new InstancedBufferAttribute(batch.colors, 3);
      boats.castShadow = this.options.shadows;
      boats.receiveShadow = this.options.shadows;
      boats.name = "boats";
      group.add(boats);
    }

    if (built.traffic) {
      const bounds = node.box.getBoundingSphere(new Sphere());
      bounds.center.sub(group.position);
      node.traffic = createTraffic(
        built.traffic,
        this.options.vehicles,
        materials.shared,
        bounds
      );
      group.add(...node.traffic);
      node.cars = carSpots(built.traffic);
    }

    node.group = group;
    node.bytes = bytesOf(built);
    this.root.add(group);
  }

  private release(node: TileNode) {
    const { group } = node;
    if (!group) {
      return;
    }
    group.traverse((object: Object3D) => {
      if (object instanceof InstancedMesh) {
        object.dispose();
      } else if (object instanceof Mesh && object.name.startsWith("traffic-")) {
        disposeTraffic(object);
      } else if (object instanceof Mesh) {
        object.geometry.dispose();
        if (object.name === "terrain" || object.name === "labels") {
          const material = object.material as Material & { map?: Texture };
          material.map?.dispose();
          material.dispose();
          (object.userData.coast as Texture | undefined)?.dispose();
        }
      }
    });
    this.root.remove(group);
    node.group = undefined;
    node.traffic = undefined;
    node.cars = undefined;
    node.state = "empty";
  }

  /** Drops the tiles unused the longest until the cache fits its budget. */
  private evict() {
    const ready = [...this.nodes.values()].filter((node) => node.group);
    let total = ready.reduce((sum, node) => sum + node.bytes, 0);
    if (total <= this.options.budget) {
      return;
    }
    const stale = ready
      .filter((node) => node.used < this.frameNumber)
      .toSorted((a, b) => a.used - b.used);
    for (const node of stale) {
      if (total <= this.options.budget) {
        break;
      }
      total -= node.bytes;
      this.release(node);
    }
  }

  /**
   * The cars drawn around a point: each within `radius` counts, 1 right at
   * the point down to 0 at the edge.
   */
  carsNear(x: number, z: number, radius: number): number {
    const reach = radius * radius;
    let sum = 0;
    for (const node of this.nodes.values()) {
      const cars = node.traffic?.find((mesh) => mesh.name === "traffic-cars");
      const { square } = node;
      const dx = Math.max(square.x - x, 0, x - square.x - square.size);
      const dz = Math.max(square.z - z, 0, z - square.z - square.size);
      if (
        !node.cars ||
        !node.group?.visible ||
        !cars?.visible ||
        dx * dx + dz * dz > reach
      ) {
        continue;
      }
      for (let index = 0; index < node.cars.length; index += 2) {
        const ex = (node.cars[index] ?? 0) + square.x - x;
        const ez = (node.cars[index + 1] ?? 0) + square.z - z;
        const d2 = ex * ex + ez * ez;
        if (d2 < reach) {
          sum += 1 - d2 / reach;
        }
      }
    }
    return sum;
  }

  /** Tiles still being built. */
  get busy(): boolean {
    return this.loading > 0;
  }

  dispose(): void {
    this.disposed = true;
    for (const node of this.nodes.values()) {
      this.release(node);
    }
    this.nodes.clear();
  }
}
