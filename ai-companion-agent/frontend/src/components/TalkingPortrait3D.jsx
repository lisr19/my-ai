import React, { useRef, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Float, ContactShadows, Sparkles, OrbitControls, Environment } from '@react-three/drei';
import * as THREE from 'three';
import { LipSyncCanvas, estimateMouthRegion } from '../utils/lipSyncCanvas.js';
import './DigitalHuman3D.css';

const PORTRAIT_URL = '/portrait.jpg';

/**
 * TalkingPortrait3D — Sonic 风格的"音频驱动视频"+ Three.js 呈现
 *
 * 架构：
 *   TTS 音频 → Web Audio 实时分析 (useEdgeTTS 内嵌)
 *   → amplitudeRef 更新
 *   → useFrame 每帧读取 amplitude
 *   → Canvas 重绘（Portrait + 动态嘴型）
 *   → THREE.CanvasTexture 自动更新
 *   → 3D 场景中的曲面平面渲染
 *
 * 优势：不需要重 ML 模型（如 Sonic/Wav2Lip），无需预生成视频
 */
function TalkingPortraitPlane({ lipSyncRef, emotions, emotion }) {
  const meshRef = useRef();
  const textureRef = useRef();
  const { gl } = useThree();

  // 每帧从 lipSyncCanvas 读取 amp 并重绘
  useFrame((state, delta) => {
    if (!lipSyncRef.current || !meshRef.current) return;

    const amp = lipSyncRef.current.getAmplitude ? lipSyncRef.current.getAmplitude() : 0;
    lipSyncRef.current.draw(amp);

    // 让 Three.js 知道纹理需要更新
    if (textureRef.current) {
      textureRef.current.needsUpdate = true;
    }

    // 整体轻微浮动
    meshRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.8) * 0.03;
  });

  // 设置贴图
  useEffect(() => {
    if (!meshRef.current || !lipSyncRef.current) return;
    const canvas = lipSyncRef.current.canvas;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    textureRef.current = texture;

    if (meshRef.current.material) {
      meshRef.current.material.map = texture;
      meshRef.current.material.needsUpdate = true;
    }
  }, [lipSyncRef.current]);

  return (
    <group>
      {/* 主平面：稍微弧形化以增加立体感 */}
      <mesh ref={meshRef} position={[0, 0, 0]}>
        <planeGeometry args={[2.6, 1.95, 32, 16]} />
        {/* 使用 onBeforeCompile 在 shader 中加入曲线形变效果 */}
        <meshStandardMaterial
          color="#ffffff"
          roughness={0.5}
          metalness={0.0}
          side={THREE.FrontSide}
          toneMapped={false}
        />
      </mesh>

      {/* 背面黑色边框 */}
      <mesh position={[0, 0, -0.02]}>
        <planeGeometry args={[2.8, 2.15]} />
        <meshStandardMaterial color="#0a0a14" roughness={0.4} metalness={0.2} />
      </mesh>

      {/* 微弱散光环（屏幕边缘） */}
      <mesh position={[0, 0, -0.05]}>
        <ringGeometry args={[1.6, 1.7, 32]} />
        <meshBasicMaterial color="#5B8DEF" transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/**
 * 头像边框发光装饰
 */
function PortraitFrame() {
  return (
    <group>
      {/* 圆角发光装饰（在平面四角） */}
      {[[-1.25, 0.93], [1.25, 0.93], [-1.25, -0.93], [1.25, -0.93]].map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0.01]}>
          <sphereGeometry args={[0.04, 16, 16]} />
          <meshBasicMaterial color="#5B8DEF" />
        </mesh>
      ))}
    </group>
  );
}

/**
 * 背景：动态星空粒子
 */
function BackgroundField() {
  const ref = useRef();
  const count = 120;

  const { positions, colors } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 12;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = -3 - Math.random() * 5;
      const c = new THREE.Color().setHSL(0.55 + Math.random() * 0.15, 0.7, 0.6 + Math.random() * 0.3);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    return { positions: pos, colors: col };
  }, []);

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.025;
      ref.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.05) * 0.05;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={positions} itemSize={3} />
        <bufferAttribute attach="attributes-color" count={count} array={colors} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        vertexColors
        transparent
        opacity={0.6}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

/**
 * 装饰 Sparkles 容器
 */
function Decorations({ emotion }) {
  return (
    <>
      {(emotion === 'excited' || emotion === 'happy') && (
        <Sparkles
          count={emotion === 'excited' ? 30 : 15}
          scale={4}
          size={5}
          speed={0.4}
          color={emotion === 'excited' ? '#FFD700' : '#FF9090'}
        />
      )}
    </>
  );
}

/**
 * 主组件
 */
export default function TalkingPortrait3D({
  emotion = 'smile',
  isTalking = false,
  amplitudeRef = null,
  onUserInteract,
}) {
  const lipSyncRef = useRef(null);
  const canvasRef = useRef(null);
  const [loaded, setLoaded] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const audioAmpDirectRef = useRef(0);

  // 加载图像并初始化 Canvas
  useEffect(() => {
    if (!canvasRef.current) return;
    const renderer = new LipSyncCanvas(canvasRef.current);

    renderer.loadImage(PORTRAIT_URL).then(() => {
      // 自动估算嘴部位置（备选）
      // const mouth = estimateMouthRegion(canvasRef.current);
      // renderer.mouthRegions.closed = mouth;
      renderer.draw(0);
      lipSyncRef.current = renderer;
      setLoaded(true);
    });
  }, []);

  // 包装 amplitudeRef，让 useFrame 能读取
  useEffect(() => {
    if (amplitudeRef) {
      // 每 30ms 左右同步 amplitude（避免每一帧 React 重渲染）
      const interval = setInterval(() => {
        audioAmpDirectRef.current = amplitudeRef.current || 0;
      }, 33);
      return () => clearInterval(interval);
    }
  }, [amplitudeRef]);

  // 更新 emotion
  useEffect(() => {
    if (lipSyncRef.current) {
      lipSyncRef.current.setEmotion(emotion);
    }
  }, [emotion]);

  // 给 lipSyncRef 增加 getAmplitude 方法
  useEffect(() => {
    if (!lipSyncRef.current) return;
    lipSyncRef.current.getAmplitude = () => {
      if (!isTalking) return 0;
      return audioAmpDirectRef.current;
    };
  }, [isTalking, loaded]);

  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 5000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="digital-human-container">
      {/* 隐藏的 Canvas 用来生成动画 */}
      <canvas
        ref={canvasRef}
        style={{ display: 'none' }}
      />

      <Canvas
        camera={{ position: [0, 0, 3.0], fov: 40, near: 0.1, far: 30 }}
        dpr={[1, 1.5]}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'high-performance',
        }}
        onPointerDown={() => {
          setShowHint(false);
          onUserInteract?.();
        }}
      >
        {/* 灯光设置 */}
        <ambientLight intensity={0.6} />
        <directionalLight position={[2, 3, 4]} intensity={0.9} color="#FFFAF0" />
        <directionalLight position={[-2, 1, 3]} intensity={0.5} color="#A8C8E8" />
        <pointLight position={[0, 0, 3]} intensity={0.4} color="#FFEEDD" />

        {/* 浮动的人像 */}
        <Float speed={1.2} rotationIntensity={0.03} floatIntensity={0.1}>
          {loaded && <TalkingPortraitPlane lipSyncRef={lipSyncRef} emotion={emotion} />}
        </Float>

        {/* 发光边框 */}
        {loaded && <PortraitFrame />}

        {/* 背景星空 */}
        <BackgroundField />

        {/* 接触阴影（画布下方） */}
        <ContactShadows
          position={[0, -1.2, 0]}
          opacity={0.4}
          scale={3.5}
          blur={2.5}
          far={2}
        />

        {/* 装饰 Sparkles（开心/兴奋时） */}
        {loaded && <Decorations emotion={emotion} />}

        {/* 轨道控制 */}
        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={2.2}
          maxDistance={5.5}
          rotateSpeed={0.4}
          zoomSpeed={0.6}
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={Math.PI / 1.5}
          target={[0, 0, 0]}
        />
      </Canvas>

      {/* 加载指示 */}
      {!loaded && (
        <div className="thought-bubble" style={{ top: '45%' }}>加载肖像中…</div>
      )}

      {/* 操作提示 */}
      {showHint && loaded && (
        <div className="interaction-hint">拖拽鼠标旋转查看 · 真实音频驱动口型</div>
      )}
    </div>
  );
}
