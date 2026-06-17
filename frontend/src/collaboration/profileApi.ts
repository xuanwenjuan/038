import { ProfileData, ModelParams } from '../types';

const API_BASE = 'http://localhost:8000';

export async function extractProfile(
  params: ModelParams,
  point1: { x: number; y: number; z: number },
  point2: { x: number; y: number; z: number },
  numSamples: number = 50
): Promise<ProfileData | null> {
  try {
    const resp = await fetch(`${API_BASE}/api/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nlon: 32,
        nlat: 32,
        nlev: 20,
        wind_shear: params.windShear,
        buoy_freq: params.buoyFreq,
        coriolis: params.coriolis,
        point1: { x: point1.x, y: point1.y, z: point1.z },
        point2: { x: point2.x, y: point2.y, z: point2.z },
        num_samples: numSamples,
      }),
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    console.warn('剖面提取失败:', e);
    return null;
  }
}
