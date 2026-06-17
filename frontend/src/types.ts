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

export interface RoomMember {
  sid: string;
  name: string;
  color: string;
  joined_at?: number;
}

export interface Annotation {
  id: string;
  roomId: string;
  author: string;
  authorColor: string;
  text: string;
  position: { x: number; y: number; z: number };
  params: ModelParams;
  timestamp: number;
  createdAt?: string;
}

export interface ProfileData {
  point1: { x: number; y: number; z: number };
  point2: { x: number; y: number; z: number };
  num_samples: number;
  nlev: number;
  profile: Array<{
    z: number;
    samples: Array<{
      t: number;
      lon: number;
      lat: number;
      z: number;
      u: number;
      v: number;
      w: number;
      speed: number;
    }>;
  }>;
  vertical: Array<{
    z: number;
    u: number;
    v: number;
    w: number;
    speed: number;
  }>;
  compute_time_ms: number;
}

export interface RMSEStats {
  uRmse: number;
  vRmse: number;
  wRmse: number;
  uCorr: number;
  vCorr: number;
  wCorr: number;
  uMaxDiff: number;
  vMaxDiff: number;
  wMaxDiff: number;
}

export interface SharedLinkData {
  shortId: string;
  params?: ModelParams;
  viewpoint?: any;
  annotationId?: string;
  roomId?: string;
  createdAt?: string;
  expiresAt?: number;
}
