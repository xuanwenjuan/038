import { PresetEntry, ModelParams } from '../types';

const DB_NAME = 'GravityWavePresets';
const DB_VERSION = 1;
const STORE_NAME = 'presets';

export class IndexedDBCache {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true,
          });
          store.createIndex('name', 'name', { unique: false });
          store.createIndex('useCount', 'useCount', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = (e) => {
        this.db = (e.target as IDBOpenDBRequest).result;
        resolve();
      };
      req.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
    });
  }

  async addPreset(preset: Omit<PresetEntry, 'id' | 'createdAt' | 'useCount'>): Promise<number> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not initialized'));
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const entry: PresetEntry = {
        ...preset,
        createdAt: Date.now(),
        useCount: 0,
      };
      const req = store.add(entry);
      req.onsuccess = () => resolve(req.result as number);
      req.onerror = () => reject(req.error);
    });
  }

  async getPresets(): Promise<PresetEntry[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not initialized'));
      const tx = this.db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => {
        const presets = req.result as PresetEntry[];
        presets.sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
        resolve(presets);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deletePreset(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not initialized'));
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async incrementUseCount(id: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not initialized'));
      const tx = this.db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const preset = getReq.result as PresetEntry | undefined;
        if (!preset) { reject(); return; }
        preset.useCount = (preset.useCount || 0) + 1;
        const putReq = store.put(preset);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

export const defaultPresets: Omit<PresetEntry, 'id' | 'createdAt' | 'useCount'>[] = [
  { name: '标准大气', params: { windShear: 0.005, buoyFreq: 0.02, coriolis: 1e-4 } },
  { name: '强风切变', params: { windShear: 0.015, buoyFreq: 0.025, coriolis: 1.2e-4 } },
  { name: '低浮力频率', params: { windShear: 0.008, buoyFreq: 0.012, coriolis: 1e-4 } },
  { name: '极地高纬度', params: { windShear: 0.01, buoyFreq: 0.018, coriolis: 1.5e-4 } },
];
