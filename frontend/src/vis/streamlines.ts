import { WindFields } from '../types';
import * as THREE from 'three';

export interface StreamlineOptions {
  numStreamlines?: number;
  maxSteps?: number;
  stepSize?: number;
  tubeRadius?: number;
  tubeSegments?: number;
  minSpeed?: number;
}

interface Point3 {
  x: number; y: number; z: number;
}

export function computeStreamlines(
  fields: WindFields,
  options: StreamlineOptions = {}
): { points: Point3[][]; speeds: number[][] } {
  const { nlon, nlat, nlev } = fields.dims;
  const {
    numStreamlines = 50,
    maxSteps = 150,
    stepSize = 1.5,
    minSpeed = 0.001,
  } = options;

  const lonRange = 360;
  const latRange = 180;
  const zRange = 1000;

  const dlon = lonRange / nlon;
  const dlat = latRange / (nlat - 1);
  const dz = zRange / nlev;

  const streamlines: Point3[][] = [];
  const speeds: number[][] = [];

  function getUVW(lon: number, lat: number, z: number): { u: number; v: number; w: number } {
    let iFloat = lon / dlon;
    let jFloat = (lat + 90) / dlat;
    let kFloat = z / dz;

    iFloat = ((iFloat % nlon) + nlon) % nlon;
    jFloat = Math.max(0, Math.min(nlat - 1, jFloat));
    kFloat = Math.max(0, Math.min(nlev - 1, kFloat));

    const i0 = Math.floor(iFloat);
    const j0 = Math.floor(jFloat);
    const k0 = Math.floor(kFloat);
    const i1 = Math.min(i0 + 1, nlon - 1);
    const j1 = Math.min(j0 + 1, nlat - 1);
    const k1 = Math.min(k0 + 1, nlev - 1);
    const fi = iFloat - i0;
    const fj = jFloat - j0;
    const fk = kFloat - k0;

    function trilinear(arr: Float64Array): number {
      const idx000 = i0 + j0 * nlon + k0 * nlon * nlat;
      const idx100 = i1 + j0 * nlon + k0 * nlon * nlat;
      const idx010 = i0 + j1 * nlon + k0 * nlon * nlat;
      const idx110 = i1 + j1 * nlon + k0 * nlon * nlat;
      const idx001 = i0 + j0 * nlon + k1 * nlon * nlat;
      const idx101 = i1 + j0 * nlon + k1 * nlon * nlat;
      const idx011 = i0 + j1 * nlon + k1 * nlon * nlat;
      const idx111 = i1 + j1 * nlon + k1 * nlon * nlat;

      const c000 = arr[idx000];
      const c100 = arr[idx100];
      const c010 = arr[idx010];
      const c110 = arr[idx110];
      const c001 = arr[idx001];
      const c101 = arr[idx101];
      const c011 = arr[idx011];
      const c111 = arr[idx111];

      const x00 = c000 * (1 - fi) + c100 * fi;
      const x10 = c010 * (1 - fi) + c110 * fi;
      const x01 = c001 * (1 - fi) + c101 * fi;
      const x11 = c011 * (1 - fi) + c111 * fi;

      const y0 = x00 * (1 - fj) + x10 * fj;
      const y1 = x01 * (1 - fj) + x11 * fj;

      return y0 * (1 - fk) + y1 * fk;
    }

    return {
      u: trilinear(fields.u),
      v: trilinear(fields.v),
      w: trilinear(fields.w),
    };
  }

  const seeds: Point3[] = [];
  for (let s = 0; s < numStreamlines; s++) {
    seeds.push({
      x: Math.random() * lonRange,
      y: -90 + Math.random() * latRange,
      z: Math.random() * zRange * 0.6,
    });
  }

  for (const seed of seeds) {
    const points: Point3[] = [{ ...seed }];
    const speedArr: number[] = [];
    let x = seed.x, y = seed.y, z = seed.z;

    for (let step = 0; step < maxSteps; step++) {
      const vel = getUVW(x, y, z);
      const speed = Math.sqrt(vel.u * vel.u + vel.v * vel.v + vel.w * vel.w);
      speedArr.push(speed);

      if (speed < minSpeed) break;

      const scale = stepSize / speed;
      x += vel.u * scale;
      y += vel.v * scale * 0.5;
      z += vel.w * scale * 50;

      if (z < 0 || z > zRange) break;
      if (y < -90 || y > 90) break;

      x = ((x % lonRange) + lonRange) % lonRange;

      points.push({ x, y, z });
    }

    if (points.length >= 3) {
      streamlines.push(points);
      speeds.push(speedArr);
    }
  }

  return { points: streamlines, speeds };
}

export function createStreamlineTubes(
  streamlines: Point3[][],
  speeds: number[][],
  options: { tubeRadius?: number; radialSegments?: number } = {}
): THREE.Group {
  const group = new THREE.Group();
  const { tubeRadius = 0.8, radialSegments = 8 } = options;

  for (let i = 0; i < streamlines.length; i++) {
    const pts = streamlines[i];
    const spds = speeds[i];

    if (pts.length < 2) continue;

    const curvePts = pts.map(p => new THREE.Vector3(p.x, p.y, p.z));
    const curve = new THREE.CatmullRomCurve3(curvePts, false, 'catmullrom', 0.5);

    const geometry = new THREE.TubeGeometry(
      curve,
      Math.max(pts.length * 2, 20),
      tubeRadius,
      radialSegments,
      false
    );

    const colors = new Float32Array(geometry.attributes.position.count * 3);
    const pos = geometry.attributes.position;

    for (let v = 0; v < pos.count; v++) {
      const idx = Math.floor(v / radialSegments);
      const speedIdx = Math.min(idx, spds.length - 1);
      const speed = spds[speedIdx] || 0;
      const color = speedToColor(speed);
      colors[v * 3] = color.r;
      colors[v * 3 + 1] = color.g;
      colors[v * 3 + 2] = color.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      shininess: 30,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });

    const mesh = new THREE.Mesh(geometry, material);
    group.add(mesh);
  }

  return group;
}

function speedToColor(speed: number): { r: number; g: number; b: number } {
  const t = Math.min(Math.max(speed * 50, 0), 1);
  let r = 0, g = 0, b = 0;

  if (t < 0.25) {
    const s = t / 0.25;
    r = 0; g = 0; b = 0.5 + s * 0.5;
  } else if (t < 0.5) {
    const s = (t - 0.25) / 0.25;
    r = 0; g = s; b = 1;
  } else if (t < 0.75) {
    const s = (t - 0.5) / 0.25;
    r = s; g = 1; b = 1 - s;
  } else {
    const s = (t - 0.75) / 0.25;
    r = 1; g = 1 - s; b = 0;
  }

  return { r, g, b };
}

export function createGridBox(dims: { nlon: number; nlat: number; nlev: number }): THREE.Group {
  const group = new THREE.Group();
  const w = 360, h = 180, d = 1000;

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
    new THREE.LineBasicMaterial({ color: 0x6688aa, transparent: true, opacity: 0.4 })
  );
  edges.position.set(w / 2, 0, d / 2);
  group.add(edges);

  const lonLines = new THREE.Group();
  for (let i = 0; i <= dims.nlon; i += 4) {
    const x = (i / dims.nlon) * w;
    const pts = [
      new THREE.Vector3(x, -h / 2, 0),
      new THREE.Vector3(x, -h / 2, d),
      new THREE.Vector3(x, h / 2, d),
      new THREE.Vector3(x, h / 2, 0),
    ];
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x446688, transparent: true, opacity: 0.2 });
    lonLines.add(new THREE.Line(g, mat));
  }
  lonLines.position.set(0, 0, 0);
  group.add(lonLines);

  return group;
}
