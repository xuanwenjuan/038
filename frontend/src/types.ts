export interface ModelParams {
  windShear: number;
  buoyFreq: number;
  coriolis: number;
}

export interface GridDimensions {
  nlon: number;
  nlat: number;
  nlev: number;
  gridSize: number;
  fieldBytes: number;
  totalBytes: number;
}

export interface WindFields {
  u: Float64Array;
  v: Float64Array;
  w: Float64Array;
  dims: GridDimensions;
}

export interface PresetEntry {
  id?: number;
  name: string;
  params: ModelParams;
  createdAt?: number;
  useCount?: number;
}
