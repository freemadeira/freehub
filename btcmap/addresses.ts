/** Reads an address typed into a record as OSM's addr:* tags, or nothing when it isn't in the expected shape. */
export type AddressReader = (
  text: string
) => Record<string, string> | undefined;

const PORTUGUESE =
  /^(?<street>[^,]+?)[\s,]+(?<number>\d+[A-Za-z]?)\s*,\s*(?<postcode>\d{4}-\d{3})\s+(?<city>[^,\d]+)$/u;
/** A word before the number that says it isn't the house number: nº 12, Loja 3, Piso 2. */
const NOT_HOUSE_NUMBER =
  /\s(?:n\.?º|n\.?o\.?|loja|piso|andar|lote|bloco|fra[cç][aã]o|apartamento|apt\.?)$/iu;

/** "Rua da Carreira 12, 9000-042 Funchal" */
function portuguese(text: string): Record<string, string> | undefined {
  const parts = PORTUGUESE.exec(text.trim().replaceAll(/\s+/gu, " "))?.groups;
  if (
    !(parts?.street && parts.number && parts.postcode && parts.city) ||
    NOT_HOUSE_NUMBER.test(parts.street)
  ) {
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
