declare module "vt-pbf" {
  interface Feature {
    id?: number;
    type: 1 | 2 | 3;
    geometry: number[][] | number[][][];
    tags: Record<string, string | number>;
  }
  const vtpbf: {
    fromGeojsonVt: (
      layers: Record<string, { features: Feature[] }>,
      options?: { version?: number; extent?: number }
    ) => Uint8Array;
  };
  export default vtpbf;
}
