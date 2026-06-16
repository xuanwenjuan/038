import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { WindFields } from '../types';
import { computeStreamlines, createStreamlineTubes, createGridBox } from '../vis/streamlines';

interface Props {
  fields: WindFields | null;
  loading: boolean;
}

export const WindScene3D: React.FC<Props> = ({ fields, loading }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const streamlinesRef = useRef<THREE.Group | null>(null);
  const gridRef = useRef<THREE.Group | null>(null);
  const animRef = useRef<number>(0);
  const [numLines, setNumLines] = useState(60);
  const [tubeRadius, setTubeRadius] = useState(0.6);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0e1a);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    camera.position.set(500, 350, 800);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
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

    const animate = () => {
      animRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const updateStreamlines = useCallback(() => {
    if (!fields || !sceneRef.current) return;

    if (streamlinesRef.current) {
      sceneRef.current.remove(streamlinesRef.current);
      streamlinesRef.current.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (obj.material instanceof THREE.Material) {
            obj.material.dispose();
          }
        }
      });
      streamlinesRef.current = null;
    }

    const { points, speeds } = computeStreamlines(fields, {
      numStreamlines: numLines,
    });

    const tubes = createStreamlineTubes(points, speeds, {
      tubeRadius,
      radialSegments: 6,
    });
    tubes.position.set(0, 0, 0);
    sceneRef.current.add(tubes);
    streamlinesRef.current = tubes;

    if (!gridRef.current) {
      const grid = createGridBox(fields.dims);
      grid.position.set(0, 0, 0);
      sceneRef.current.add(grid);
      gridRef.current = grid;
    }
  }, [fields, numLines, tubeRadius]);

  useEffect(() => {
    updateStreamlines();
  }, [updateStreamlines]);

  return (
    <div className="scene-container">
      <div ref={containerRef} className="scene-canvas" />
      {loading && (
        <div className="loading-overlay">
          <div className="loading-spinner" />
          <span>正在计算风场...</span>
        </div>
      )}
      <div className="scene-controls">
        <label>
          流线数量: {numLines}
          <input
            type="range" min="10" max="150" step="5"
            value={numLines}
            onChange={e => setNumLines(parseInt(e.target.value))}
          />
        </label>
        <label>
          管半径: {tubeRadius.toFixed(2)}
          <input
            type="range" min="0.2" max="2.0" step="0.1"
            value={tubeRadius}
            onChange={e => setTubeRadius(parseFloat(e.target.value))}
          />
        </label>
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
};
