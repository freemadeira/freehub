import { describe, expect, it } from "vitest";

import { ADDRESS_FORMATS } from "./addresses";

describe("Portuguese addresses", () => {
  const read = ADDRESS_FORMATS.get("pt");

  it("reads street, number, postcode and city", () => {
    expect(read?.("Rua 31 de Janeiro 5A, 9050-011 Funchal")).toEqual({
      "addr:city": "Funchal",
      "addr:housenumber": "5A",
      "addr:postcode": "9050-011",
      "addr:street": "Rua 31 de Janeiro",
    });
    expect(read?.("Rua X, 12,  9000-123 Câmara de Lobos")).toEqual({
      "addr:city": "Câmara de Lobos",
      "addr:housenumber": "12",
      "addr:postcode": "9000-123",
      "addr:street": "Rua X",
    });
  });

  it("reads nothing it isn't sure of", () => {
    for (const text of [
      "Estrada Monumental 175-177, 9000-100 Funchal",
      "Rua 5 de Outubro, 9000-123 Funchal",
      "Edifício X, Rua Y 12, 9000-123 Funchal",
      "Rua da Carreira 12, Funchal",
    ]) {
      expect(read?.(text)).toBeUndefined();
    }
  });
});
