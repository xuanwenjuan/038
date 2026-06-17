import { ModelParams, GridDimensions, WindFields } from '../types';

interface WasmModule {
  _wasm_init: () => number;
  _wasm_free: () => void;
  _wasm_compute: (ws: number, bf: number, co: number) => number;
  _wasm_get_u8_ptr: () => number;
  _wasm_serialize_fields: () => number;
  _wasm_get_grid_size: () => number;
  _wasm_get_field_bytes: () => number;
  _wasm_get_total_bytes: () => number;
  _wasm_get_nlon: () => number;
  _wasm_get_nlat: () => number;
  _wasm_get_nlev: () => number;
  _wasm_validate: () => number;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  HEAPU8: Uint8Array;
  HEAPF64: Float64Array;
}

type WasmModuleFactory = (opts?: any) => Promise<WasmModule>;

declare const gravityWaveModel: WasmModuleFactory | undefined;

export class WasmLoader {
  private module: WasmModule | null = null;
  private dims: GridDimensions | null = null;
  private useFallback = false;
  private prevPtr: number = 0;

  async load(): Promise<boolean> {
    try {
      const response = await fetch('/wasm/gravityWaveModel.js');
      if (!response.ok) {
        throw new Error(`WASM JS 模块加载失败: ${response.status}`);
      }
      const jsCode = await response.text();
      const factoryFn = new Function(`
        ${jsCode}
        return typeof Module !== 'undefined' ? Module :
               typeof gravityWaveModel !== 'undefined' ? gravityWaveModel :
               undefined;
      `)();

      if (!factoryFn || typeof factoryFn !== 'function') {
        throw new Error('WASM 模块工厂函数未找到');
      }

      const factory = factoryFn as WasmModuleFactory;
      this.module = await factory({
        locateFile: (file: string) => `/wasm/${file}`,
        TOTAL_MEMORY: 256 * 1024 * 1024,
      });
      const ret = this.module._wasm_init();
      if (ret !== 0) {
        throw new Error('WASM 初始化失败');
      }
      this.dims = {
        nlon: this.module._wasm_get_nlon(),
        nlat: this.module._wasm_get_nlat(),
        nlev: this.module._wasm_get_nlev(),
        gridSize: this.module._wasm_get_grid_size(),
        fieldBytes: this.module._wasm_get_field_bytes(),
        totalBytes: this.module._wasm_get_total_bytes(),
      };
      return true;
    } catch (e) {
      console.warn('WASM 加载失败，使用 JS 回退计算:', e);
      this.useFallback = true;
      return this.initFallback();
    }
  }

  private initFallback(): boolean {
    const nlon = 32, nlat = 32, nlev = 20;
    const gridSize = nlon * nlat * nlev;
    this.dims = {
      nlon, nlat, nlev,
      gridSize,
      fieldBytes: gridSize * 8,
      totalBytes: gridSize * 8 * 3,
    };
    return true;
  }

  isWasm(): boolean {
    return !this.useFallback;
  }

  getDims(): GridDimensions {
    if (!this.dims) throw new Error('WASM not loaded');
    return this.dims;
  }

  compute(params: ModelParams): WindFields {
    if (!this.dims) throw new Error('WASM not loaded');

    if (this.useFallback) {
      return this.computeFallback(params);
    }
    if (!this.module) throw new Error('WASM not loaded');

    if (this.prevPtr !== 0) {
      try {
        this.module._free(this.prevPtr);
      } catch (e) {
        console.warn('释放前次 WASM 内存失败:', e);
      }
      this.prevPtr = 0;
    }

    try {
      this.module._wasm_free();
    } catch (e) {
      console.warn('调用 _wasm_free 失败:', e);
    }

    const ret = this.module._wasm_compute(
      params.windShear, params.buoyFreq, params.coriolis
    );
    if (ret !== 0) throw new Error('WASM compute failed');

    this.module._wasm_serialize_fields();

    const ptr = this.module._wasm_get_u8_ptr();
    const heap = this.module.HEAPU8;
    const d = this.dims;

    const uBuf = new ArrayBuffer(d.fieldBytes);
    const vBuf = new ArrayBuffer(d.fieldBytes);
    const wBuf = new ArrayBuffer(d.fieldBytes);

    new Uint8Array(uBuf).set(heap.subarray(ptr, ptr + d.fieldBytes));
    new Uint8Array(vBuf).set(heap.subarray(ptr + d.fieldBytes, ptr + d.fieldBytes * 2));
    new Uint8Array(wBuf).set(heap.subarray(ptr + d.fieldBytes * 2, ptr + d.fieldBytes * 3));

    return {
      u: new Float64Array(uBuf),
      v: new Float64Array(vBuf),
      w: new Float64Array(wBuf),
      dims: { ...d },
    };
  }

  private computeFallback(params: ModelParams): WindFields {
    const { nlon, nlat, nlev, gridSize } = this.dims!;
    const u = new Float64Array(gridSize);
    const v = new Float64Array(gridSize);
    const w = new Float64Array(gridSize);

    const PI = Math.PI;
    const dlon = 360 / nlon;
    const dlat = 180 / (nlat - 1);
    const dlev = 1000 / nlev;
    const N2 = params.buoyFreq * params.buoyFreq;
    const f2 = params.coriolis * params.coriolis;

    for (let k = 0; k < nlev; k++) {
      const z = k * dlev;
      for (let j = 0; j < nlat; j++) {
        const lat = -90 + j * dlat;
        const latRad = lat * PI / 180;
        const vBg = params.windShear * z * Math.cos(latRad);
        for (let i = 0; i < nlon; i++) {
          const lon = i * dlon;
          const lonRad = lon * PI / 180;
          const uBg = params.windShear * z * Math.sin(lonRad);

          let sumR = 0, sumI = 0;
          for (let m = 1; m <= 4; m++) {
            const kx = m * 2 * PI / 360;
            for (let n = 1; n <= 4; n++) {
              const ky = n * 2 * PI / 180;
              let tmp = kx * kx + ky * ky;
              if (tmp < 1e-10) tmp = 1e-10;

              const uBg2 = uBg * uBg;
              const numer = (N2 - f2) * tmp;
              const denom = uBg2 * tmp + f2;
              const kz = Math.sqrt(Math.max(numer / denom, 0));

              const omega = Math.sqrt(
                N2 * (kx * kx + ky * ky) / (kx * kx + ky * ky + kz * kz) + f2
              );

              let ampl = 1 / (m * n);
              ampl *= Math.exp(-0.5 * z / 5000);

              const phase = kx * lon + ky * lat + kz * z;
              const intAcc = this.trapzInt(m, n, kx, ky, kz, omega, z, N2, f2);

              sumR += ampl * (Math.cos(phase) + intAcc.r);
              sumI += ampl * (Math.sin(phase) + intAcc.i);
            }
          }

          const idx = i + j * nlon + k * nlon * nlat;
          u[idx] = uBg + 2 * sumR;
          v[idx] = vBg - 2 * sumI;

          const rr = kxVal(params.windShear, z, lonRad, latRad) * sumI - kyVal(params.windShear, z, lonRad, latRad) * sumR;
          const ri = -kxVal(params.windShear, z, lonRad, latRad) * sumR - kyVal(params.windShear, z, lonRad, latRad) * sumI;
          const omegaEff = Math.max(params.buoyFreq * 0.5, 0.01);
          w[idx] = (N2 / omegaEff) * Math.sqrt(rr * rr + ri * ri) / Math.max(params.buoyFreq, 0.01);
        }
      }
    }

    this.smoothRecursive(u, nlon, nlat, nlev, 2);
    this.smoothRecursive(v, nlon, nlat, nlev, 2);
    this.smoothRecursive(w, nlon, nlat, nlev, 2);

    return { u, v, w, dims: { ...this.dims! } };
  }

  private trapzInt(m: number, n: number, kx: number, ky: number, kz: number,
                    omega: number, z: number, N2: number, f2: number): { r: number; i: number } {
    const ns = 20;
    const ds = 500 / ns;
    let accR = 0, accI = 0;
    const tmp = kx * kx + ky * ky + kz * kz || 1e-10;

    for (let s = 1; s <= ns; s++) {
      let zs = z - (ns - s) * ds;
      let mag = (N2 / omega) / Math.sqrt(tmp);
      mag *= Math.exp(-0.5 * Math.abs(z - zs) / 2000);
      let phaseS = kx * 0.1 * m + ky * 0.1 * n + kz * zs;
      const r1 = mag * Math.cos(phaseS);
      const i1 = mag * Math.sin(phaseS);

      zs = z - (ns - s + 1) * ds;
      mag = (N2 / omega) / Math.sqrt(tmp);
      mag *= Math.exp(-0.5 * Math.abs(z - zs) / 2000);
      phaseS = kx * 0.1 * m + ky * 0.1 * n + kz * zs;
      const r2 = mag * Math.cos(phaseS);
      const i2 = mag * Math.sin(phaseS);

      accR += (r1 + r2) * ds * 0.5;
      accI += (i1 + i2) * ds * 0.5;
    }

    return { r: accR * 1e-4, i: accI * 1e-4 };
  }

  private smoothRecursive(field: Float64Array, nx: number, ny: number, nz: number, nIter: number): void {
    const tmp = new Float64Array(field.length);
    for (let iter = 0; iter < nIter; iter++) {
      for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const idx = i + j * nx + k * nx * ny;
            let val = field[idx];
            let count = 1;
            if (i > 0) { val += field[idx - 1]; count++; }
            if (i < nx - 1) { val += field[idx + 1]; count++; }
            if (j > 0) { val += field[idx - nx]; count++; }
            if (j < ny - 1) { val += field[idx + nx]; count++; }
            if (k > 0) { val += field[idx - nx * ny]; count++; }
            if (k < nz - 1) { val += field[idx + nx * ny]; count++; }
            tmp[idx] = val / count;
          }
        }
      }
      field.set(tmp);
    }
  }

  free(): void {
    if (this.module && !this.useFallback) {
      this.module._wasm_free();
    }
    this.module = null;
    this.dims = null;
  }
}

function kxVal(_ws: number, _z: number, _lonRad: number, _latRad: number): number {
  return 2 * Math.PI / 360;
}

function kyVal(_ws: number, _z: number, _lonRad: number, _latRad: number): number {
  return 2 * Math.PI / 180;
}
