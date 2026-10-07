/** A point on Earth, in degrees. */
export interface Location {
  lat: number;
  lng: number;
}

const NUMBER = String.raw`[-+−]?\d+(?:[.,]\d+)?`;
const PAIR = new RegExp(
  String.raw`(?<lat>${NUMBER})\s*[,;\s]\s*(?<lng>${NUMBER})`,
  "u"
);

function dms(index: number): string {
  const part = String.raw`(?<degrees${index}>\d+(?:[.,]\d+)?)\s*°\s*(?:(?<minutes${index}>\d+(?:[.,]\d+)?)\s*['′]\s*)?(?:(?<seconds${index}>\d+(?:[.,]\d+)?)\s*(?:"|″|'')\s*)?(?<hemisphere${index}>[NSEWnsew])`;
  return part;
}
const DMS = new RegExp(String.raw`${dms(1)}[\s,]*${dms(2)}`, "u");

/** Map links people paste: Google, Apple, OpenStreetMap and `geo:`. */
const LINKS = [
  // Google's place pin, more exact than the view's center.
  /!3d(?<lat>-?\d+(?:\.\d+)?)!4d(?<lng>-?\d+(?:\.\d+)?)/u,
  /@(?<lat>-?\d+(?:\.\d+)?),(?<lng>-?\d+(?:\.\d+)?)/u,
  /[?&](?:q|query|ll|sll|daddr|destination|center)=(?<lat>-?\d+(?:\.\d+)?)(?:,|%2C)\s*(?<lng>-?\d+(?:\.\d+)?)/iu,
  /[?&]mlat=(?<lat>-?\d+(?:\.\d+)?)&mlon=(?<lng>-?\d+(?:\.\d+)?)/u,
  /#map=\d+(?:\.\d+)?\/(?<lat>-?\d+(?:\.\d+)?)\/(?<lng>-?\d+(?:\.\d+)?)/u,
  /^geo:(?<lat>-?\d+(?:\.\d+)?),(?<lng>-?\d+(?:\.\d+)?)/iu,
];

function number(text: string | undefined): number {
  return Number((text ?? "").replace("−", "-").replace(",", "."));
}

function valid(lat: number, lng: number): Location | undefined {
  if (!(Number.isFinite(lat) && Number.isFinite(lng))) {
    return undefined;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    return undefined;
  }
  return { lat, lng };
}

function fromDms(
  groups: Record<string, string | undefined>
): Location | undefined {
  const part = (index: number) => {
    const value =
      number(groups[`degrees${index}`]) +
      number(groups[`minutes${index}`] ?? "0") / 60 +
      number(groups[`seconds${index}`] ?? "0") / 3600;
    const hemisphere = (groups[`hemisphere${index}`] ?? "").toUpperCase();
    return {
      axis: hemisphere === "N" || hemisphere === "S" ? "lat" : "lng",
      value: hemisphere === "S" || hemisphere === "W" ? -value : value,
    };
  };
  const first = part(1);
  const second = part(2);
  if (first.axis === second.axis) {
    return undefined;
  }
  return first.axis === "lat"
    ? valid(first.value, second.value)
    : valid(second.value, first.value);
}

/** Reads coordinates typed or pasted in any common form; latitude comes first. */
export function parseLocation(text: string): Location | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  for (const pattern of LINKS) {
    const groups = pattern.exec(trimmed)?.groups;
    if (groups) {
      return valid(number(groups.lat), number(groups.lng));
    }
  }
  const degrees = DMS.exec(trimmed)?.groups;
  if (degrees) {
    return fromDms(degrees);
  }
  const pair = PAIR.exec(trimmed)?.groups;
  return pair ? valid(number(pair.lat), number(pair.lng)) : undefined;
}

/** How a location is stored in a CRM value: "lat,lng", about 10 cm precise. */
export function locationValue(location: Location): string {
  return `${location.lat.toFixed(6)},${location.lng.toFixed(6)}`;
}

const STORED = /^(?<lat>-?\d+(?:\.\d+)?),(?<lng>-?\d+(?:\.\d+)?)$/u;

/** A stored value back to a location; anything else isn't one. */
export function readLocation(value: string | undefined): Location | undefined {
  const groups = STORED.exec(value ?? "")?.groups;
  return groups ? valid(Number(groups.lat), Number(groups.lng)) : undefined;
}

export function formatLocation(location: Location): string {
  const lat = `${Math.abs(location.lat).toFixed(4)}° ${location.lat < 0 ? "S" : "N"}`;
  const lng = `${Math.abs(location.lng).toFixed(4)}° ${location.lng < 0 ? "W" : "E"}`;
  return `${lat}, ${lng}`;
}

export function openStreetMapUrl(location: Location): string {
  const lat = location.lat.toFixed(6);
  const lng = location.lng.toFixed(6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}
