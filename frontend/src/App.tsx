import React, { useState, useEffect, useCallback, useRef } from 'react';
import { WasmLoader } from './wasm/WasmLoader';
import { IndexedDBCache, defaultPresets } from './db/IndexedDBCache';
import { ControlPanel } from './components/ControlPanel';
import { WindScene3D, WindScene3DHandle } from './components/WindScene3D';
import { ProfileChart } from './components/ProfileChart';
import { CollaborationService } from './collaboration/CollaborationService';
import { createAnnotation } from './collaboration/annotationApi';
import { extractProfile } from './collaboration/profileApi';
import { ModelParams, WindFields, PresetEntry, Annotation, RoomMember, ProfileData } from './types';
import { computeRMSE, fetchBackendFields, RMSEStats, BackendFetchResult } from './vis/RMSECalculator';
import './App.css';

const DEFAULT_PARAMS: ModelParams = {
  windShear: 0.008,
  buoyFreq: 0.02,
  coriolis: 1e-4,
};

const USER_COLORS = ['#5ab0ff', '#ff6b6b', '#4ecdc4', '#ffe66d', '#a29bfe', '#fd79a8', '#00b894', '#e17055'];
const randomColor = () => USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];

export default function App() {
  const [params, setParams] = useState<ModelParams>(DEFAULT_PARAMS);
  const [fields, setFields] = useState<WindFields | null>(null);
  const [referenceFields, setReferenceFields] = useState<WindFields | null>(null);
  const [loading, setLoading] = useState(false);
  const [computeTimeMs, setComputeTimeMs] = useState(0);
  const [useWasm, setUseWasm] = useState(true);
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [splitMode, setSplitMode] = useState(false);
  const [showParticles, setShowParticles] = useState(true);
  const [showStreamlines, setShowStreamlines] = useState(true);
  const [rmseStats, setRmseStats] = useState<RMSEStats | null>(null);

  const [roomId, setRoomId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [userName, setUserName] = useState<string>(`用户_${Math.random().toString(36).slice(2, 6)}`);
  const [userColor, setUserColor] = useState<string>(randomColor());
  const [members, setMembers] = useState<RoomMember[]>([]);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, { position: { x: number; y: number; z: number }; color: string }>>({});

  const [annotationMode, setAnnotationMode] = useState(false);
  const [profileMode, setProfileMode] = useState(false);
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const wasmLoaderRef = useRef<WasmLoader | null>(null);
  const dbCacheRef = useRef<IndexedDBCache | null>(null);
  const collabRef = useRef<CollaborationService | null>(null);
  const sceneRef = useRef<WindScene3DHandle>(null);
  const initializedRef = useRef(false);
  const lastCursorSentRef = useRef<number>(0);
  const latestBackendRequestIdRef = useRef<number>(0);

  const handleParamChange = useCallback((newParams: ModelParams) => {
    setParams(newParams);
    if (collabRef.current && collabRef.current.isConnected()) {
      collabRef.current.sendParams(newParams);
    }
  }, []);

  const handleJoinRoom = useCallback(async (room: string | null, name: string, color: string) => {
    setUserName(name);
    setUserColor(color);
    const service = new CollaborationService('http://localhost:8000');
    collabRef.current = service;

    service.on('onParamsUpdated', (newParams, _fromSid) => {
      setParams(newParams);
    });

    service.on('onMemberJoined', (_member) => {
    });

    service.on('onMemberLeft', (_sid) => {
    });

    service.on('onRoomMembers', (mList) => {
      setMembers(mList);
    });

    service.on('onCursorMoved', (sid, pos) => {
      const member = members.find(m => m.sid === sid);
      setRemoteCursors(prev => ({
        ...prev,
        [sid]: { position: pos, color: member?.color || '#ff6b6b' },
      }));
    });

    service.on('onAnnotationAdded', (ann) => {
      setAnnotations(prev => [ann, ...prev]);
    });

    service.on('onAnnotationDeleted', (annId) => {
      setAnnotations(prev => prev.filter(a => a.id !== annId));
    });

    service.on('onConnect', () => {
      setConnected(true);
    });

    service.on('onDisconnect', () => {
      setConnected(false);
    });

    try {
      const result = await service.connect(room, name, color);
      setRoomId(result.roomId);
      setConnected(result.success);
      setMembers(result.members);
      if (result.success && !room) {
        service.sendParams(params);
      }
    } catch (e) {
      console.warn('连接协同服务失败（使用本地模式）');
      setRoomId(room || 'local');
      setConnected(false);
    }
  }, [params, members]);

  const handleLeaveRoom = useCallback(() => {
    if (collabRef.current) {
      collabRef.current.disconnect();
      collabRef.current = null;
    }
    setRoomId(null);
    setConnected(false);
    setMembers([]);
    setRemoteCursors({});
  }, []);

  const handleSceneClickForAnnotation = useCallback(async (pos: { x: number; y: number; z: number }) => {
    const newAnn = await createAnnotation({
      roomId: roomId || 'local',
      author: userName,
      authorColor: userColor,
      text: `风场特征点 @ (${pos.x.toFixed(0)}, ${pos.y.toFixed(0)}, ${pos.z.toFixed(0)})`,
      position: pos,
      params,
    });

    if (newAnn) {
      setAnnotations(prev => [newAnn, ...prev]);
      if (collabRef.current?.isConnected()) {
        collabRef.current.sendAnnotation(newAnn);
      }
    }

    setAnnotationMode(false);
  }, [roomId, userName, userColor, params]);

  const handleProfilePointsSelected = useCallback(async (
    p1: { x: number; y: number; z: number },
    p2: { x: number; y: number; z: number }
  ) => {
    setProfileLoading(true);
    const data = await extractProfile(params, p1, p2, 50);
    if (data) {
      setProfileData(data);
    }
    setProfileLoading(false);
  }, [params]);

  const handleCursorMove = useCallback((pos: { x: number; y: number; z: number }) => {
    const now = Date.now();
    if (now - lastCursorSentRef.current < 50) return;
    lastCursorSentRef.current = now;
    if (collabRef.current?.isConnected()) {
      collabRef.current.sendCursor(pos);
    }
  }, []);

  const handleGotoAnnotation = useCallback((ann: Annotation) => {
    sceneRef.current?.setViewpoint(ann.position);
  }, []);

  useEffect(() => {
    const init = async () => {
      const loader = new WasmLoader();
      await loader.load();
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
      if (collabRef.current) {
        collabRef.current.disconnect();
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

      if (splitMode) {
        const expectedSig = `${params.windShear.toFixed(8)}_${params.buoyFreq.toFixed(8)}_${params.coriolis.toExponential(4)}`;
        const req: BackendFetchResult = fetchBackendFields(params);
        latestBackendRequestIdRef.current = req.requestId;

        req.promise.then(({ fields: ref, requestId, paramsSig }) => {
          if (requestId !== latestBackendRequestIdRef.current) {
            console.log(`[RMSE] 忽略过期响应 #${requestId}, 当前最新 #${latestBackendRequestIdRef.current}`);
            return;
          }
          if (paramsSig !== expectedSig) {
            console.warn(`[RMSE] 参数签名不匹配, 忽略响应 #${requestId}`);
            return;
          }
          setReferenceFields(ref);
          if (ref && result) {
            setRmseStats(computeRMSE(result, ref));
          }
        });
      }
    });
  }, [params, splitMode]);

  const handleToggleSplit = useCallback(async () => {
    const next = !splitMode;
    setSplitMode(next);
    if (next && fields) {
      const expectedSig = `${params.windShear.toFixed(8)}_${params.buoyFreq.toFixed(8)}_${params.coriolis.toExponential(4)}`;
      const req: BackendFetchResult = fetchBackendFields(params);
      latestBackendRequestIdRef.current = req.requestId;

      const { fields: ref, requestId, paramsSig } = await req.promise;
      if (requestId !== latestBackendRequestIdRef.current) {
        console.log(`[RMSE] 忽略过期响应 #${requestId}, 当前最新 #${latestBackendRequestIdRef.current}`);
        return;
      }
      if (paramsSig !== expectedSig) {
        console.warn(`[RMSE] 参数签名不匹配, 忽略响应 #${requestId}`);
        return;
      }
      setReferenceFields(ref);
      if (ref) {
        setRmseStats(computeRMSE(fields, ref));
      }
    }
  }, [splitMode, fields, params]);

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
        <h1>平流层重力波 3D 风场可视化 · 协同参数调优室</h1>
        <p className="subtitle">
          Emscripten/WASM · GPU 粒子示踪 · WebSocket 多人协同 · 书签标注 · 剖面提取 · WebM 导出
        </p>
      </header>

      <div className="app-main">
        <aside className="sidebar">
          <ControlPanel
            params={params}
            onChange={handleParamChange}
            onCompute={handleCompute}
            onSavePreset={handleSavePreset}
            presets={presets}
            onLoadPreset={handleLoadPreset}
            onDeletePreset={handleDeletePreset}
            loading={loading}
            computeTimeMs={computeTimeMs}
            useWasm={useWasm}
            splitMode={splitMode}
            onToggleSplit={handleToggleSplit}
            showParticles={showParticles}
            onToggleParticles={() => setShowParticles(p => !p)}
            showStreamlines={showStreamlines}
            onToggleStreamlines={() => setShowStreamlines(p => !p)}

            roomId={roomId}
            connected={connected}
            userName={userName}
            userColor={userColor}
            members={members}
            onJoinRoom={handleJoinRoom}
            onLeaveRoom={handleLeaveRoom}

            annotations={annotations}
            setAnnotations={setAnnotations}
            onGotoAnnotation={handleGotoAnnotation}

            profileMode={profileMode}
            onToggleProfileMode={() => {
              setProfileMode(p => !p);
              setAnnotationMode(false);
            }}
            annotationMode={annotationMode}
            onToggleAnnotationMode={() => {
              setAnnotationMode(a => !a);
              setProfileMode(false);
            }}
          />
        </aside>

        <main className="main-content">
          <WindScene3D
            ref={sceneRef}
            fields={fields}
            referenceFields={referenceFields}
            loading={loading}
            rmseStats={rmseStats}
            splitMode={splitMode}
            showParticles={showParticles}
            showStreamlines={showStreamlines}

            annotations={annotations}
            onSceneClickForAnnotation={handleSceneClickForAnnotation}
            annotationMode={annotationMode}
            onSetAnnotationMode={setAnnotationMode}

            profileMode={profileMode}
            onProfilePointsSelected={handleProfilePointsSelected}
            onSetProfileMode={setProfileMode}

            remoteCursors={remoteCursors}
            onCursorMove={handleCursorMove}

            onGotoAnnotation={handleGotoAnnotation}
          />

          {profileLoading && (
            <div className="profile-loading-overlay">
              <div className="loading-spinner" />
              <span>正在提取剖面数据...</span>
            </div>
          )}

          <ProfileChart
            profileData={profileData}
            onClose={() => setProfileData(null)}
          />
        </main>
      </div>

      <footer className="app-footer">
        <span>Fortran 77 → WASM · Three.js · Chart.js · WebSocket 多人协同 · MongoDB 标注持久化</span>
      </footer>
    </div>
  );
}
