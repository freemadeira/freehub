/** Reads an address typed into a record as OSM's addr:* tags, or nothing when it isn't in the expected shape. */
export type AddressReader = (
  text: string
) => Record<string, string> | undefined;

const PORTUGUESE =
  /^(?<street>[^,]+?)[\s,]+(?<number>\d+[A-Za-z]?)\s*,\s*(?<postcode>\d{4}-\d{3})\s+(?<city>[^,\d]+)$/u;

/** "Rua da Carreira 12, 9000-042 Funchal" */
function portuguese(text: string): Record<string, string> | undefined {
  const parts = PORTUGUESE.exec(text.trim().replaceAll(/\s+/gu, " "))?.groups;
  if (!(parts?.street && parts.number && parts.postcode && parts.city)) {
    return undefined;
  }
  return {
    "addr:city": parts.city.trim(),
    "addr:housenumber": parts.number,
    "addr:postcode": parts.postcode,
    "addr:street": parts.street.trim(),
  };
}

/** The formats `ADDRESS_FORMAT` picks from, by country code. Another country's goes here. */
export const ADDRESS_FORMATS: ReadonlyMap<string, AddressReader> = new Map([
  ["pt", portuguese],
]);
