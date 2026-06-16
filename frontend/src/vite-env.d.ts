/// <reference types="vite/client" />

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

type WasmModuleFactory = (opts?: { locateFile?: (file: string) => string }) => Promise<WasmModule>;

declare module '/wasm/gravityWaveModel.js' {
  const gravityWaveModel: WasmModuleFactory;
  export default gravityWaveModel;
}
