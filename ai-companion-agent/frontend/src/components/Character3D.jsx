import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, ContactShadows, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import './Character3D.css';

// ============================================================
// 情感配置 - 每种表情的目标参数（用于平滑插值动画）
// ============================================================
const EMOTION_TARGETS = {
  smile:     { eyeY: 1.0,  eyeX: 1.0,  irisY: 0,     mSX: 1.4,  mSY: 0.35, mY: -0.22, mRot: 0,          browY: 0.42, bRL: 0,    bRR: 0,    blush: 0.35, tilt: 0 },
  happy:     { eyeY: 0.08, eyeX: 1.2,  irisY: 0,     mSX: 1.6,  mSY: 0.75, mY: -0.18, mRot: 0,          browY: 0.48, bRL: 0,    bRR: 0,    blush: 0.65, tilt: 0 },
  thinking:  { eyeY: 0.9,  eyeX: 1.0,  irisY: 0.08,  mSX: 0.5,  mSY: 0.25, mY: -0.25, mRot: 0,          browY: 0.45, bRL: -0.15, bRR: 0.1, blush: 0.2,  tilt: 0.08 },
  surprised: { eyeY: 1.25, eyeX: 1.25, irisY: 0,     mSX: 0.55, mSY: 0.8,  mY: -0.25, mRot: 0,          browY: 0.52, bRL: 0,    bRR: 0,    blush: 0.3,  tilt: 0 },
  sad:       { eyeY: 0.85, eyeX: 1.0,  irisY: -0.06, mSX: 1.3,  mSY: 0.3,  mY: -0.28, mRot: Math.PI,   browY: 0.38, bRL: 0.15, bRR: -0.15,blush: 0.3,  tilt: -0.05 },
  angry:     { eyeY: 0.9,  eyeX: 1.0,  irisY: 0,     mSX: 0.7,  mSY: 0.4,  mY: -0.22, mRot: 0,          browY: 0.34, bRL: -0.35, bRR: 0.35,blush: 0.2,  tilt: 0 },
  talking:   { eyeY: 1.0,  eyeX: 1.0,  irisY: 0,     mSX: 0.8,  mSY: 0.5,  mY: -0.22, mRot: 0,          browY: 0.42, bRL: 0,    bRR: 0,    blush: 0.3,  tilt: 0 },
  idle:      { eyeY: 0.06, eyeX: 1.0,  irisY: 0,     mSX: 1.0,  mSY: 0.2,  mY: -0.22, mRot: 0,          browY: 0.42, bRL: 0,    bRR: 0,    blush: 0.2,  tilt: 0 },
  excited:   { eyeY: 1.15, eyeX: 1.15, irisY: 0,     mSX: 1.7,  mSY: 0.95, mY: -0.16, mRot: 0,          browY: 0.5,  bRL: 0,    bRR: 0,    blush: 0.75, tilt: 0 },
  shy:       { eyeY: 0.35, eyeX: 1.0,  irisY: 0.03,  mSX: 0.5,  mSY: 0.15, mY: -0.24, mRot: 0,          browY: 0.44, bRL: 0,    bRR: 0,    blush: 1.0,  tilt: -0.03 },
};

function lerp(a, b, t) { return a + (b - a) * Math.min(t, 1); }

// ============================================================
// 3D 角色模型
// ============================================================
function CharacterModel({ emotion, isTalking }) {
  const groupRef = useRef();
  const headRef = useRef();
  const leftEyeRef = useRef();
  const rightEyeRef = useRef();
  const leftIrisRef = useRef();
  const rightIrisRef = useRef();
  const mouthRef = useRef();
  const leftBrowRef = useRef();
  const rightBrowRef = useRef();
  const leftBlushRef = useRef();
  const rightBlushRef = useRef();
  const tearLRef = useRef();
  const tearRRef = useRef();

  // 当前动画值（用于平滑过渡）
  const cur = useRef({
    eyeY: 1, eyeX: 1, irisY: 0,
    mSX: 1.4, mSY: 0.35, mY: -0.22, mRot: 0,
    browY: 0.42, bRL: 0, bRR: 0,
    blush: 0.35, tilt: 0,
  });

  // 眨眼控制
  const blinkVal = useRef(1);
  const nextBlink = useRef(3 + Math.random() * 2);

  // 材质（复用）
  const mats = useMemo(() => ({
    skin:    new THREE.MeshStandardMaterial({ color: '#FFDFD0', roughness: 0.7 }),
    hair:    new THREE.MeshStandardMaterial({ color: '#FF8C42', roughness: 0.45 }),
    eyeW:    new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.15 }),
    iris:    new THREE.MeshStandardMaterial({ color: '#5B8DEF', roughness: 0.25 }),
    pupil:   new THREE.MeshStandardMaterial({ color: '#2C3E50', roughness: 0.15 }),
    hl:      new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0, metalness: 0 }),
    brow:    new THREE.MeshStandardMaterial({ color: '#D4761E', roughness: 0.6 }),
    blush:   new THREE.MeshStandardMaterial({ color: '#FFB6C1', transparent: true, opacity: 0.4 }),
    mouth:   new THREE.MeshStandardMaterial({ color: '#E85A6C', roughness: 0.35 }),
    cloth:   new THREE.MeshStandardMaterial({ color: '#5B8DEF', roughness: 0.6 }),
    ribbon:  new THREE.MeshStandardMaterial({ color: '#FF6B9D', roughness: 0.5 }),
    tear:    new THREE.MeshStandardMaterial({ color: '#7EC8E3', transparent: true, opacity: 0.85 }),
    star:    new THREE.MeshStandardMaterial({ color: '#FFD700', roughness: 0.3, metalness: 0.2 }),
  }), []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;

    const effEmotion = isTalking ? 'talking' : emotion;
    const target = EMOTION_TARGETS[effEmotion] || EMOTION_TARGETS.smile;
    const c = cur.current;
    const spd = Math.min(1, delta * 6);

    // 平滑插值到目标值
    c.eyeY   = lerp(c.eyeY,   target.eyeY,   spd);
    c.eyeX   = lerp(c.eyeX,   target.eyeX,   spd);
    c.irisY  = lerp(c.irisY,  target.irisY,  spd);
    c.mSX    = lerp(c.mSX,    target.mSX,    spd);
    c.mSY    = lerp(c.mSY,    target.mSY,    spd);
    c.mY     = lerp(c.mY,     target.mY,     spd);
    c.mRot   = lerp(c.mRot,   target.mRot,   spd);
    c.browY  = lerp(c.browY,  target.browY,  spd);
    c.bRL    = lerp(c.bRL,    target.bRL,    spd);
    c.bRR    = lerp(c.bRR,    target.bRR,    spd);
    c.blush  = lerp(c.blush,  target.blush,  spd);
    c.tilt   = lerp(c.tilt,   target.tilt,   spd);

    // 呼吸
    groupRef.current.position.y = Math.sin(t * 1.2) * 0.025;

    // 头部微动
    if (headRef.current) {
      headRef.current.rotation.z = c.tilt + Math.sin(t * 0.7) * 0.015;
      headRef.current.rotation.x = Math.sin(t * 0.5) * 0.01;
    }

    // 眨眼
    if (t > nextBlink.current && !isTalking) {
      blinkVal.current -= delta * 18;
      if (blinkVal.current <= 0.05) {
        nextBlink.current = t + 2.5 + Math.random() * 2.5;
        blinkVal.current = 1;
      }
    } else {
      blinkVal.current = lerp(blinkVal.current, 1, delta * 12);
    }

    // 眼睛缩放（表情 + 眨眼）
    const eY = c.eyeY * blinkVal.current;
    if (leftEyeRef.current)  leftEyeRef.current.scale.set(c.eyeX, eY, 1);
    if (rightEyeRef.current) rightEyeRef.current.scale.set(c.eyeX, eY, 1);

    // 瞳孔位置（视线方向）
    if (leftIrisRef.current)  leftIrisRef.current.position.y = c.irisY;
    if (rightIrisRef.current) rightIrisRef.current.position.y = c.irisY;

    // 嘴巴
    if (mouthRef.current) {
      let mSY = c.mSY;
      if (isTalking) {
        const wave = Math.abs(Math.sin(t * 13)) * 0.65 + 0.35;
        mSY = c.mSY * (0.2 + wave * 0.8);
      }
      mouthRef.current.scale.set(c.mSX, mSY, 0.5);
      mouthRef.current.position.y = c.mY;
      mouthRef.current.rotation.z = c.mRot;
    }

    // 眉毛
    if (leftBrowRef.current) {
      leftBrowRef.current.position.y = c.browY;
      leftBrowRef.current.rotation.z = c.bRL;
    }
    if (rightBrowRef.current) {
      rightBrowRef.current.position.y = c.browY;
      rightBrowRef.current.rotation.z = c.bRR;
    }

    // 腮红
    const bScale = 0.8 + c.blush * 0.5;
    const bOpacity = c.blush * 0.6;
    if (leftBlushRef.current) {
      leftBlushRef.current.material.opacity = bOpacity;
      leftBlushRef.current.scale.setScalar(bScale);
    }
    if (rightBlushRef.current) {
      rightBlushRef.current.material.opacity = bOpacity;
      rightBlushRef.current.scale.setScalar(bScale);
    }

    // 眼泪（难过时）
    const showTears = effEmotion === 'sad';
    const tearProgress = (t * 0.4) % 1;
    if (tearLRef.current) {
      tearLRef.current.visible = showTears;
      if (showTears) {
        tearLRef.current.position.y = -0.08 - tearProgress * 0.35;
        tearLRef.current.material.opacity = tearProgress < 0.85 ? 0.85 : (1 - tearProgress) * 5.7;
      }
    }
    if (tearRRef.current) {
      tearRRef.current.visible = showTears;
      if (showTears) {
        tearRRef.current.position.y = -0.05 - ((tearProgress + 0.3) % 1) * 0.35;
        tearRRef.current.material.opacity = ((tearProgress + 0.3) % 1) < 0.85 ? 0.85 : 0;
      }
    }
  });

  return (
    <group ref={groupRef}>
      {/* ========= 头发后层 ========= */}
      <mesh position={[0, 0.25, -0.15]} material={mats.hair}>
        <sphereGeometry args={[1.18, 32, 32]} />
      </mesh>

      {/* 双马尾 */}
      <group position={[-0.98, -0.05, -0.2]} rotation={[0, 0, -0.38]}>
        <mesh position={[0, -0.55, 0]} material={mats.hair}>
          <capsuleGeometry args={[0.22, 0.75, 8, 16]} />
        </mesh>
        <mesh position={[0, 0.0, 0]} material={mats.ribbon}>
          <torusGeometry args={[0.23, 0.07, 8, 16]} />
        </mesh>
      </group>
      <group position={[0.98, -0.05, -0.2]} rotation={[0, 0, 0.38]}>
        <mesh position={[0, -0.55, 0]} material={mats.hair}>
          <capsuleGeometry args={[0.22, 0.75, 8, 16]} />
        </mesh>
        <mesh position={[0, 0.0, 0]} material={mats.ribbon}>
          <torusGeometry args={[0.23, 0.07, 8, 16]} />
        </mesh>
      </group>

      {/* ========= 头部 ========= */}
      <group ref={headRef} position={[0, 0.25, 0]}>
        {/* 脸 */}
        <mesh material={mats.skin}>
          <sphereGeometry args={[0.92, 32, 32]} />
        </mesh>

        {/* 耳朵 */}
        <mesh position={[-0.88, -0.05, 0]} material={mats.skin}>
          <sphereGeometry args={[0.11, 16, 16]} />
        </mesh>
        <mesh position={[0.88, -0.05, 0]} material={mats.skin}>
          <sphereGeometry args={[0.11, 16, 16]} />
        </mesh>

        {/* 头发前层（刘海帽） */}
        <mesh position={[0, 0.08, 0.02]} material={mats.hair}>
          <sphereGeometry args={[0.96, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
        </mesh>
        {/* 刘海碎发 */}
        <mesh position={[-0.25, 0.35, 0.72]} rotation={[0.3, 0, 0.3]} material={mats.hair}>
          <capsuleGeometry args={[0.12, 0.25, 6, 12]} />
        </mesh>
        <mesh position={[0.25, 0.35, 0.72]} rotation={[0.3, 0, -0.3]} material={mats.hair}>
          <capsuleGeometry args={[0.12, 0.25, 6, 12]} />
        </mesh>
        <mesh position={[0, 0.42, 0.72]} rotation={[0.3, 0, 0]} material={mats.hair}>
          <capsuleGeometry args={[0.1, 0.22, 6, 12]} />
        </mesh>

        {/* 侧发 */}
        <mesh position={[-0.78, -0.2, 0.15]} rotation={[0, 0, 0.25]} material={mats.hair}>
          <capsuleGeometry args={[0.16, 0.55, 8, 16]} />
        </mesh>
        <mesh position={[0.78, -0.2, 0.15]} rotation={[0, 0, -0.25]} material={mats.hair}>
          <capsuleGeometry args={[0.16, 0.55, 8, 16]} />
        </mesh>

        {/* ========= 左眼 ========= */}
        <group ref={leftEyeRef} position={[-0.33, 0.03, 0.78]}>
          <mesh material={mats.eyeW}>
            <sphereGeometry args={[0.17, 24, 24]} />
          </mesh>
          <mesh ref={leftIrisRef} position={[0, 0, 0.08]} material={mats.iris}>
            <sphereGeometry args={[0.11, 24, 24]} />
          </mesh>
          <mesh position={[0, 0, 0.14]} material={mats.pupil}>
            <sphereGeometry args={[0.065, 16, 16]} />
          </mesh>
          {/* 高光 */}
          <mesh position={[0.035, 0.04, 0.17]} material={mats.hl}>
            <sphereGeometry args={[0.032, 12, 12]} />
          </mesh>
          <mesh position={[-0.025, -0.02, 0.16]} material={mats.hl}>
            <sphereGeometry args={[0.016, 8, 8]} />
          </mesh>
        </group>

        {/* ========= 右眼 ========= */}
        <group ref={rightEyeRef} position={[0.33, 0.03, 0.78]}>
          <mesh material={mats.eyeW}>
            <sphereGeometry args={[0.17, 24, 24]} />
          </mesh>
          <mesh ref={rightIrisRef} position={[0, 0, 0.08]} material={mats.iris}>
            <sphereGeometry args={[0.11, 24, 24]} />
          </mesh>
          <mesh position={[0, 0, 0.14]} material={mats.pupil}>
            <sphereGeometry args={[0.065, 16, 16]} />
          </mesh>
          <mesh position={[0.035, 0.04, 0.17]} material={mats.hl}>
            <sphereGeometry args={[0.032, 12, 12]} />
          </mesh>
          <mesh position={[-0.025, -0.02, 0.16]} material={mats.hl}>
            <sphereGeometry args={[0.016, 8, 8]} />
          </mesh>
        </group>

        {/* 眼泪 */}
        <mesh ref={tearLRef} position={[-0.33, -0.08, 0.84]} material={mats.tear} visible={false}>
          <sphereGeometry args={[0.045, 12, 12]} />
        </mesh>
        <mesh ref={tearRRef} position={[0.33, -0.08, 0.84]} material={mats.tear} visible={false}>
          <sphereGeometry args={[0.045, 12, 12]} />
        </mesh>

        {/* ========= 眉毛 ========= */}
        <mesh ref={leftBrowRef} position={[-0.33, 0.42, 0.84]} material={mats.brow}>
          <boxGeometry args={[0.24, 0.035, 0.04]} />
        </mesh>
        <mesh ref={rightBrowRef} position={[0.33, 0.42, 0.84]} material={mats.brow}>
          <boxGeometry args={[0.24, 0.035, 0.04]} />
        </mesh>

        {/* ========= 腮红 ========= */}
        <mesh ref={leftBlushRef} position={[-0.52, -0.14, 0.76]} material={mats.blush}>
          <circleGeometry args={[0.14, 24]} />
        </mesh>
        <mesh ref={rightBlushRef} position={[0.52, -0.14, 0.76]} material={mats.blush}>
          <circleGeometry args={[0.14, 24]} />
        </mesh>

        {/* 鼻子（小点） */}
        <mesh position={[0, -0.08, 0.9]} material={mats.skin}>
          <sphereGeometry args={[0.022, 8, 8]} />
        </mesh>

        {/* ========= 嘴巴 ========= */}
        <mesh ref={mouthRef} position={[0, -0.22, 0.84]} material={mats.mouth}>
          <sphereGeometry args={[0.09, 24, 24]} />
        </mesh>
      </group>

      {/* ========= 身体 ========= */}
      <group position={[0, -1.15, 0]}>
        {/* 躯干 */}
        <mesh material={mats.cloth}>
          <capsuleGeometry args={[0.6, 0.45, 8, 16]} />
        </mesh>
        {/* 衣领 */}
        <mesh position={[0, 0.4, 0.08]} material={mats.hl}>
          <torusGeometry args={[0.26, 0.045, 8, 16]} />
        </mesh>
        {/* 胸口星星 */}
        <mesh position={[0, -0.08, 0.52]} material={mats.star}>
          <circleGeometry args={[0.07, 5]} />
        </mesh>
        {/* 手臂 */}
        <mesh position={[-0.58, -0.02, 0]} rotation={[0, 0, 0.45]} material={mats.cloth}>
          <capsuleGeometry args={[0.11, 0.38, 8, 16]} />
        </mesh>
        <mesh position={[0.58, -0.02, 0]} rotation={[0, 0, -0.45]} material={mats.cloth}>
          <capsuleGeometry args={[0.11, 0.38, 8, 16]} />
        </mesh>
        {/* 手 */}
        <mesh position={[-0.72, -0.28, 0]} material={mats.skin}>
          <sphereGeometry args={[0.1, 16, 16]} />
        </mesh>
        <mesh position={[0.72, -0.28, 0]} material={mats.skin}>
          <sphereGeometry args={[0.1, 16, 16]} />
        </mesh>
      </group>
    </group>
  );
}

// ============================================================
// 主组件
// ============================================================
export default function Character3D({ emotion = 'smile', isTalking = false }) {
  return (
    <div className="character-3d-container">
      <Canvas
        camera={{ position: [0, 0.2, 4.3], fov: 36 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        {/* 灯光 */}
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 5, 4]} intensity={0.85} />
        <directionalLight position={[-3, 2, -2]} intensity={0.25} color="#FFB07A" />
        <pointLight position={[0, -0.5, 3]} intensity={0.35} color="#FF8C42" />

        {/* 角色 */}
        <Float speed={1.5} rotationIntensity={0.12} floatIntensity={0.2}>
          <CharacterModel emotion={emotion} isTalking={isTalking} />
        </Float>

        {/* 阴影 */}
        <ContactShadows
          position={[0, -1.9, 0]}
          opacity={0.22}
          scale={4}
          blur={2.5}
          far={3}
        />

        {/* 兴奋时星星粒子 */}
        {emotion === 'excited' && (
          <Sparkles count={25} scale={3.5} size={5} speed={0.4} color="#FFD700" />
        )}
      </Canvas>

      {/* 思考气泡 */}
      {emotion === 'thinking' && !isTalking && (
        <div className="thought-bubble-3d">???</div>
      )}
    </div>
  );
}
