import { WindFields, ModelParams } from '../types';

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

export function computeRMSE(a: WindFields, b: WindFields): RMSEStats {
  const ua = a.u, ub = b.u;
  const va = a.v, vb = b.v;
  const wa = a.w, wb = b.w;

  function rmse(x: Float64Array, y: Float64Array): number {
    let sum = 0;
    const n = Math.min(x.length, y.length);
    for (let i = 0; i < n; i++) {
      const d = x[i] - y[i];
      sum += d * d;
    }
    return Math.sqrt(sum / n);
  }

  function corr(x: Float64Array, y: Float64Array): number {
    const n = Math.min(x.length, y.length);
    let sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
    for (let i = 0; i < n; i++) {
      sx += x[i]; sy += y[i];
      sxy += x[i] * y[i];
      sx2 += x[i] * x[i];
      sy2 += y[i] * y[i];
    }
    const num = n * sxy - sx * sy;
    const den = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
    return den < 1e-20 ? 0 : num / den;
  }

  function maxDiff(x: Float64Array, y: Float64Array): number {
    let mx = 0;
    const n = Math.min(x.length, y.length);
    for (let i = 0; i < n; i++) {
      mx = Math.max(mx, Math.abs(x[i] - y[i]));
    }
    return mx;
  }

  return {
    uRmse: rmse(ua, ub),
    vRmse: rmse(va, vb),
    wRmse: rmse(wa, wb),
    uCorr: corr(ua, ub),
    vCorr: corr(va, vb),
    wCorr: corr(wa, wb),
    uMaxDiff: maxDiff(ua, ub),
    vMaxDiff: maxDiff(va, vb),
    wMaxDiff: maxDiff(wa, wb),
  };
}

let _requestCounter = 0;

export interface BackendFetchResult {
  requestId: number;
  paramsSig: string;
  promise: Promise<{ fields: WindFields | null; requestId: number; paramsSig: string }>;
}

export function fetchBackendFields(
  params: ModelParams,
  apiUrl: string = 'http://localhost:8000'
): BackendFetchResult {
  const requestId = ++_requestCounter;
  const paramsSig = `${params.windShear.toFixed(8)}_${params.buoyFreq.toFixed(8)}_${params.coriolis.toExponential(4)}`;

  const promise = (async () => {
    try {
      const resp = await fetch(`${apiUrl}/api/compute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nlon: 32,
          nlat: 32,
          nlev: 20,
          wind_shear: params.windShear,
          buoy_freq: params.buoyFreq,
          coriolis: params.coriolis,
          use_fortran: false,
          format: 'json',
        }),
      });

      if (!resp.ok) {
        console.warn('后端 API 请求失败:', resp.status);
        return { fields: null, requestId, paramsSig };
      }

      const data = await resp.json();
      const gridSize = 32 * 32 * 20;
      const dims = { nlon: 32, nlat: 32, nlev: 20, gridSize, fieldBytes: gridSize * 8, totalBytes: gridSize * 8 * 3 };

      return {
        fields: {
          u: new Float64Array(data.u),
          v: new Float64Array(data.v),
          w: new Float64Array(data.w),
          dims,
        },
        requestId,
        paramsSig,
      };
    } catch (e) {
      console.warn('后端 API 不可用:', e);
      return { fields: null, requestId, paramsSig };
    }
  })();

  return { requestId, paramsSig, promise };
}
