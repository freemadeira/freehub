import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
} from "postprocessing";
import type { Material, Mesh, Texture } from "three";
import {
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  LinearFilter,
  NoColorSpace,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  TextureLoader,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

import { Aerialways } from "./aerialways.ts";
import type { View } from "./controls.ts";
import { MapControls } from "./controls.ts";
import { Ferries } from "./ferries.ts";
import type { Camera, LngLat, WorldManifest } from "./format.ts";
import { WORLD_FORMAT } from "./format.ts";
import type { Frame } from "./geo.ts";
import { createFrame, toLngLat, toLocal } from "./geo.ts";
import { HeightField } from "./heights.ts";
import type { Kit } from "./kit.ts";
import { createKit } from "./kit.ts";
import { addLandmarkBadges, addPlaceLabels, LABEL_STYLES } from "./labels.ts";
import { Landmarks } from "./landmarks.ts";
import type { Materials } from "./materials.ts";
import { createMaterials } from "./materials.ts";
import type { Marker, MarkerOptions } from "./overlay.ts";
import { Overlay } from "./overlay.ts";
import { Planes } from "./planes.ts";
import { WorkerPool } from "./pool.ts";
import type { Quality } from "./protocol.ts";
import { createSeaUniforms } from "./sea.ts";
import { TileManager } from "./tiles.ts";
import type { Vehicles } from "./vehicles.ts";
import { createVehicles, vehicleMaterial } from "./vehicles.ts";
import { createWater } from "./water.ts";

export type Theme = "day" | "night";

export interface MapEngineOptions {
  container: HTMLElement;
  /** URL of the world pack's `world.json`. */
  world: string;
  theme?: Theme;
  /** Skips animated camera moves and theme fades. */
  reducedMotion?: boolean;
  /** A click (not a drag) on the ground. */
  onClick?: (position: LngLat) => void;
  /** The camera moved; heading in degrees clockwise from north. */
  onViewChange?: (view: { heading: number; distance: number }) => void;
}

const RADIANS = Math.PI / 180;
/** Low sun from the south-east, so shadows fall back and to the left. */
const SUN = new Vector3(0.55, 0.78, 0.42).normalize();

const LOOK = {
  day: {
    hemisphere: 2,
    sky: new Color().setHex(0xd4_eb_fa, SRGBColorSpace),
    sun: 2.25,
  },
  night: {
    hemisphere: 1.4,
    sky: new Color().setHex(0x08_10_26, SRGBColorSpace),
    sun: 0.9,
  },
};

const HIGH: Quality & { pixelRatio: number; shadows: boolean; budget: number } =
  {
    boats: 1,
    budget: 700 * 2 ** 20,
    cars: 1,
    lamps: true,
    nearTexture: 1024,
    people: 1,
    pixelRatio: 2,
    shadows: true,
    treeSpacing: 1,
  };
const LOW: typeof HIGH = {
  boats: 0.5,
  budget: 260 * 2 ** 20,
  cars: 0.5,
  lamps: true,
  nearTexture: 512,
  people: 0.35,
  pixelRatio: 1.5,
  shadows: false,
  treeSpacing: 1.5,
};

async function loadManifest(url: string): Promise<WorldManifest> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(
      `The map's world pack isn't at ${url} (HTTP ${response.status}).`
    );
  }
  const manifest = (await response.json()) as WorldManifest;
  if (manifest.format !== WORLD_FORMAT) {
    throw new Error(
      `The world pack is format ${manifest.format}; this app reads format ${WORLD_FORMAT}. Bake it again.`
    );
  }
  return manifest;
}

function toView(frame: Frame, manifest: WorldManifest): View {
  const { x, z } = toLocal(frame, manifest.view);
  return {
    distance: manifest.view.distance,
    heading: manifest.view.heading * RADIANS,
    pitch: manifest.view.pitch * RADIANS,
    x,
    z,
  };
}

/** The 3D map: one per container, framework-free. */
export class MapEngine {
  readonly manifest: WorldManifest;
  private readonly options: MapEngineOptions;
  private readonly frame: Frame;
  private readonly field: HeightField;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(32, 1, 1, 50_000);
  private readonly controls: MapControls;
  private readonly materials: Materials;
  private readonly kit: Kit;
  private readonly vehicles: Vehicles;
  private readonly pool: WorkerPool;
  private readonly tiles: TileManager;
  private readonly overlay: Overlay;
  private readonly landmarks: Landmarks;
  private readonly aerialways: Aerialways;
  private readonly planes: Planes;
  private readonly ferries: Ferries;
  /** Moored boats', shared by every tile. */
  private readonly boatMaterial: Material;
  private readonly water: Mesh;
  private readonly seaMap: Texture;
  private readonly sun = new DirectionalLight(0xff_f3_e4, LOOK.day.sun);
  private readonly hemisphere = new HemisphereLight(
    0xe2_f0_ff,
    0xd8_cd_b8,
    LOOK.day.hemisphere
  );
  private readonly fog: Fog;
  private readonly composer: EffectComposer;
  private readonly bloom: BloomEffect;
  private readonly timer = new Timer();
  private readonly resizer: ResizeObserver;
  private readonly style: HTMLStyleElement;
  private readonly size = new Vector2(1, 1);
  private readonly target = new Vector3();
  private night = 0;
  private nightGoal = 0;
  /** Seconds of life on the map, from a start that varies by the hour. */
  private life = (Date.now() / 1000) % 3600;
  private animation = 0;
  private disposed = false;

  private constructor(
    options: MapEngineOptions,
    manifest: WorldManifest,
    field: HeightField,
    sea: Texture,
    quality: typeof HIGH
  ) {
    this.options = options;
    this.manifest = manifest;
    this.field = field;
    this.frame = createFrame(manifest.origin);
    const { container } = options;
    const base = new URL(options.world, window.location.href).href;

    this.renderer = new WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, quality.pixelRatio)
    );
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.tabIndex = 0;
    canvas.setAttribute("role", "application");
    canvas.setAttribute("aria-roledescription", "map");
    canvas.setAttribute(
      "aria-label",
      `Map of ${manifest.name}. Drag to move, scroll to zoom, arrow keys to pan.`
    );
    Object.assign(canvas.style, {
      display: "block",
      height: "100%",
      outline: "none",
      touchAction: "none",
      width: "100%",
    });
    container.append(canvas);

    this.style = document.createElement("style");
    this.style.textContent = LABEL_STYLES;
    container.append(this.style);

    const ground = (x: number, z: number) => field.sample(x, z);
    this.overlay = new Overlay(this.frame, ground);
    container.append(this.overlay.element);

    this.seaMap = sea;
    this.materials = createMaterials(createSeaUniforms(manifest.sea, sea));
    this.kit = createKit();
    this.vehicles = createVehicles();
    this.boatMaterial = vehicleMaterial(this.materials.shared, { bob: true });
    this.fog = new Fog(LOOK.day.sky.clone(), 4000, 60_000);
    this.scene.fog = this.fog;
    this.scene.background = LOOK.day.sky.clone();

    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 3;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.4;
    this.scene.add(this.sun, this.sun.target, this.hemisphere);

    const { grid } = field;
    this.controls = new MapControls(
      canvas,
      this.camera,
      ground,
      {
        maxDistance: 75_000,
        maxPitch: 1.45,
        maxX: grid.x + grid.width * grid.step,
        maxZ: grid.z + grid.height * grid.step,
        minDistance: 140,
        minX: grid.x,
        minZ: grid.z,
      },
      toView(this.frame, manifest)
    );
    this.controls.onClick = (x, y) => {
      const position = this.pick(x, y);
      if (position) {
        options.onClick?.(position);
      }
    };

    this.water = createWater(this.materials);
    this.scene.add(this.water);

    const clear = manifest.landmarks.map((landmark) => ({
      ...toLocal(this.frame, landmark),
      radius: landmark.clear,
    }));
    this.pool = new WorkerPool(
      Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)),
      { clear, manifest, quality, type: "init", url: base }
    );
    this.tiles = new TileManager({
      anisotropy: Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
      boat: this.boatMaterial,
      budget: quality.budget,
      field,
      frame: this.frame,
      kit: this.kit,
      materials: this.materials,
      nearTexture: quality.nearTexture,
      pool: this.pool,
      shadows: quality.shadows,
      vehicles: this.vehicles,
    });
    this.scene.add(this.tiles.root);

    this.landmarks = new Landmarks(
      manifest.landmarks,
      this.frame,
      base,
      ground,
      this.materials.shared
    );
    this.scene.add(this.landmarks.group);
    this.aerialways = new Aerialways(
      manifest.aerialways,
      this.frame,
      ground,
      this.materials
    );
    this.scene.add(this.aerialways.group);

    this.planes = new Planes(
      manifest.airports ?? [],
      this.frame,
      ground,
      this.vehicles.plane,
      this.materials.shared,
      quality.shadows
    );
    this.ferries = new Ferries(
      manifest.ferries ?? [],
      this.frame,
      manifest.bounds,
      manifest.sea,
      ground,
      this.vehicles.ferry,
      this.materials.shared,
      quality.shadows
    );
    this.scene.add(this.planes.group, this.ferries.group);

    addPlaceLabels(this.overlay, manifest.places);
    const badges = addLandmarkBadges(this.overlay, manifest.landmarks, base);
    // Badges sit just over their model once its height is known.
    this.landmarks.onLoad = (id, top) => {
      const badge =
        badges[manifest.landmarks.findIndex((item) => item.id === id)];
      badge?.setPosition(toLngLat(this.frame, top));
      badge?.setLift(top.y - Math.max(0, field.sample(top.x, top.z)) + 6);
    };

    this.bloom = new BloomEffect({
      intensity: 1.2,
      luminanceSmoothing: 0.2,
      luminanceThreshold: 0.62,
      mipmapBlur: true,
      radius: 0.72,
    });
    this.composer = new EffectComposer(this.renderer, {
      multisampling: Math.min(4, this.renderer.capabilities.maxSamples),
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new EffectPass(this.camera, this.bloom));

    this.setTheme(options.theme ?? "day", false);
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(container);
    this.resize();
    this.timer.connect(document);
    this.animation = requestAnimationFrame(this.tick);
  }

  static async create(options: MapEngineOptions): Promise<MapEngine> {
    const url = new URL(options.world, window.location.href).href;
    const manifest = await loadManifest(url);
    const [field, sea] = await Promise.all([
      HeightField.load(
        manifest.heights,
        new URL(manifest.heights.url, url).href
      ),
      new TextureLoader().loadAsync(new URL(manifest.sea.url, url).href),
    ]);
    sea.colorSpace = NoColorSpace;
    sea.minFilter = LinearFilter;
    sea.generateMipmaps = false;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    return new MapEngine(options, manifest, field, sea, coarse ? LOW : HIGH);
  }

  private resize() {
    const { clientWidth, clientHeight } = this.options.container;
    const width = Math.max(1, clientWidth);
    const height = Math.max(1, clientHeight);
    this.size.set(width, height);
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private readonly tick = (time: number) => {
    if (this.disposed) {
      return;
    }
    this.animation = requestAnimationFrame(this.tick);
    this.timer.update(time);
    const delta = Math.min(0.1, this.timer.getDelta());
    const seconds = this.timer.getElapsed();
    this.materials.shared.uTime.value = seconds;
    if (!this.options.reducedMotion) {
      this.life += delta;
    }
    this.materials.shared.uLife.value = this.options.reducedMotion
      ? 0
      : this.life;
    this.fadeTheme(delta);
    if (this.controls.update(delta)) {
      this.options.onViewChange?.({
        distance: this.controls.view.distance,
        heading: (((this.controls.view.heading / RADIANS) % 360) + 360) % 360,
      });
    }
    const { view } = this.controls;
    this.target.set(view.x, this.controls.targetHeight, view.z);
    this.placeSun(view);
    this.fog.near = view.distance * 1.8 + 1500;
    this.fog.far = view.distance * 7 + 25_000;
    this.tiles.update(this.camera, this.size.y);
    this.landmarks.update(this.camera.position.x, this.camera.position.z);
    this.aerialways.update(seconds, this.camera.position, this.target);
    const frozen = this.options.reducedMotion ?? false;
    this.planes.update(this.life, this.camera.position, frozen);
    this.ferries.update(this.life, this.camera.position, frozen);
    this.overlay.update(this.camera, this.size.x, this.size.y);
    if (this.night > 0.01) {
      this.bloom.intensity = 2 * this.night;
      this.composer.render(delta);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  };

  /** The sun's shadow box follows the view, snapped so shadows don't crawl. */
  private placeSun(view: View) {
    const extent = Math.min(2600, Math.max(160, view.distance * 0.95));
    const texel = (extent * 2) / this.sun.shadow.mapSize.x;
    const x = Math.round(view.x / texel) * texel;
    const z = Math.round(view.z / texel) * texel;
    const y = this.controls.targetHeight;
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + SUN.x * 6000, y + SUN.y * 6000, z + SUN.z * 6000);
    const shadow = this.sun.shadow.camera;
    if (shadow.right !== extent) {
      shadow.left = -extent;
      shadow.right = extent;
      shadow.top = extent;
      shadow.bottom = -extent;
      shadow.near = 100;
      shadow.far = 14_000;
      shadow.updateProjectionMatrix();
    }
  }

  private fadeTheme(delta: number) {
    if (this.night !== this.nightGoal) {
      const step = this.options.reducedMotion ? 1 : delta * 1.6;
      this.night =
        this.night < this.nightGoal
          ? Math.min(this.nightGoal, this.night + step)
          : Math.max(this.nightGoal, this.night - step);
    }
    const t = this.night;
    this.materials.shared.uNight.value = t;
    const sky = (this.scene.background as Color)
      .copy(LOOK.day.sky)
      .lerp(LOOK.night.sky, t);
    this.fog.color.copy(sky);
    this.sun.intensity = LOOK.day.sun + (LOOK.night.sun - LOOK.day.sun) * t;
    this.hemisphere.intensity =
      LOOK.day.hemisphere + (LOOK.night.hemisphere - LOOK.day.hemisphere) * t;
    this.overlay.element.toggleAttribute("data-night", t > 0.5);
  }

  setTheme(theme: Theme, animate = true): void {
    this.nightGoal = theme === "night" ? 1 : 0;
    if (!animate) {
      this.night = this.nightGoal;
    }
  }

  /** A DOM element kept over a place; it moves with the map. */
  addMarker(
    element: HTMLElement,
    position: LngLat,
    options?: MarkerOptions
  ): Marker {
    return this.overlay.add(element, position, options);
  }

  /**
   * Flies to a place. `offset` puts it that many pixels from the middle of the
   * map, to leave room for whatever covers the rest, like a side sheet.
   */
  flyTo(
    position: LngLat & { distance?: number },
    options: { duration?: number; offset?: number } = {}
  ): void {
    const { x, z } = toLocal(this.frame, position);
    const distance =
      position.distance ?? Math.min(this.controls.view.distance, 1600);
    // Meters per pixel where the camera looks, along the screen's right.
    const meters =
      (2 * distance * Math.tan((this.camera.fov * RADIANS) / 2)) / this.size.y;
    const shift = -(options.offset ?? 0) * meters;
    const { heading } = this.controls.view;
    this.controls.flyTo(
      {
        distance,
        x: x + Math.cos(heading) * shift,
        z: z + Math.sin(heading) * shift,
      },
      this.options.reducedMotion ? 0 : (options.duration ?? 1100)
    );
  }

  /** Moves the camera; angles in degrees, as in the world pack's `view`. */
  setView(view: Partial<Camera>, duration = 0): void {
    const target: Partial<View> = {};
    if (view.lat !== undefined && view.lng !== undefined) {
      Object.assign(
        target,
        toLocal(this.frame, { lat: view.lat, lng: view.lng })
      );
    }
    if (view.distance !== undefined) {
      target.distance = view.distance;
    }
    if (view.pitch !== undefined) {
      target.pitch = view.pitch * RADIANS;
    }
    if (view.heading !== undefined) {
      target.heading = view.heading * RADIANS;
    }
    this.controls.flyTo(target, this.options.reducedMotion ? 0 : duration);
  }

  /** True once every tile the view asked for is built. */
  get idle(): boolean {
    return !this.tiles.busy;
  }

  /** Turns the map back to north up. */
  resetNorth(): void {
    this.controls.flyTo({ heading: 0 }, this.options.reducedMotion ? 0 : 600);
  }

  /** The ground under a point of the screen, if any. */
  pick(clientX: number, clientY: number): LngLat | undefined {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    const direction = new Vector3(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
      0.5
    )
      .unproject(this.camera)
      .sub(this.camera.position)
      .normalize();
    const origin = this.camera.position;
    const above = (t: number) => {
      const x = origin.x + direction.x * t;
      const z = origin.z + direction.z * t;
      return origin.y + direction.y * t - Math.max(0, this.field.sample(x, z));
    };
    const step = Math.max(2, this.controls.view.distance / 250);
    const limit = this.controls.view.distance * 8;
    let previous = 0;
    for (let t = step; t < limit; t += step) {
      if (above(t) > 0) {
        previous = t;
        continue;
      }
      let low = previous;
      let high = t;
      for (let round = 0; round < 12; round += 1) {
        const middle = (low + high) / 2;
        if (above(middle) > 0) {
          low = middle;
        } else {
          high = middle;
        }
      }
      return toLngLat(this.frame, {
        x: origin.x + direction.x * high,
        z: origin.z + direction.z * high,
      });
    }
    return undefined;
  }

  setCursor(cursor: string): void {
    this.renderer.domElement.style.cursor = cursor;
  }

  focus(): void {
    this.renderer.domElement.focus({ preventScroll: true });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    this.resizer.disconnect();
    this.controls.dispose();
    this.timer.dispose();
    this.pool.dispose();
    this.tiles.dispose();
    this.landmarks.dispose();
    this.aerialways.dispose();
    this.planes.dispose();
    this.ferries.dispose();
    this.boatMaterial.dispose();
    this.overlay.dispose();
    this.composer.dispose();
    this.kit.dispose();
    this.vehicles.dispose();
    this.materials.dispose();
    this.water.geometry.dispose();
    for (const material of [this.water.material].flat()) {
      material.dispose();
    }
    this.seaMap.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.style.remove();
  }
}
