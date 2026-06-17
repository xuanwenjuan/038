import React from 'react';
import { ModelParams, PresetEntry, RoomMember, Annotation } from '../types';
import { CollaborationPanel } from './CollaborationPanel';
import { AnnotationPanel } from './AnnotationPanel';

interface Props {
  params: ModelParams;
  onChange: (params: ModelParams) => void;
  onCompute: () => void;
  onSavePreset: (name: string) => void;
  presets: PresetEntry[];
  onLoadPreset: (preset: PresetEntry) => void;
  onDeletePreset: (id: number) => void;
  loading: boolean;
  computeTimeMs: number;
  useWasm: boolean;
  splitMode: boolean;
  onToggleSplit: () => void;
  showParticles: boolean;
  onToggleParticles: () => void;
  showStreamlines: boolean;
  onToggleStreamlines: () => void;

  roomId: string | null;
  connected: boolean;
  userName: string;
  userColor: string;
  members: RoomMember[];
  onJoinRoom: (roomId: string | null, userName: string, color: string) => void;
  onLeaveRoom: () => void;

  annotations: Annotation[];
  setAnnotations: React.Dispatch<React.SetStateAction<Annotation[]>>;
  onGotoAnnotation: (ann: Annotation) => void;

  profileMode: boolean;
  onToggleProfileMode: () => void;
  annotationMode: boolean;
  onToggleAnnotationMode: () => void;
}

export const ControlPanel: React.FC<Props> = ({
  params, onChange, onCompute,
  onSavePreset, presets, onLoadPreset, onDeletePreset,
  loading, computeTimeMs, useWasm,
  splitMode, onToggleSplit,
  showParticles, onToggleParticles,
  showStreamlines, onToggleStreamlines,

  roomId, connected, userName, userColor, members,
  onJoinRoom, onLeaveRoom,

  annotations, setAnnotations, onGotoAnnotation,

  profileMode, onToggleProfileMode,
  annotationMode, onToggleAnnotationMode,
}) => {
  const [presetName, setPresetName] = React.useState('');
  const [activeTab, setActiveTab] = React.useState<'params' | 'annotations'>('params');

  const handleChange = (key: keyof ModelParams, value: number) => {
    onChange({ ...params, [key]: value });
  };

  const handleSave = () => {
    const name = presetName.trim() || `预设 ${presets.length + 1}`;
    onSavePreset(name);
    setPresetName('');
  };

  return (
    <div className="control-panel">
      <h2>参数控制面板</h2>

      <div className="status-row">
        <span className={`mode-badge ${useWasm ? 'wasm' : 'fallback'}`}>
          {useWasm ? 'WASM 模式' : 'JS 回退模式'}
        </span>
        <span className="time-badge">
          计算耗时: {computeTimeMs.toFixed(0)} ms
        </span>
      </div>

      <div className="panel-tabs">
        <button
          className={`tab-btn ${activeTab === 'params' ? 'active' : ''}`}
          onClick={() => setActiveTab('params')}
        >
          ⚙️ 参数
        </button>
        <button
          className={`tab-btn ${activeTab === 'annotations' ? 'active' : ''}`}
          onClick={() => setActiveTab('annotations')}
        >
          📌 标注 ({annotations.length})
        </button>
      </div>

      {activeTab === 'params' ? (
        <>
          <CollaborationPanel
            roomId={roomId}
            connected={connected}
            userName={userName}
            userColor={userColor}
            members={members}
            onJoinRoom={onJoinRoom}
            onLeaveRoom={onLeaveRoom}
            onToggleProfileMode={onToggleProfileMode}
            profileMode={profileMode}
            onToggleAnnotationMode={onToggleAnnotationMode}
            annotationMode={annotationMode}
            currentParams={params}
          />

          <div className="param-group">
            <h3>初始参数</h3>

            <div className="slider-item">
              <label>
                风切变 (wind shear): {params.windShear.toFixed(4)} s⁻¹
              </label>
              <input
                type="range"
                min="0.001" max="0.03" step="0.0005"
                value={params.windShear}
                onChange={e => handleChange('windShear', parseFloat(e.target.value))}
              />
              <div className="slider-range">
                <span>0.001</span><span>0.03</span>
              </div>
            </div>

            <div className="slider-item">
              <label>
                浮力频率 (buoyancy freq): {params.buoyFreq.toFixed(4)} s⁻¹
              </label>
              <input
                type="range"
                min="0.005" max="0.05" step="0.001"
                value={params.buoyFreq}
                onChange={e => handleChange('buoyFreq', parseFloat(e.target.value))}
              />
              <div className="slider-range">
                <span>0.005</span><span>0.05</span>
              </div>
            </div>

            <div className="slider-item">
              <label>
                柯氏参数 (coriolis): {params.coriolis.toExponential(2)} s⁻¹
              </label>
              <input
                type="range"
                min="1e-5" max="5e-4" step="1e-5"
                value={params.coriolis}
                onChange={e => handleChange('coriolis', parseFloat(e.target.value))}
              />
              <div className="slider-range">
                <span>1e-5</span><span>5e-4</span>
              </div>
            </div>

            <button
              className="compute-btn"
              onClick={onCompute}
              disabled={loading}
            >
              {loading ? '计算中...' : '⚡ 计算风场'}
            </button>
          </div>

          <div className="param-group">
            <h3>可视化模式</h3>

            <div className="toggle-row">
              <button
                className={`toggle-btn ${showStreamlines ? 'active' : ''}`}
                onClick={onToggleStreamlines}
              >
                {showStreamlines ? '✓' : '○'} 流线管道
              </button>
              <button
                className={`toggle-btn ${showParticles ? 'active' : ''}`}
                onClick={onToggleParticles}
              >
                {showParticles ? '✓' : '○'} GPU 粒子示踪
              </button>
            </div>

            <button
              className={`toggle-btn split-btn ${splitMode ? 'active' : ''}`}
              onClick={onToggleSplit}
            >
              {splitMode ? '✓' : '○'} 分屏双模对比
            </button>

            {splitMode && (
              <div className="split-hint">
                左: WASM/JS 计算 | 右: 基准 API
                <br />
                角落显示 RMSE 误差
              </div>
            )}
          </div>

          <div className="param-group">
            <h3>预设管理</h3>
            <div className="preset-input">
              <input
                type="text"
                placeholder="预设名称"
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
              />
              <button onClick={handleSave} className="save-btn">
                保存
              </button>
            </div>

            <div className="preset-list">
              {presets.length === 0 ? (
                <p className="empty-hint">暂无保存的预设</p>
              ) : (
                presets.map(p => (
                  <div key={p.id} className="preset-item">
                    <button
                      className="preset-name"
                      onClick={() => onLoadPreset(p)}
                      title="加载预设"
                    >
                      {p.name}
                    </button>
                    <span className="preset-count">
                      使用 {p.useCount || 0} 次
                    </span>
                    <button
                      className="preset-delete"
                      onClick={() => p.id && onDeletePreset(p.id)}
                      title="删除"
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="info-group">
            <h3>网格信息</h3>
            <div className="info-row">
              <span>经度网格:</span><span>32</span>
            </div>
            <div className="info-row">
              <span>纬度网格:</span><span>32</span>
            </div>
            <div className="info-row">
              <span>高度层数:</span><span>20</span>
            </div>
            <div className="info-row">
              <span>总网格点:</span><span>20,480</span>
            </div>
            <div className="info-row">
              <span>数据大小:</span><span>491 KB</span>
            </div>
          </div>
        </>
      ) : (
        <AnnotationPanel
          roomId={roomId}
          connected={connected}
          currentUser={userName}
          userColor={userColor}
          annotations={annotations}
          setAnnotations={setAnnotations}
          members={members}
          onGotoAnnotation={onGotoAnnotation}
          currentParams={params}
        />
      )}
    </div>
  );
};
