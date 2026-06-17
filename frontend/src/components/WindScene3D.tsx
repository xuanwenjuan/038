import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WindFields } from '../types';
import { computeStreamlines, createStreamlineTubes, createGridBox } from '../vis/streamlines';
import { ParticleTracer } from '../vis/ParticleTracer';
import { AnimationRecorder, RecordingState } from '../recording/AnimationRecorder';
import { RMSEStats } from '../vis/RMSECalculator';

interface Props {
  fields: WindFields | null;
  referenceFields: WindFields | null;
  loading: boolean;
  rmseStats: RMSEStats | null;
  splitMode: boolean;
  showParticles: boolean;
  showStreamlines: boolean;
}

export interface WindScene3DHandle {
  getCanvas: () => HTMLCanvasElement | null;
}

export const WindScene3D = forwardRef<WindScene3DHandle, Props>(({
  fields, referenceFields, loading, rmseStats, splitMode, showParticles, showStreamlines,
}, ref) => {
  const leftContainerRef = useRef<HTMLDivElement>(null);
  const rightContainerRef = useRef<HTMLDivElement>(null);

  const leftSceneRef = useRef<THREE.Scene | null>(null);
  const leftRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const leftCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const leftControlsRef = useRef<OrbitControls | null>(null);
  const leftStreamlinesRef = useRef<THREE.Group | null>(null);
  const leftGridRef = useRef<THREE.Group | null>(null);
  const leftParticleRef = useRef<ParticleTracer | null>(null);
  const leftParticleMeshRef = useRef<THREE.Points | null>(null);

  const rightSceneRef = useRef<THREE.Scene | null>(null);
  const rightRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const rightCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rightControlsRef = useRef<OrbitControls | null>(null);
  const rightStreamlinesRef = useRef<THREE.Group | null>(null);
  const rightGridRef = useRef<THREE.Group | null>(null);
  const rightParticleRef = useRef<ParticleTracer | null>(null);
  const rightParticleMeshRef = useRef<THREE.Points | null>(null);

  const animRef = useRef<number>(0);
  const recorderRef = useRef<AnimationRecorder | null>(null);
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');

  const [numLines, setNumLines] = useState(60);
  const [tubeRadius, setTubeRadius] = useState(0.6);
  const [particleSize, setParticleSize] = useState(3.0);
  const [particleSpeed, setParticleSpeed] = useState(2.0);
  const [numParticles, setNumParticles] = useState(5000);

  useImperativeHandle(ref, () => ({
    getCanvas: () => leftRendererRef.current?.domElement || null,
  }));

  const setupScene = useCallback((
    container: HTMLDivElement,
    sceneRef: React.MutableRefObject<THREE.Scene | null>,
    rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>,
    cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>,
    controlsRef: React.MutableRefObject<OrbitControls | null>,
  ) => {
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e1a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    camera.position.set(500, 350, 800);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(200, 400, 300);
    scene.add(dirLight);
    const pointLight = new THREE.PointLight(0x88aaff, 0.5, 2000);
    pointLight.position.set(-200, 200, -200);
    scene.add(pointLight);

    return { scene, camera, renderer, controls };
  }, []);

  useEffect(() => {
    if (!leftContainerRef.current) return;

    const left = setupScene(
      leftContainerRef.current,
      leftSceneRef, leftRendererRef, leftCameraRef, leftControlsRef
    );
    if (!left) return;

    let rightSetup: ReturnType<typeof setupScene> | null = null;
    if (splitMode && rightContainerRef.current) {
      rightSetup = setupScene(
        rightContainerRef.current,
        rightSceneRef, rightRendererRef, rightCameraRef, rightControlsRef
      );
    }

    const recorder = new AnimationRecorder({
      onStart: () => setRecordingState('recording'),
      onStop: (blob: Blob) => {
        setRecordingState('stopped');
        AnimationRecorder.download(blob);
        setRecordingState('idle');
      },
      onError: () => setRecordingState('idle'),
    });
    recorderRef.current = recorder;

    let lastTime = performance.now();

    const animate = () => {
      animRef.current = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      left.controls.update();

      if (leftParticleRef.current && showParticles) {
        leftParticleRef.current.update(dt);
      }

      left.renderer.render(left.scene, left.camera);

      if (rightSetup) {
        rightSetup.controls.update();
        if (rightParticleRef.current && showParticles) {
          rightParticleRef.current.update(dt);
        }
        rightSetup.renderer.render(rightSetup.scene, rightSetup.camera);
      }
    };
    animate();

    const handleResize = () => {
      if (leftContainerRef.current) {
        const w = leftContainerRef.current.clientWidth;
        const h = leftContainerRef.current.clientHeight;
        left.camera.aspect = w / h;
        left.camera.updateProjectionMatrix();
        left.renderer.setSize(w, h);
      }
      if (rightSetup && rightContainerRef.current) {
        const w = rightContainerRef.current.clientWidth;
        const h = rightContainerRef.current.clientHeight;
        rightSetup.camera.aspect = w / h;
        rightSetup.camera.updateProjectionMatrix();
        rightSetup.renderer.setSize(w, h);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', handleResize);
      left.renderer.dispose();
      if (leftContainerRef.current && leftContainerRef.current.contains(left.renderer.domElement)) {
        leftContainerRef.current.removeChild(left.renderer.domElement);
      }
      if (rightSetup) {
        rightSetup.renderer.dispose();
        if (rightContainerRef.current && rightContainerRef.current.contains(rightSetup.renderer.domElement)) {
          rightContainerRef.current.removeChild(rightSetup.renderer.domElement);
        }
      }
      leftParticleRef.current?.dispose();
      rightParticleRef.current?.dispose();
    };
  }, [splitMode, setupScene, showParticles]);

  const updateSceneObjects = useCallback((
    fieldsData: WindFields | null,
    scene: THREE.Scene | null,
    streamlinesGroupRef: React.MutableRefObject<THREE.Group | null>,
    gridGroupRef: React.MutableRefObject<THREE.Group | null>,
    particleTracerRef: React.MutableRefObject<ParticleTracer | null>,
    particleMeshRef: React.MutableRefObject<THREE.Points | null>,
    label: string,
  ) => {
    if (!fieldsData || !scene) return;

    if (streamlinesGroupRef.current) {
      scene.remove(streamlinesGroupRef.current);
      streamlinesGroupRef.current.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (obj.material instanceof THREE.Material) obj.material.dispose();
        }
      });
      streamlinesGroupRef.current = null;
    }

    if (showStreamlines) {
      const { points, speeds } = computeStreamlines(fieldsData, { numStreamlines: numLines });
      const tubes = createStreamlineTubes(points, speeds, { tubeRadius, radialSegments: 6 });
      scene.add(tubes);
      streamlinesGroupRef.current = tubes;
    }

    if (!gridGroupRef.current) {
      const grid = createGridBox(fieldsData.dims);
      scene.add(grid);
      gridGroupRef.current = grid;
    }

    if (showParticles) {
      if (particleMeshRef.current) {
        scene.remove(particleMeshRef.current);
        particleMeshRef.current = null;
      }
      particleTracerRef.current?.dispose();

      const tracer = new ParticleTracer({ numParticles, speedScale: particleSpeed });
      tracer.setFields(fieldsData);
      const mesh = tracer.createMesh();
      mesh.position.set(0, 0, 0);
      scene.add(mesh);
      particleTracerRef.current = tracer;
      particleMeshRef.current = mesh;
    } else {
      if (particleMeshRef.current && scene) {
        scene.remove(particleMeshRef.current);
        particleMeshRef.current = null;
      }
      particleTracerRef.current?.dispose();
      particleTracerRef.current = null;
    }
  }, [numLines, tubeRadius, numParticles, particleSpeed, showStreamlines, showParticles]);

  useEffect(() => {
    updateSceneObjects(
      fields, leftSceneRef.current,
      leftStreamlinesRef, leftGridRef, leftParticleRef, leftParticleMeshRef,
      'WASM'
    );
  }, [fields, updateSceneObjects]);

  useEffect(() => {
    if (splitMode && referenceFields && rightSceneRef.current) {
      updateSceneObjects(
        referenceFields, rightSceneRef.current,
        rightStreamlinesRef, rightGridRef, rightParticleRef, rightParticleMeshRef,
        '基准'
      );
    }
  }, [referenceFields, splitMode, updateSceneObjects]);

  const handleRecordToggle = useCallback(() => {
    if (!recorderRef.current) return;
    if (recordingState === 'recording') {
      recorderRef.current.stop();
    } else {
      const canvas = leftRendererRef.current?.domElement;
      if (canvas) {
        recorderRef.current.start(canvas, 30);
      }
    }
  }, [recordingState]);

  return (
    <div className="scene-wrapper">
      <div className={`scene-split ${splitMode ? 'split-active' : ''}`}>
        <div className="scene-panel scene-left">
          <div ref={leftContainerRef} className="scene-canvas" />
          <div className="scene-label label-wasm">
            {splitMode ? 'WASM / JS 回退' : ''}
          </div>
          {loading && (
            <div className="loading-overlay">
              <div className="loading-spinner" />
              <span>正在计算风场...</span>
            </div>
          )}
        </div>

        {splitMode && (
          <div className="scene-panel scene-right">
            <div ref={rightContainerRef} className="scene-canvas" />
            <div className="scene-label label-ref">基准 API</div>
          </div>
        )}
      </div>

      {splitMode && rmseStats && (
        <div className="rmse-overlay">
          <div className="rmse-title">RMSE 对比</div>
          <div className="rmse-row">
            <span>U:</span><span className="rmse-val">{rmseStats.uRmse.toFixed(4)}</span>
          </div>
          <div className="rmse-row">
            <span>V:</span><span className="rmse-val">{rmseStats.vRmse.toFixed(4)}</span>
          </div>
          <div className="rmse-row">
            <span>W:</span><span className="rmse-val">{rmseStats.wRmse.toFixed(4)}</span>
          </div>
          <div className="rmse-divider" />
          <div className="rmse-row rmse-corr">
            <span>相关系数</span>
          </div>
          <div className="rmse-row">
            <span>U:</span><span className="rmse-val">{rmseStats.uCorr.toFixed(4)}</span>
          </div>
          <div className="rmse-row">
            <span>V:</span><span className="rmse-val">{rmseStats.vCorr.toFixed(4)}</span>
          </div>
          <div className="rmse-row">
            <span>W:</span><span className="rmse-val">{rmseStats.wCorr.toFixed(4)}</span>
          </div>
        </div>
      )}

      <div className="scene-toolbar">
        <div className="toolbar-section">
          <label>
            流线: {numLines}
            <input type="range" min="10" max="150" step="5" value={numLines}
              onChange={e => setNumLines(parseInt(e.target.value))} />
          </label>
          <label>
            管径: {tubeRadius.toFixed(1)}
            <input type="range" min="0.2" max="2.0" step="0.1" value={tubeRadius}
              onChange={e => setTubeRadius(parseFloat(e.target.value))} />
          </label>
        </div>
        <div className="toolbar-section">
          <label>
            粒子: {numParticles}
            <input type="range" min="1000" max="20000" step="500" value={numParticles}
              onChange={e => setNumParticles(parseInt(e.target.value))} />
          </label>
          <label>
            粒径: {particleSize.toFixed(1)}
            <input type="range" min="1" max="8" step="0.5" value={particleSize}
              onChange={e => setParticleSize(parseFloat(e.target.value))} />
          </label>
          <label>
            速度: {particleSpeed.toFixed(1)}
            <input type="range" min="0.5" max="6" step="0.5" value={particleSpeed}
              onChange={e => setParticleSpeed(parseFloat(e.target.value))} />
          </label>
        </div>
        <div className="toolbar-section">
          <button
            className={`rec-btn ${recordingState === 'recording' ? 'rec-active' : ''}`}
            onClick={handleRecordToggle}
          >
            {recordingState === 'recording' ? '⏹ 停止录制' : '⏺ 录制 WebM'}
          </button>
        </div>
      </div>

      <div className="color-legend">
        <div className="legend-title">风速大小</div>
        <div className="legend-bar" />
        <div className="legend-labels">
          <span>小</span><span>大</span>
        </div>
      </div>
    </div>
  );
});
