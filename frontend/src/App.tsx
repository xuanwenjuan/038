import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WasmLoader } from './wasm/WasmLoader';
import { IndexedDBCache, defaultPresets } from './db/IndexedDBCache';
import { ControlPanel } from './components/ControlPanel';
import { WindScene3D } from './components/WindScene3D';
import { ModelParams, WindFields, PresetEntry } from './types';
import './App.css';

const DEFAULT_PARAMS: ModelParams = {
  windShear: 0.008,
  buoyFreq: 0.02,
  coriolis: 1e-4,
};

export default function App() {
  const [params, setParams] = useState<ModelParams>(DEFAULT_PARAMS);
  const [fields, setFields] = useState<WindFields | null>(null);
  const [loading, setLoading] = useState(false);
  const [computeTimeMs, setComputeTimeMs] = useState(0);
  const [useWasm, setUseWasm] = useState(true);
  const [presets, setPresets] = useState<PresetEntry[]>([]);

  const wasmLoaderRef = useRef<WasmLoader | null>(null);
  const dbCacheRef = useRef<IndexedDBCache | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    const init = async () => {
      const loader = new WasmLoader();
      const wasmOk = await loader.load();
      setUseWasm(loader.isWasm());
      wasmLoaderRef.current = loader;

      const cache = new IndexedDBCache();
      try {
        await cache.init();
        const saved = await cache.getPresets();
        if (saved.length === 0) {
          for (const p of defaultPresets) {
            await cache.addPreset(p);
          }
          setPresets(await cache.getPresets());
        } else {
          setPresets(saved);
        }
      } catch (e) {
        console.warn('IndexedDB 初始化失败:', e);
      }
      dbCacheRef.current = cache;

      setLoading(true);
      const t0 = performance.now();
      const result = loader.compute(DEFAULT_PARAMS);
      const t1 = performance.now();
      setFields(result);
      setComputeTimeMs(t1 - t0);
      setLoading(false);
      initializedRef.current = true;
    };

    init();

    return () => {
      if (wasmLoaderRef.current) {
        wasmLoaderRef.current.free();
      }
      if (dbCacheRef.current) {
        dbCacheRef.current.close();
      }
    };
  }, []);

  const handleCompute = useCallback(() => {
    if (!wasmLoaderRef.current) return;
    setLoading(true);
    requestAnimationFrame(() => {
      const t0 = performance.now();
      const result = wasmLoaderRef.current!.compute(params);
      const t1 = performance.now();
      setFields(result);
      setComputeTimeMs(t1 - t0);
      setLoading(false);
    });
  }, [params]);

  const handleSavePreset = useCallback(async (name: string) => {
    if (!dbCacheRef.current) return;
    try {
      await dbCacheRef.current.addPreset({ name, params: { ...params } });
      setPresets(await dbCacheRef.current.getPresets());
    } catch (e) {
      console.error('保存预设失败:', e);
    }
  }, [params]);

  const handleLoadPreset = useCallback(async (preset: PresetEntry) => {
    if (!dbCacheRef.current) return;
    setParams(preset.params);
    if (preset.id) {
      try {
        await dbCacheRef.current.incrementUseCount(preset.id);
        setPresets(await dbCacheRef.current.getPresets());
      } catch (e) {
        console.error('更新使用次数失败:', e);
      }
    }
  }, []);

  const handleDeletePreset = useCallback(async (id: number) => {
    if (!dbCacheRef.current) return;
    try {
      await dbCacheRef.current.deletePreset(id);
      setPresets(await dbCacheRef.current.getPresets());
    } catch (e) {
      console.error('删除预设失败:', e);
    }
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>平流层重力波 3D 风场可视化</h1>
        <p className="subtitle">
          基于 Emscripten + WebAssembly 的 Fortran 气象模型浏览器端计算
        </p>
      </header>

      <div className="app-main">
        <aside className="sidebar">
          <ControlPanel
            params={params}
            onChange={setParams}
            onCompute={handleCompute}
            onSavePreset={handleSavePreset}
            presets={presets}
            onLoadPreset={handleLoadPreset}
            onDeletePreset={handleDeletePreset}
            loading={loading}
            computeTimeMs={computeTimeMs}
            useWasm={useWasm}
          />
        </aside>

        <main className="main-content">
          <WindScene3D fields={fields} loading={loading} />
        </main>
      </div>

      <footer className="app-footer">
        <span>Fortran 77 重力波参数化模型 → Emscripten/WASM → Three.js 3D 流线可视化</span>
      </footer>
    </div>
  );
}
