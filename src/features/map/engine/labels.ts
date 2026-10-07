import type { Landmark, Place } from "./format.ts";
import type { Marker, Overlay } from "./overlay.ts";

/**
 * Engine-owned styles, scoped to the map's container so the engine works
 * without the app's stylesheet.
 */
export const LABEL_STYLES = `
.fhm-label {
  color: #3a4560;
  font: 600 12px/1.15 var(--fhm-font, system-ui, sans-serif);
  letter-spacing: 0.01em;
  pointer-events: none;
  text-shadow: 0 0 2px #fff, 0 0 3px #fff, 0 0 6px rgb(255 255 255 / 0.9);
  transform: translate(-50%, -100%);
  user-select: none;
  white-space: nowrap;
}
.fhm-label[data-kind="city"] { font-size: 15px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.fhm-label[data-kind="town"] { font-size: 13.5px; font-weight: 650; }
.fhm-label[data-kind="suburb"] { color: #5b6680; font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.fhm-label[data-kind="peak"] { color: #6b5a4c; font-size: 11px; }
.fhm-label[data-kind="peak"]::before { content: "▲ "; font-size: 8px; vertical-align: 1px; }
.fhm-label small { display: block; font-size: 10px; font-weight: 500; opacity: 0.75; text-align: center; }
.fhm-badge {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: 3px;
  pointer-events: none;
  transform: translate(-50%, -100%);
  user-select: none;
}
.fhm-badge-image {
  background: #fff center / cover;
  border: 3px solid #fff;
  border-radius: 999px;
  box-shadow: 0 2px 6px rgb(40 50 80 / 0.28);
  height: 46px;
  width: 46px;
}
.fhm-badge-name {
  color: #3a4560;
  font: 800 10.5px/1.1 var(--fhm-font, system-ui, sans-serif);
  letter-spacing: 0.06em;
  text-align: center;
  text-shadow: 0 0 2px #fff, 0 0 3px #fff, 0 0 6px rgb(255 255 255 / 0.9);
  text-transform: uppercase;
  white-space: nowrap;
}
.fhm-overlay[data-night] .fhm-label,
.fhm-overlay[data-night] .fhm-badge-name {
  color: #eef2ff;
  text-shadow: 0 0 2px #0b1430, 0 0 4px #0b1430, 0 0 8px rgb(11 20 48 / 0.9);
}
.fhm-overlay[data-night] .fhm-label[data-kind="peak"] { color: #d9d2ff; }
.fhm-overlay[data-night] .fhm-badge-image { border-color: #e9ecff; }
`;

/** Shown within these distances from the camera, by kind of place. */
const REACH: Record<Place["kind"], number> = {
  city: 120_000,
  hamlet: 3000,
  locality: 3000,
  peak: 16_000,
  suburb: 5000,
  town: 32_000,
  village: 11_000,
};

export function addPlaceLabels(overlay: Overlay, places: Place[]): Marker[] {
  return places.map((place) => {
    const element = document.createElement("div");
    element.className = "fhm-label";
    element.dataset.kind = place.kind;
    element.textContent = place.name;
    if (place.kind === "peak" && place.ele !== undefined) {
      const height = document.createElement("small");
      height.textContent = `${Math.round(place.ele)} m`;
      element.append(height);
    }
    return overlay.add(element, place, {
      lift: place.kind === "peak" ? 6 : 30,
      maxDistance: REACH[place.kind],
      priority: place.rank,
    });
  });
}

export function addLandmarkBadges(
  overlay: Overlay,
  landmarks: Landmark[],
  base: string
): Marker[] {
  return landmarks.map((landmark) => {
    const element = document.createElement("div");
    element.className = "fhm-badge";
    if (landmark.badge) {
      const image = document.createElement("div");
      image.className = "fhm-badge-image";
      image.style.backgroundImage = `url("${new URL(landmark.badge, base).href}")`;
      element.append(image);
    }
    const name = document.createElement("div");
    name.className = "fhm-badge-name";
    name.textContent = landmark.name;
    element.append(name);
    return overlay.add(element, landmark, {
      lift: 45,
      maxDistance: 14_000,
      priority: 1000,
    });
  });
}
