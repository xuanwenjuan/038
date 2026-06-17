import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WindFields, Annotation, RoomMember } from '../types';
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

  annotations: Annotation[];
  onSceneClickForAnnotation: (pos: { x: number; y: number; z: number }) => void;
  annotationMode: boolean;
  onSetAnnotationMode: (active: boolean) => void;

  profileMode: boolean;
  onProfilePointsSelected: (p1: { x: number; y: number; z: number }, p2: { x: number; y: number; z: number }) => void;
  onSetProfileMode: (active: boolean) => void;

  remoteCursors: Record<string, { position: { x: number; y: number; z: number }; color: string }>;
  onCursorMove: (pos: { x: number; y: number; z: number }) => void;

  onGotoAnnotation?: (ann: Annotation) => void;
}

export interface WindScene3DHandle {
  getCanvas: () => HTMLCanvasElement | null;
  getCamera: () => THREE.PerspectiveCamera | null;
  setViewpoint: (pos: { x: number; y: number; z: number }) => void;
}

export const WindScene3D = forwardRef<WindScene3DHandle, Props>(({
  fields, referenceFields, loading, rmseStats, splitMode, showParticles, showStreamlines,
  annotations, onSceneClickForAnnotation, annotationMode, onSetAnnotationMode,
  profileMode, onProfilePointsSelected, onSetProfileMode,
  remoteCursors, onCursorMove,
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
  const leftAnnotationsRef = useRef<THREE.Group | null>(null);
  const leftCursorsRef = useRef<THREE.Group | null>(null);
  const leftRaycaster = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const leftMouse = useRef<THREE.Vector2>(new THREE.Vector2());
  const leftPickPlane = useRef<THREE.Plane>(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));

  const rightSceneRef = useRef<THREE.Scene | null>(null);
  const rightRendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const rightCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rightControlsRef = useRef<OrbitControls | null>(null);
  const rightStreamlinesRef = useRef<THREE.Group | null>(null);
  const rightGridRef = useRef<THREE.Group | null>(null);
  const rightParticleRef = useRef<ParticleTracer | null>(null);
  const rightParticleMeshRef = useRef<THREE.Points | null>(null);

  const profileP1Ref = useRef<THREE.Mesh | null>(null);
  const profileP2Ref = useRef<THREE.Mesh | null>(null);
  const profileLineRef = useRef<THREE.Line | null>(null);
  const [profileStep, setProfileStep] = useState<0 | 1>(0);
  const profileP1Data = useRef<{ x: number; y: number; z: number } | null>(null);

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
    getCamera: () => leftCameraRef.current,
    setViewpoint: (pos) => {
      if (leftCameraRef.current && leftControlsRef.current) {
        const cam = leftCameraRef.current;
        cam.position.set(
          pos.x + 300,
          pos.y + 200,
          pos.z + 400
        );
        leftControlsRef.current.target.set(pos.x, pos.y, pos.z);
        leftControlsRef.current.update();
      }
    },
  }));

  const setupScene = useCallback((
    container: HTMLDivElement,
    sceneRef: React.MutableRefObject<THREE.Scene | null>,
    rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>,
    cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>,
    controlsRef: React.MutableRefObject<OrbitControls | null>,
    createCursors: boolean,
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
    controls.target.set(180, 0, 500);
    controlsRef.current = controls;

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(200, 400, 300);
    scene.add(dirLight);
    const pointLight = new THREE.PointLight(0x88aaff, 0.5, 2000);
    pointLight.position.set(-200, 200, -200);
    scene.add(pointLight);

    if (createCursors) {
      const cursorsGroup = new THREE.Group();
      cursorsGroup.name = 'remoteCursors';
      scene.add(cursorsGroup);
      if (container === leftContainerRef.current) {
        leftCursorsRef.current = cursorsGroup;
      }
    }

    return { scene, camera, renderer, controls };
  }, []);

  const createAnnotationSprite = useCallback((ann: Annotation): THREE.Sprite => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = ann.authorColor || '#5ab0ff';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.roundRect(0, 20, 256, 90, 10);
    ctx.fill();

    ctx.fillStyle = 'rgba(10, 14, 26, 0.9)';
    ctx.beginPath();
    ctx.roundRect(8, 28, 240, 82, 8);
    ctx.fill();

    ctx.globalAlpha = 1.0;
    ctx.fillStyle = ann.authorColor || '#5ab0ff';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(ann.author, 20, 58);

    ctx.fillStyle = '#e0e8f0';
    ctx.font = '16px sans-serif';
    const text = ann.text.length > 12 ? ann.text.substring(0, 11) + '…' : ann.text;
    ctx.fillText(text, 20, 86);

    ctx.fillStyle = '#7890a8';
    ctx.font = '12px sans-serif';
    const time = new Date(ann.timestamp * 1000).toLocaleString('zh-CN', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    ctx.fillText(time, 20, 106);

    ctx.fillStyle = ann.authorColor || '#5ab0ff';
    ctx.beginPath();
    ctx.moveTo(128, 10);
    ctx.lineTo(118, 22);
    ctx.lineTo(138, 22);
    ctx.closePath();
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(ann.position.x, ann.position.y, ann.position.z);
    sprite.scale.set(80, 40, 1);
    sprite.userData.annotationId = ann.id;

    return sprite;
  }, []);

  const updateAnnotations = useCallback(() => {
    if (!leftSceneRef.current) return;

    if (leftAnnotationsRef.current) {
      leftSceneRef.current.remove(leftAnnotationsRef.current);
      leftAnnotationsRef.current.traverse(obj => {
        if (obj instanceof THREE.Sprite) {
          obj.material?.dispose();
          (obj.material as any)?.map?.dispose();
        }
      });
    }

    const group = new THREE.Group();
    group.name = 'annotations';
    for (const ann of annotations) {
      const sprite = createAnnotationSprite(ann);
      group.add(sprite);
    }
    leftSceneRef.current.add(group);
    leftAnnotationsRef.current = group;
  }, [annotations, createAnnotationSprite]);

  useEffect(() => {
    updateAnnotations();
  }, [updateAnnotations]);

  const updateRemoteCursors = useCallback(() => {
    if (!leftSceneRef.current) return;
    if (!leftCursorsRef.current) return;

    while (leftCursorsRef.current.children.length > 0) {
      const c = leftCursorsRef.current.children[0];
      leftCursorsRef.current.remove(c);
      if (c instanceof THREE.Mesh) {
        c.geometry?.dispose();
        (c.material as any)?.dispose();
      }
    }

    for (const [sid, cursorData] of Object.entries(remoteCursors)) {
      const geom = new THREE.RingGeometry(8, 12, 16);
      const mat = new THREE.MeshBasicMaterial({
        color: cursorData.color || '#ff6b6b',
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthTest: false,
      });
      const ring = new THREE.Mesh(geom, mat);
      ring.position.set(cursorData.position.x, cursorData.position.y, cursorData.position.z);
      ring.lookAt(leftCameraRef.current?.position || new THREE.Vector3(500, 350, 800));
      ring.userData.sid = sid;
      leftCursorsRef.current.add(ring);
    }
  }, [remoteCursors]);

  useEffect(() => {
    updateRemoteCursors();
  }, [updateRemoteCursors]);

  const updateProfileMarkers = useCallback(() => {
    const scene = leftSceneRef.current;
    if (!scene) return;

    const clearMarkers = () => {
      if (profileP1Ref.current) {
        scene.remove(profileP1Ref.current);
        profileP1Ref.current.geometry.dispose();
        (profileP1Ref.current.material as THREE.Material).dispose();
        profileP1Ref.current = null;
      }
      if (profileP2Ref.current) {
        scene.remove(profileP2Ref.current);
        profileP2Ref.current.geometry.dispose();
        (profileP2Ref.current.material as THREE.Material).dispose();
        profileP2Ref.current = null;
      }
      if (profileLineRef.current) {
        scene.remove(profileLineRef.current);
        profileLineRef.current.geometry.dispose();
        (profileLineRef.current.material as THREE.Material).dispose();
        profileLineRef.current = null;
      }
    };

    if (!profileMode) {
      clearMarkers();
      setProfileStep(0);
      profileP1Data.current = null;
      return;
    }
  }, [profileMode]);

  useEffect(() => {
    updateProfileMarkers();
  }, [updateProfileMarkers]);

  useEffect(() => {
    if (!leftContainerRef.current) return;

    const left = setupScene(
      leftContainerRef.current,
      leftSceneRef, leftRendererRef, leftCameraRef, leftControlsRef,
      true
    );
    if (!left) return;

    let rightSetup: ReturnType<typeof setupScene> | null = null;
    if (splitMode && rightContainerRef.current) {
      rightSetup = setupScene(
        rightContainerRef.current,
        rightSceneRef, rightRendererRef, rightCameraRef, rightControlsRef,
        false
      );
    }

    const recorder = new AnimationRecorder({
      onStart: () => setRecordingState('recording'),
      onStop: (blob: Blob) => {
        setRecordingState('stopped');
        AnimationRecorder.download(blob);
        setTimeout(() => setRecordingState('idle'), 500);
      },
      onError: () => setRecordingState('idle'),
    });
    recorderRef.current = recorder;

    let lastTime = performance.now();

    const handleCanvasClick = (e: MouseEvent, scene: THREE.Scene, camera: THREE.PerspectiveCamera, isLeft: boolean) => {
      if (!isLeft) return;
      if (!annotationMode && !profileMode) return;

      const container = leftContainerRef.current!;
      const rect = container.getBoundingClientRect();
      leftMouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      leftMouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      leftRaycaster.current.setFromCamera(leftMouse.current, camera);

      const dir = leftRaycaster.current.ray.direction.clone();
      const planeNormal = camera.getWorldDirection(new THREE.Vector3()).negate();
      const plane = new THREE.Plane();
      plane.setFromNormalAndCoplanarPoint(
        planeNormal.normalize(),
        new THREE.Vector3(180, 0, 500)
      );

      const intersectPt = new THREE.Vector3();
      leftRaycaster.current.ray.intersectPlane(plane, intersectPt);

      if (!intersectPt || isNaN(intersectPt.x)) return;

      const worldPos = {
        x: Math.max(0, Math.min(360, intersectPt.x)),
        y: Math.max(-90, Math.min(90, intersectPt.y)),
        z: Math.max(0, Math.min(1000, intersectPt.z)),
      };

      if (annotationMode) {
        onSceneClickForAnnotation(worldPos);
        onSetAnnotationMode(false);
      }

      if (profileMode) {
        if (profileStep === 0) {
          if (!leftSceneRef.current) return;
          if (profileP1Ref.current) {
            leftSceneRef.current.remove(profileP1Ref.current);
            profileP1Ref.current.geometry.dispose();
            (profileP1Ref.current.material as THREE.Material).dispose();
          }
          const g = new THREE.SphereGeometry(6, 16, 16);
          const m = new THREE.MeshBasicMaterial({ color: '#4ecdc4', depthTest: false });
          const mesh = new THREE.Mesh(g, m);
          mesh.position.set(worldPos.x, worldPos.y, worldPos.z);
          leftSceneRef.current.add(mesh);
          profileP1Ref.current = mesh;
          profileP1Data.current = worldPos;
          setProfileStep(1);
        } else {
          if (!leftSceneRef.current) return;
          const g = new THREE.SphereGeometry(6, 16, 16);
          const m = new THREE.MeshBasicMaterial({ color: '#ff6b6b', depthTest: false });
          const mesh = new THREE.Mesh(g, m);
          mesh.position.set(worldPos.x, worldPos.y, worldPos.z);
          leftSceneRef.current.add(mesh);
          profileP2Ref.current = mesh;

          if (profileP1Data.current) {
            const p1 = profileP1Data.current;
            const lineGeom = new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(p1.x, p1.y, p1.z),
              new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z),
            ]);
            const lineMat = new THREE.LineDashedMaterial({
              color: '#ffe66d',
              dashSize: 8,
              gapSize: 4,
              linewidth: 2,
              depthTest: false,
            });
            const line = new THREE.Line(lineGeom, lineMat);
            line.computeLineDistances();
            leftSceneRef.current.add(line);
            profileLineRef.current = line;

            onProfilePointsSelected(p1, worldPos);
          }
          setProfileStep(0);
          profileP1Data.current = null;
          onSetProfileMode(false);
        }
      }
    };

    const leftCanvas = left.renderer.domElement;
    const leftClickHandler = (e: MouseEvent) => handleCanvasClick(e, left.scene, left.camera, true);
    leftCanvas.addEventListener('click', leftClickHandler);

    const handleMouseMove = (e: MouseEvent) => {
      if (!leftContainerRef.current || !leftCameraRef.current) return;
      const container = leftContainerRef.current!;
      const rect = container.getBoundingClientRect();
      leftMouse.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      leftMouse.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      leftRaycaster.current.setFromCamera(leftMouse.current, leftCameraRef.current);
      const dir = leftRaycaster.current.ray.direction.clone();
      const planeNormal = leftCameraRef.current.getWorldDirection(new THREE.Vector3()).negate();
      const plane = new THREE.Plane();
      plane.setFromNormalAndCoplanarPoint(
        planeNormal.normalize(),
        new THREE.Vector3(180, 0, 500)
      );
      const intersectPt = new THREE.Vector3();
      leftRaycaster.current.ray.intersectPlane(plane, intersectPt);
      if (intersectPt && !isNaN(intersectPt.x)) {
        onCursorMove({
          x: intersectPt.x,
          y: intersectPt.y,
          z: intersectPt.z,
        });
      }
    };
    leftCanvas.addEventListener('mousemove', handleMouseMove);

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
      leftCanvas.removeEventListener('click', leftClickHandler);
      leftCanvas.removeEventListener('mousemove', handleMouseMove);
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
  }, [splitMode, setupScene, showParticles, annotationMode, profileMode, profileStep, onSceneClickForAnnotation, onSetAnnotationMode, onProfilePointsSelected, onSetProfileMode, onCursorMove]);

  const updateSceneObjects = useCallback((
    fieldsData: WindFields | null,
    scene: THREE.Scene | null,
    streamlinesGroupRef: React.MutableRefObject<THREE.Group | null>,
    gridGroupRef: React.MutableRefObject<THREE.Group | null>,
    particleTracerRef: React.MutableRefObject<ParticleTracer | null>,
    particleMeshRef: React.MutableRefObject<THREE.Points | null>,
    _label: string,
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
      grid.position.set(0, -90, 0);
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
      tracer.setParticleSize(particleSize);
      const mesh = tracer.createMesh();
      mesh.position.set(0, -90, 0);
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
  }, [numLines, tubeRadius, numParticles, particleSpeed, particleSize, showStreamlines, showParticles]);

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

  useEffect(() => {
    if (leftParticleRef.current) {
      leftParticleRef.current.setParticleSize(particleSize);
      leftParticleRef.current.setSpeedScale(particleSpeed);
    }
    if (rightParticleRef.current) {
      rightParticleRef.current.setParticleSize(particleSize);
      rightParticleRef.current.setSpeedScale(particleSpeed);
    }
  }, [particleSize, particleSpeed]);

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
          {(annotationMode || profileMode) && (
            <div className="mode-indicator">
              {annotationMode && <span className="mode-tag ann-tag">📌 点击放置标注</span>}
              {profileMode && (
                <span className="mode-tag profile-tag">
                  📊 {profileStep === 0 ? '选择起点' : '选择终点'}
                </span>
              )}
              <button
                className="mode-cancel"
                onClick={() => {
                  onSetAnnotationMode(false);
                  onSetProfileMode(false);
                }}
              >
                取消
              </button>
            </div>
          )}
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
