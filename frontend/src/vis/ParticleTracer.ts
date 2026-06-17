import { WindFields } from '../types';
import * as THREE from 'three';

export interface ParticleTracerOptions {
  numParticles?: number;
  particleSize?: number;
  speedScale?: number;
  fadeRate?: number;
  trailLength?: number;
}

const PARTICLE_VERT = `
  attribute float aSpeed;
  attribute float aLife;
  varying float vSpeed;
  varying float vLife;
  uniform float uPointSize;

  void main() {
    vSpeed = aSpeed;
    vLife = aLife;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = uPointSize * (300.0 / -mvPosition.z);
    gl_PointSize = clamp(gl_PointSize, 1.0, 16.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PARTICLE_FRAG = `
  varying float vSpeed;
  varying float vLife;

  void main() {
    float dist = length(gl_PointCoord - vec2(0.5));
    if (dist > 0.5) discard;

    float alpha = smoothstep(0.5, 0.15, dist) * vLife;

    float t = clamp(vSpeed * 50.0, 0.0, 1.0);
    vec3 col;
    if (t < 0.25) {
      float s = t / 0.25;
      col = mix(vec3(0.0, 0.0, 0.5), vec3(0.0, 0.0, 1.0), s);
    } else if (t < 0.5) {
      float s = (t - 0.25) / 0.25;
      col = mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 1.0), s);
    } else if (t < 0.75) {
      float s = (t - 0.5) / 0.25;
      col = mix(vec3(0.0, 1.0, 1.0), vec3(1.0, 1.0, 0.0), s);
    } else {
      float s = (t - 0.75) / 0.25;
      col = mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.2, 0.0), s);
    }

    col += vec3(0.15) * smoothstep(0.3, 0.0, dist);

    gl_FragColor = vec4(col, alpha);
  }
`;

export class ParticleTracer {
  private fields: WindFields | null = null;
  private numParticles: number;
  private speedScale: number;
  private fadeRate: number;
  private mesh: THREE.Points | null = null;
  private positions: Float32Array;
  private velocities: Float32Array;
  private speeds: Float32Array;
  private lifes: Float32Array;
  private ages: Float32Array;
  private maxAge: number;

  private lonRange = 360;
  private latRange = 180;
  private zRange = 1000;

  constructor(options: ParticleTracerOptions = {}) {
    this.numParticles = options.numParticles || 5000;
    this.speedScale = options.speedScale || 2.0;
    this.fadeRate = options.fadeRate || 0.005;
    this.maxAge = Math.floor(1.0 / this.fadeRate) + 60;
    this.positions = new Float32Array(this.numParticles * 3);
    this.velocities = new Float32Array(this.numParticles * 3);
    this.speeds = new Float32Array(this.numParticles);
    this.lifes = new Float32Array(this.numParticles);
    this.ages = new Float32Array(this.numParticles);
  }

  setFields(fields: WindFields): void {
    this.fields = fields;
    this.initParticles();
  }

  private initParticles(): void {
    for (let i = 0; i < this.numParticles; i++) {
      this.resetParticle(i);
    }
  }

  private resetParticle(i: number): void {
    const i3 = i * 3;
    this.positions[i3] = Math.random() * this.lonRange;
    this.positions[i3 + 1] = -90 + Math.random() * this.latRange;
    this.positions[i3 + 2] = Math.random() * this.zRange * 0.6;
    this.velocities[i3] = 0;
    this.velocities[i3 + 1] = 0;
    this.velocities[i3 + 2] = 0;
    this.speeds[i] = 0;
    this.lifes[i] = 0.0;
    this.ages[i] = Math.floor(Math.random() * this.maxAge);
  }

  private sampleField(lon: number, lat: number, z: number): { u: number; v: number; w: number } | null {
    if (!this.fields) return null;

    const { nlon, nlat, nlev } = this.fields.dims;
    const dlon = this.lonRange / nlon;
    const dlat = this.latRange / (nlat - 1);
    const dz = this.zRange / nlev;

    let iF = lon / dlon;
    let jF = (lat + 90) / dlat;
    let kF = z / dz;

    iF = ((iF % nlon) + nlon) % nlon;
    jF = Math.max(0, Math.min(nlat - 1, jF));
    kF = Math.max(0, Math.min(nlev - 1, kF));

    const i0 = Math.floor(iF);
    const j0 = Math.floor(jF);
    const k0 = Math.floor(kF);
    const i1 = Math.min(i0 + 1, nlon - 1);
    const j1 = Math.min(j0 + 1, nlat - 1);
    const k1 = Math.min(k0 + 1, nlev - 1);
    const fi = iF - i0;
    const fj = jF - j0;
    const fk = kF - k0;

    function trilinear(arr: Float64Array): number {
      const idx000 = i0 + j0 * nlon + k0 * nlon * nlat;
      const idx100 = i1 + j0 * nlon + k0 * nlon * nlat;
      const idx010 = i0 + j1 * nlon + k0 * nlon * nlat;
      const idx110 = i1 + j1 * nlon + k0 * nlon * nlat;
      const idx001 = i0 + j0 * nlon + k1 * nlon * nlat;
      const idx101 = i1 + j0 * nlon + k1 * nlon * nlat;
      const idx011 = i0 + j1 * nlon + k1 * nlon * nlat;
      const idx111 = i1 + j1 * nlon + k1 * nlon * nlat;

      const x00 = arr[idx000] * (1 - fi) + arr[idx100] * fi;
      const x10 = arr[idx010] * (1 - fi) + arr[idx110] * fi;
      const x01 = arr[idx001] * (1 - fi) + arr[idx101] * fi;
      const x11 = arr[idx011] * (1 - fi) + arr[idx111] * fi;

      const y0 = x00 * (1 - fj) + x10 * fj;
      const y1 = x01 * (1 - fj) + x11 * fj;

      return y0 * (1 - fk) + y1 * fk;
    }

    return {
      u: trilinear(this.fields.u),
      v: trilinear(this.fields.v),
      w: trilinear(this.fields.w),
    };
  }

  update(dt: number): void {
    if (!this.fields) return;

    const scale = this.speedScale * dt;

    for (let i = 0; i < this.numParticles; i++) {
      const i3 = i * 3;
      const x = this.positions[i3];
      const y = this.positions[i3 + 1];
      const z = this.positions[i3 + 2];

      const vel = this.sampleField(x, y, z);
      if (!vel) {
        this.resetParticle(i);
        continue;
      }

      const speed = Math.sqrt(vel.u * vel.u + vel.v * vel.v + vel.w * vel.w);
      this.speeds[i] = speed;

      if (speed < 0.0001) {
        this.ages[i]++;
        if (this.ages[i] > this.maxAge) {
          this.resetParticle(i);
        }
        continue;
      }

      this.positions[i3] += vel.u * scale;
      this.positions[i3 + 1] += vel.v * scale * 0.5;
      this.positions[i3 + 2] += vel.w * scale * 50;

      this.positions[i3] = ((this.positions[i3] % this.lonRange) + this.lonRange) % this.lonRange;

      this.ages[i]++;

      const outOfBounds =
        this.positions[i3 + 1] < -90 || this.positions[i3 + 1] > 90 ||
        this.positions[i3 + 2] < 0 || this.positions[i3 + 2] > this.zRange;

      if (outOfBounds || this.ages[i] > this.maxAge) {
        this.resetParticle(i);
      }

      const fadeIn = Math.min(this.ages[i] / 10.0, 1.0);
      const fadeOut = Math.max(1.0 - (this.ages[i] - this.maxAge + 20) / 20.0, 0.0);
      this.lifes[i] = Math.min(fadeIn, fadeOut);
    }

    if (this.mesh) {
      const posAttr = this.mesh.geometry.attributes.position as THREE.BufferAttribute;
      posAttr.needsUpdate = true;
      const speedAttr = this.mesh.geometry.attributes.aSpeed as THREE.BufferAttribute;
      speedAttr.needsUpdate = true;
      const lifeAttr = this.mesh.geometry.attributes.aLife as THREE.BufferAttribute;
      lifeAttr.needsUpdate = true;
    }
  }

  createMesh(): THREE.Points {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('aSpeed', new THREE.BufferAttribute(this.speeds, 1));
    geometry.setAttribute('aLife', new THREE.BufferAttribute(this.lifes, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: {
        uPointSize: { value: 3.0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.mesh = new THREE.Points(geometry, material);
    return this.mesh;
  }

  setParticleSize(size: number): void {
    if (this.mesh) {
      (this.mesh.material as THREE.ShaderMaterial).uniforms.uPointSize.value = size;
    }
  }

  setSpeedScale(scale: number): void {
    this.speedScale = scale;
  }

  dispose(): void {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.ShaderMaterial).dispose();
      this.mesh = null;
    }
  }
}
