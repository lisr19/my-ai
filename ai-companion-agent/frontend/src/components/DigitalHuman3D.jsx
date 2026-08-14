import React, { useRef, useMemo, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, ContactShadows, Sparkles, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import './DigitalHuman3D.css';

// ============================================================
// 情绪配置 - 每个表情的目标参数（平滑插值动画）
// ============================================================
const EMOTION_TARGETS = {
  smile:     { eyeOpen: 1.0,  eyeBlink: 1.0, mouthA: 0.3, mouthA2: 0.3, browY: 0.0, bRL: 0,     bRR: 0,     blush: 0.4,  headTilt: 0,   lipColor: '#C8455F', showTeeth: false },
  happy:     { eyeOpen: 0.4,  eyeBlink: 1.0, mouthA: 1.0, mouthA2: 1.0, browY: 0.05, bRL: -0.05, bRR: 0.05,  blush: 0.6,  headTilt: 0.05, lipColor: '#D04050', showTeeth: true },
  thinking:  { eyeOpen: 1.0,  eyeBlink: 1.0, mouthA: 0.15, mouthA2: 0.15, browY: -0.04, bRL: -0.25, bRR: 0.15, blush: 0.2, headTilt: 0.12, lipColor: '#A86070', showTeeth: false },
  surprised: { eyeOpen: 1.4,  eyeBlink: 1.0, mouthA: 0.85, mouthA2: 0.85, browY: 0.1, bRL: 0,    bRR: 0,     blush: 0.3,  headTilt: -0.05, lipColor: '#B85060', showTeeth: false },
  sad:       { eyeOpen: 0.7,  eyeBlink: 1.0, mouthA: 0.4, mouthA2: 0.4, browY: -0.08, bRL: 0.3,  bRR: -0.3,  blush: 0.5,  headTilt: -0.08, lipColor: '#986070', showTeeth: false },
  angry:     { eyeOpen: 0.9,  eyeBlink: 1.0, mouthA: 0.35, mouthA2: 0.35, browY: -0.12, bRL: -0.4, bRR: 0.4,   blush: 0.3,  headTilt: 0,   lipColor: '#985060', showTeeth: true },
  talking:   { eyeOpen: 1.0,  eyeBlink: 1.0, mouthA: 0.5, mouthA2: 0.5, browY: 0,    bRL: 0,     bRR: 0,     blush: 0.3,  headTilt: 0,    lipColor: '#C8455F', showTeeth: true },
  idle:      { eyeOpen: 0.2,  eyeBlink: 1.0, mouthA: 0.3, mouthA2: 0.3, browY: 0,    bRL: 0,     bRR: 0,     blush: 0.2,  headTilt: 0,    lipColor: '#B0707A', showTeeth: false },
  excited:   { eyeOpen: 1.3,  eyeBlink: 1.0, mouthA: 1.2, mouthA2: 1.2, browY: 0.08, bRL: -0.08, bRR: 0.08, blush: 0.7,  headTilt: 0.08, lipColor: '#D04050', showTeeth: true },
  shy:       { eyeOpen: 0.6,  eyeBlink: 1.0, mouthA: 0.25, mouthA2: 0.25, browY: 0.02, bRL: 0,   bRR: 0,     blush: 1.0,  headTilt: -0.05, lipColor: '#B07078', showTeeth: false },
};

function lerp(a, b, t) { return a + (b - a) * Math.min(t, 1); }
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ============================================================
// 3D 数字人模型 - Pixar风格：黑短发、蓝色圆框眼镜、白T+logo
// ============================================================
function DigitalHumanModel({ emotion, isTalking, amplitudeRef }) {
  const groupRef = useRef();
  const headRef = useRef();
  const leftEyeRef = useRef();
  const rightEyeRef = useRef();
  const leftIrisRef = useRef();
  const rightIrisRef = useRef();
  const leftBrowRef = useRef();
  const rightBrowRef = useRef();
  const leftBlushRef = useRef();
  const rightBlushRef = useRef();
  const tearLRef = useRef();
  const tearRRef = useRef();
  const upperLidLRef = useRef();
  const upperLidRRef = useRef();
  const mouthRef = useRef();
  const upperTeethRef = useRef();
  const lowerTeethRef = useRef();
  const tongueRef = useRef();
  const lipsRef = useRef();
  const bodyRef = useRef();
  const leftArmRef = useRef();
  const rightArmRef = useRef();

  // 当前动画值
  const cur = useRef({
    eyeOpen: 1.0, eyeBlink: 1.0,
    mouthA: 0.3, mouthA2: 0.3,
    browY: 0, bRL: 0, bRR: 0,
    blush: 0.4, headTilt: 0, lipColor: '#C8455F', showTeeth: 0,
  });

  // 眨眼
  const blinkVal = useRef(1);
  const nextBlink = useRef(2 + Math.random() * 2);

  // 材质（用 ref 让嘴巴颜色变化）
  const mats = useMemo(() => {
    const skinM = new THREE.MeshStandardMaterial({ color: '#FCDDC2', roughness: 0.55, metalness: 0.02 });
    const skinShadowM = new THREE.MeshStandardMaterial({ color: '#E8B894', roughness: 0.6 });

    const hairM = new THREE.MeshStandardMaterial({ color: '#1A1A1F', roughness: 0.6, metalness: 0.05 });
    const hairShineM = new THREE.MeshStandardMaterial({ color: '#2D2D35', roughness: 0.4, metalness: 0.15 });

    const eyeWhiteM = new THREE.MeshStandardMaterial({ color: '#FAFAFA', roughness: 0.12 });
    const irisM = new THREE.MeshStandardMaterial({ color: '#5A3A20', roughness: 0.18, metalness: 0.05 });
    const pupilM = new THREE.MeshStandardMaterial({ color: '#0A0508', roughness: 0.1 });
    const hlM = new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0, metalness: 0, emissive: '#ffffff', emissiveIntensity: 0.5 });

    const browM = new THREE.MeshStandardMaterial({ color: '#15151A', roughness: 0.5 });
    const blushM = new THREE.MeshStandardMaterial({ color: '#FF9090', transparent: true, opacity: 0.5, depthWrite: false });
    const lidM = new THREE.MeshStandardMaterial({ color: '#E8C2A0', roughness: 0.7, side: THREE.DoubleSide, depthWrite: false });

    const lipM = new THREE.MeshStandardMaterial({ color: '#C8455F', roughness: 0.3 });
    const mouthInsideM = new THREE.MeshStandardMaterial({ color: '#3A1018', roughness: 0.85 });
    const tongueM = new THREE.MeshStandardMaterial({ color: '#D87580', roughness: 0.5 });
    const teethM = new THREE.MeshStandardMaterial({ color: '#F8F2E8', roughness: 0.15 });
    const tearM = new THREE.MeshStandardMaterial({ color: '#A8E0FF', transparent: true, opacity: 0.85 });

    const tshirtM = new THREE.MeshStandardMaterial({ color: '#F8F8F8', roughness: 0.7, metalness: 0.02 });
    const tshirtShadowM = new THREE.MeshStandardMaterial({ color: '#D8D8D8', roughness: 0.75 });
    const pantsM = new THREE.MeshStandardMaterial({ color: '#4A6080', roughness: 0.7 });
    const shoeM = new THREE.MeshStandardMaterial({ color: '#1A1A1A', roughness: 0.5 });
    const armM = new THREE.MeshStandardMaterial({ color: '#FCDDC2', roughness: 0.6 });

    const glassFrameM = new THREE.MeshStandardMaterial({ color: '#2B6CB0', roughness: 0.25, metalness: 0.4 });
    const glassLensM = new THREE.MeshStandardMaterial({ color: '#88BFE0', transparent: true, opacity: 0.18, roughness: 0.1, metalness: 0.05 });

    const logoM = new THREE.MeshStandardMaterial({ color: '#2B6CB0', roughness: 0.4, emissive: '#1A4E80', emissiveIntensity: 0.2 });

    return {
      skin: skinM, skinShadow: skinShadowM,
      hair: hairM, hairShine: hairShineM,
      eyeWhite: eyeWhiteM, iris: irisM, pupil: pupilM, hl: hlM,
      brow: browM, blush: blushM, lid: lidM,
      lip: lipM, mouthInside: mouthInsideM, tongue: tongueM, teeth: teethM, tear: tearM,
      tshirt: tshirtM, tshirtShadow: tshirtShadowM,
      pants: pantsM, shoe: shoeM, arm: armM,
      glassFrame: glassFrameM, glassLens: glassLensM,
      logo: logoM,
    };
  }, []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;

    const effEmotion = isTalking ? 'talking' : emotion;
    const target = EMOTION_TARGETS[effEmotion] || EMOTION_TARGETS.smile;
    const c = cur.current;
    const spd = Math.min(1, delta * 5);

    c.eyeOpen   = lerp(c.eyeOpen,   target.eyeOpen,   spd);
    c.eyeBlink  = lerp(c.eyeBlink,  target.eyeBlink,  spd);
    c.mouthA    = lerp(c.mouthA,    target.mouthA,    spd);
    c.mouthA2   = lerp(c.mouthA2,   target.mouthA2,   spd);
    c.browY     = lerp(c.browY,     target.browY,     spd);
    c.bRL       = lerp(c.bRL,       target.bRL,       spd);
    c.bRR       = lerp(c.bRR,       target.bRR,       spd);
    c.blush     = lerp(c.blush,     target.blush,     spd);
    c.headTilt  = lerp(c.headTilt,  target.headTilt,  spd);
    c.lipColor  = target.lipColor;
    c.showTeeth = lerp(c.showTeeth, target.showTeeth ? 1 : 0, spd);

    mats.lip.color.set(c.lipColor);

    // 全身浮动
    groupRef.current.position.y = Math.sin(t * 1.1) * 0.02;

    // 身体微摆
    if (bodyRef.current) {
      bodyRef.current.rotation.z = Math.sin(t * 0.7) * 0.015;
    }

    // 头部运动
    if (headRef.current) {
      headRef.current.rotation.z = c.headTilt + Math.sin(t * 0.8) * 0.018;
      headRef.current.rotation.x = Math.sin(t * 0.5) * 0.012;
      headRef.current.rotation.y = Math.sin(t * 0.6) * 0.02;
    }

    // 眨眼
    const blinkInterval = isTalking ? 1.5 + Math.random() * 1.5 : 2.8 + Math.random() * 2.5;
    if (t > nextBlink.current) {
      blinkVal.current -= delta * 12;
      if (blinkVal.current <= 0.05) {
        nextBlink.current = t + blinkInterval;
        blinkVal.current = 1;
      }
    } else {
      blinkVal.current = lerp(blinkVal.current, 1, delta * 9);
    }

    // 眼睛 Y 轴缩放（eyeOpen = 情绪睁眼 / blink = 眨眼）
    const blinkScale = blinkVal.current;
    if (leftEyeRef.current)  leftEyeRef.current.scale.y = c.eyeOpen * c.eyeBlink * blinkScale;
    if (rightEyeRef.current) rightEyeRef.current.scale.y = c.eyeOpen * c.eyeBlink * blinkScale;

    // 眼睛上睑（更细致的眨眼效果）：用 eyelid 覆盖
    if (upperLidLRef.current) {
      const lidPos = 0.08 - 0.1 * (1 - blinkScale) - 0.04 * Math.max(0, 1 - c.eyeOpen);
      upperLidLRef.current.position.y = lidPos;
    }
    if (upperLidRRef.current) {
      const lidPos = 0.08 - 0.1 * (1 - blinkScale) - 0.04 * Math.max(0, 1 - c.eyeOpen);
      upperLidRRef.current.position.y = lidPos;
    }

    // 瞳孔（视线方向）
    if (leftIrisRef.current)  leftIrisRef.current.position.y = 0.005 + Math.sin(t * 0.4) * 0.01;
    if (rightIrisRef.current) rightIrisRef.current.position.y = 0.005 + Math.sin(t * 0.4) * 0.01;

    // ========== 嘴巴 ==========
    if (mouthRef.current) {
      let mouthSY, mouthSX;

      if (isTalking && amplitudeRef) {
        const audioAmp = amplitudeRef.current || 0;
        // 即使无音频也保持基础开合，确保视觉上在说话
        const talkingBaseAmp = Math.max(audioAmp, 0.15);
        const talkingAmp = talkingBaseAmp * (0.85 + Math.sin(t * 7) * 0.15);

        mouthSX = 1.0 + talkingAmp * 0.6;
        mouthSY = 0.2 + talkingAmp * 1.8;
      } else {
        // 不说话时按情绪
        mouthSX = 1.0;
        mouthSY = 0.2 + c.mouthA * 1.5;
      }

      mouthRef.current.scale.set(mouthSX, mouthSY, 1);
    }

    // 牙齿可见性
    const teethVis = isTalking ? Math.max(0, amplitudeRef.current || 0.15) : c.showTeeth * 0.7;
    if (upperTeethRef.current) {
      upperTeethRef.current.scale.y = Math.min(1, teethVis * 2.5);
      upperTeethRef.current.visible = teethVis > 0.1;
    }
    if (lowerTeethRef.current) {
      lowerTeethRef.current.scale.y = Math.min(1, teethVis * 2);
      lowerTeethRef.current.visible = teethVis > 0.15;
    }
    if (tongueRef.current) {
      tongueRef.current.scale.setScalar(Math.min(1, teethVis * 2));
      tongueRef.current.visible = teethVis > 0.3;
    }

    // 眉毛
    if (leftBrowRef.current) {
      leftBrowRef.current.position.y = 0.18 + c.browY;
      leftBrowRef.current.rotation.z = c.bRL;
    }
    if (rightBrowRef.current) {
      rightBrowRef.current.position.y = 0.18 + c.browY;
      rightBrowRef.current.rotation.z = c.bRR;
    }

    // 腮红
    if (leftBlushRef.current) {
      leftBlushRef.current.material.opacity = c.blush * 0.65;
      leftBlushRef.current.scale.setScalar(0.9 + c.blush * 0.4);
    }
    if (rightBlushRef.current) {
      rightBlushRef.current.material.opacity = c.blush * 0.65;
      rightBlushRef.current.scale.setScalar(0.9 + c.blush * 0.4);
    }

    // 眼泪
    const showTears = effEmotion === 'sad';
    const tearProgress = (t * 0.4) % 1;
    if (tearLRef.current) {
      tearLRef.current.visible = showTears;
      if (showTears) {
        tearLRef.current.position.y = -0.02 - tearProgress * 0.3;
        tearLRef.current.material.opacity = tearProgress < 0.85 ? 0.85 : (1 - tearProgress) * 5.7;
      }
    }
    if (tearRRef.current) {
      tearRRef.current.visible = showTears;
      if (showTears) {
        tearRRef.current.position.y = 0.01 - ((tearProgress + 0.3) % 1) * 0.3;
        tearRRef.current.material.opacity = ((tearProgress + 0.3) % 1) < 0.85 ? 0.85 : 0;
      }
    }

    // 手臂随机摆动（idle时）
    if (!isTalking && effEmotion === 'idle') {
      const sway = Math.sin(t * 1.5) * 0.05;
      if (leftArmRef.current)  leftArmRef.current.rotation.z = 0.1 + sway;
      if (rightArmRef.current) rightArmRef.current.rotation.z = -0.1 - sway;
    } else {
      if (leftArmRef.current)  leftArmRef.current.rotation.z = lerp(leftArmRef.current.rotation.z, 0.15, delta * 5);
      if (rightArmRef.current) rightArmRef.current.rotation.z = lerp(rightArmRef.current.rotation.z, -0.15, delta * 5);
    }
  });

  // 头部位置：颈部之上。整体人物身高约 3.0，头部在中上部
  return (
    <group ref={groupRef}>
      {/* ========= 头发 - 后层 + 蓬松短发 ========= */}
      <group position={[0, 1.5, 0]}>
        {/* 后脑勺大块 */}
        <mesh position={[0, 0, -0.08]} material={mats.hair}>
          <sphereGeometry args={[0.36, 24, 24]} />
        </mesh>
        {/* 头顶蓬松（多球体模拟卷发） */}
        {[
          [0, 0.18, 0.05, 0.18],
          [-0.18, 0.16, 0.04, 0.15],
          [0.18, 0.16, 0.04, 0.15],
          [-0.28, 0.08, 0, 0.13],
          [0.28, 0.08, 0, 0.13],
          [-0.12, 0.22, 0.1, 0.13],
          [0.12, 0.22, 0.1, 0.13],
          [0, 0.28, 0, 0.12],
          [-0.22, 0.0, 0.12, 0.11],
          [0.22, 0.0, 0.12, 0.11],
          [-0.32, -0.05, 0.05, 0.1],
          [0.32, -0.05, 0.05, 0.1],
        ].map(([x, y, z, r], i) => (
          <mesh key={i} position={[x, y, z]} material={i % 2 ? mats.hairShine : mats.hair}>
            <sphereGeometry args={[r, 12, 12]} />
          </mesh>
        ))}
        {/* 刘海（覆盖前额） */}
        <mesh position={[0, 0.22, 0.18]} rotation={[0.2, 0, 0]} material={mats.hair}>
          <sphereGeometry args={[0.28, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.45]} />
        </mesh>
      </group>

      {/* ========= 头部组 ========= */}
      <group ref={headRef} position={[0, 1.5, 0]}>
        {/* 脸部 */}
        <mesh material={mats.skin}>
          <sphereGeometry args={[0.32, 48, 48]} />
        </mesh>
        {/* 脸部轻微红润（脸颊阴影） */}
        <mesh position={[0, -0.05, 0.18]} material={mats.skinShadow} scale={[1.6, 0.8, 0.3]}>
          <sphereGeometry args={[0.18, 24, 24]} />
        </mesh>

        {/* 耳朵 */}
        <mesh position={[-0.31, 0, 0]} material={mats.skin}>
          <sphereGeometry args={[0.06, 16, 16]} />
        </mesh>
        <mesh position={[0.31, 0, 0]} material={mats.skin}>
          <sphereGeometry args={[0.06, 16, 16]} />
        </mesh>

        {/* ========= 大眼睛 ========= */}
        {/* 左眼 */}
        <group ref={leftEyeRef} position={[-0.1, 0.03, 0.28]}>
          <mesh material={mats.eyeWhite}>
            <sphereGeometry args={[0.07, 24, 24]} />
          </mesh>
          <mesh ref={leftIrisRef} position={[0, 0, 0.03]} material={mats.iris}>
            <circleGeometry args={[0.045, 24]} />
          </mesh>
          <mesh position={[0, 0, 0.045]} material={mats.pupil}>
            <circleGeometry args={[0.025, 20]} />
          </mesh>
          {/* 大高光 */}
          <mesh position={[0.025, 0.025, 0.05]} material={mats.hl}>
            <sphereGeometry args={[0.018, 12, 12]} />
          </mesh>
          <mesh position={[-0.015, -0.015, 0.05]} material={mats.hl}>
            <sphereGeometry args={[0.01, 8, 8]} />
          </mesh>
          {/* 上眼睑（眨眼/闭眼） */}
          <mesh ref={upperLidLRef} position={[0, 0.08, 0]} material={mats.lid}>
            <sphereGeometry args={[0.075, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
          </mesh>
        </group>

        {/* 右眼 */}
        <group ref={rightEyeRef} position={[0.1, 0.03, 0.28]}>
          <mesh material={mats.eyeWhite}>
            <sphereGeometry args={[0.07, 24, 24]} />
          </mesh>
          <mesh ref={rightIrisRef} position={[0, 0, 0.03]} material={mats.iris}>
            <circleGeometry args={[0.045, 24]} />
          </mesh>
          <mesh position={[0, 0, 0.045]} material={mats.pupil}>
            <circleGeometry args={[0.025, 20]} />
          </mesh>
          <mesh position={[0.025, 0.025, 0.05]} material={mats.hl}>
            <sphereGeometry args={[0.018, 12, 12]} />
          </mesh>
          <mesh position={[-0.015, -0.015, 0.05]} material={mats.hl}>
            <sphereGeometry args={[0.01, 8, 8]} />
          </mesh>
          <mesh ref={upperLidRRef} position={[0, 0.08, 0]} material={mats.lid}>
            <sphereGeometry args={[0.075, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
          </mesh>
        </group>

        {/* 眼泪 */}
        <mesh ref={tearLRef} position={[-0.1, -0.03, 0.3]} material={mats.tear} visible={false}>
          <sphereGeometry args={[0.025, 12, 12]} />
        </mesh>
        <mesh ref={tearRRef} position={[0.1, -0.01, 0.3]} material={mats.tear} visible={false}>
          <sphereGeometry args={[0.025, 12, 12]} />
        </mesh>

        {/* ========= 眉毛（深色，浓密） ========= */}
        <mesh ref={leftBrowRef} position={[-0.1, 0.18, 0.31]} material={mats.brow}>
          <boxGeometry args={[0.1, 0.022, 0.025]} />
        </mesh>
        <mesh ref={rightBrowRef} position={[0.1, 0.18, 0.31]} material={mats.brow}>
          <boxGeometry args={[0.1, 0.022, 0.025]} />
        </mesh>

        {/* ========= 鼻子（小巧） ========= */}
        <mesh position={[0, -0.05, 0.32]} material={mats.skin}>
          <sphereGeometry args={[0.025, 12, 12]} />
        </mesh>

        {/* ========= 腮红 ========= */}
        <mesh ref={leftBlushRef} position={[-0.2, -0.05, 0.25]} material={mats.blush}>
          <circleGeometry args={[0.06, 16]} />
        </mesh>
        <mesh ref={rightBlushRef} position={[0.2, -0.05, 0.25]} material={mats.blush}>
          <circleGeometry args={[0.06, 16]} />
        </mesh>

        {/* ========= 嘴巴（带牙齿/舌头） ========= */}
        <group ref={mouthRef} position={[0, -0.16, 0.28]}>
          {/* 嘴唇外形 */}
          <mesh material={mats.lip}>
            <sphereGeometry args={[0.07, 24, 24]} />
          </mesh>
          {/* 口腔内部 */}
          <mesh position={[0, 0, 0.005]} material={mats.mouthInside}>
            <circleGeometry args={[0.05, 20]} />
          </mesh>
          {/* 上排牙齿 */}
          <mesh ref={upperTeethRef} position={[0, 0.025, 0.03]} material={mats.teeth}>
            <boxGeometry args={[0.09, 0.02, 0.015]} />
          </mesh>
          {/* 下排牙齿 */}
          <mesh ref={lowerTeethRef} position={[0, -0.018, 0.03]} material={mats.teeth}>
            <boxGeometry args={[0.085, 0.018, 0.015]} />
          </mesh>
          {/* 舌头 */}
          <mesh ref={tongueRef} position={[0, -0.005, 0.035]} material={mats.tongue}>
            <capsuleGeometry args={[0.025, 0.04, 6, 12]} />
          </mesh>
        </group>

        {/* ========= 蓝色圆框眼镜 ========= */}
        <group>
          {/* 左镜框 */}
          <mesh position={[-0.1, 0.03, 0.32]} rotation={[Math.PI / 2, 0, 0]} material={mats.glassFrame}>
            <torusGeometry args={[0.082, 0.012, 12, 32]} />
          </mesh>
          {/* 左镜片（透明） */}
          <mesh position={[-0.1, 0.03, 0.32]} rotation={[Math.PI / 2, 0, 0]} material={mats.glassLens}>
            <circleGeometry args={[0.075, 24]} />
          </mesh>

          {/* 右镜框 */}
          <mesh position={[0.1, 0.03, 0.32]} rotation={[Math.PI / 2, 0, 0]} material={mats.glassFrame}>
            <torusGeometry args={[0.082, 0.012, 12, 32]} />
          </mesh>
          <mesh position={[0.1, 0.03, 0.32]} rotation={[Math.PI / 2, 0, 0]} material={mats.glassLens}>
            <circleGeometry args={[0.075, 24]} />
          </mesh>

          {/* 鼻梁 */}
          <mesh position={[0, 0.045, 0.32]} rotation={[0, 0, Math.PI / 2]} material={mats.glassFrame}>
            <cylinderGeometry args={[0.008, 0.008, 0.04, 8]} />
          </mesh>

          {/* 左镜腿（延伸至耳朵） */}
          <mesh position={[-0.18, 0.03, 0.28]} rotation={[0, -0.3, 0]} material={mats.glassFrame}>
            <cylinderGeometry args={[0.008, 0.008, 0.18, 8]} />
          </mesh>
          {/* 右镜腿 */}
          <mesh position={[0.18, 0.03, 0.28]} rotation={[0, 0.3, 0]} material={mats.glassFrame}>
            <cylinderGeometry args={[0.008, 0.008, 0.18, 8]} />
          </mesh>

          {/* 镜片高光（玻璃质感） */}
          <mesh position={[-0.1, 0.07, 0.34]} material={mats.hl}>
            <sphereGeometry args={[0.02, 8, 8]} />
          </mesh>
          <mesh position={[0.1, 0.07, 0.34]} material={mats.hl}>
            <sphereGeometry args={[0.02, 8, 8]} />
          </mesh>
        </group>
      </group>

      {/* ========= 身体（提升到紧贴头部下方） ========= */}
      <group ref={bodyRef} position={[0, 1.05, 0]}>
        {/* 颈部 */}
        <mesh material={mats.skin}>
          <cylinderGeometry args={[0.08, 0.09, 0.1, 16]} />
        </mesh>

        {/* 躯干 - 白T恤 */}
        <mesh position={[0, -0.25, 0]} material={mats.tshirt}>
          <capsuleGeometry args={[0.22, 0.3, 12, 20]} />
        </mesh>
        {/* T恤领口 */}
        <mesh position={[0, 0.05, 0.2]} material={mats.tshirtShadow}>
          <torusGeometry args={[0.08, 0.025, 8, 16]} />
        </mesh>
        {/* T恤下摆阴影 */}
        <mesh position={[0, -0.55, 0]} material={mats.tshirtShadow}>
          <torusGeometry args={[0.22, 0.03, 8, 16]} />
        </mesh>

        {/* Logo - 胸前 */}
        <mesh position={[-0.08, -0.15, 0.23]} material={mats.logo}>
          <sphereGeometry args={[0.025, 12, 12]} />
        </mesh>
        <mesh position={[-0.04, -0.18, 0.235]} material={mats.logo}>
          <sphereGeometry args={[0.02, 8, 8]} />
        </mesh>
        <mesh position={[0, -0.16, 0.23]} material={mats.logo}>
          <sphereGeometry args={[0.018, 8, 8]} />
        </mesh>

        {/* 左臂 */}
        <group ref={leftArmRef} position={[-0.27, -0.18, 0]} rotation={[0, 0, 0.15]}>
          <mesh position={[0, -0.15, 0]} material={mats.tshirt}>
            <capsuleGeometry args={[0.07, 0.22, 8, 16]} />
          </mesh>
          <mesh position={[0, -0.32, 0]} material={mats.arm}>
            <capsuleGeometry args={[0.06, 0.22, 8, 16]} />
          </mesh>
          <mesh position={[0, -0.45, 0]} material={mats.arm}>
            <sphereGeometry args={[0.07, 16, 16]} />
          </mesh>
        </group>

        {/* 右臂 */}
        <group ref={rightArmRef} position={[0.27, -0.18, 0]} rotation={[0, 0, -0.15]}>
          <mesh position={[0, -0.15, 0]} material={mats.tshirt}>
            <capsuleGeometry args={[0.07, 0.22, 8, 16]} />
          </mesh>
          <mesh position={[0, -0.32, 0]} material={mats.arm}>
            <capsuleGeometry args={[0.06, 0.22, 8, 16]} />
          </mesh>
          <mesh position={[0, -0.45, 0]} material={mats.arm}>
            <sphereGeometry args={[0.07, 16, 16]} />
          </mesh>
        </group>

        {/* T恤下摆（不画下半身，保持胸部以上形象） */}
        <mesh position={[0, -0.5, 0]} material={mats.tshirt}>
          <cylinderGeometry args={[0.22, 0.28, 0.15, 16]} />
        </mesh>
      </group>
    </group>
  );
}

// ============================================================
// 背景粒子
// ============================================================
function BackgroundParticles() {
  const count = 80;
  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 12;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 10;
      pos[i * 3 + 2] = -3 - Math.random() * 4;
    }
    return pos;
  }, []);

  const ref = useRef();

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.025;
      ref.current.rotation.x = state.clock.elapsedTime * 0.008;
    }
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.04}
        color="#88BFE0"
        transparent
        opacity={0.45}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  );
}

// ============================================================
// 音频可视化条 (纯 RAF)
// ============================================================
function AudioBars({ amplitudeRef }) {
  const [levels, setLevels] = useState([0, 0, 0, 0, 0]);
  const currentRef = useRef([0, 0, 0, 0, 0]);

  useEffect(() => {
    let rafId;
    const update = () => {
      const amp = (amplitudeRef && amplitudeRef.current) || 0;
      const arr = currentRef.current.slice();
      for (let i = 0; i < arr.length; i++) {
        const target = amp * (0.3 + Math.random() * 0.7);
        arr[i] = arr[i] + (target - arr[i]) * 0.18;
      }
      currentRef.current = arr;
      setLevels(arr.slice());
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);
    return () => rafId && cancelAnimationFrame(rafId);
  }, [amplitudeRef]);

  return (
    <div className="audio-indicator">
      {levels.map((level, i) => (
        <div
          key={i}
          className="audio-bar"
          style={{ height: `${Math.max(2, level * 22)}px` }}
        />
      ))}
    </div>
  );
}

// ============================================================
// 主组件
// ============================================================
export default function DigitalHuman3D({
  emotion = 'smile',
  isTalking = false,
  amplitudeRef = null,
  onUserInteract,
}) {
  const [showHint, setShowHint] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="digital-human-container">
      <Canvas
        camera={{ position: [0, 1.3, 3.0], fov: 38, near: 0.1, far: 20 }}
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
        {/* 柔和的Pixar风格三点照明 */}
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 4]} intensity={1.0} color="#FFFAF0" castShadow />
        <directionalLight position={[-3, 2, 3]} intensity={0.5} color="#A8C8E8" />
        <directionalLight position={[0, -1, 3]} intensity={0.2} color="#FFD8B8" />
        <pointLight position={[0, 2, 4]} intensity={0.5} color="#FFEEDD" />

        <Float speed={1.3} rotationIntensity={0.04} floatIntensity={0.08}>
          <DigitalHumanModel
            emotion={emotion}
            isTalking={isTalking}
            amplitudeRef={amplitudeRef}
          />
        </Float>

        <ContactShadows
          position={[0, 0.4, 0]}
          opacity={0.4}
          scale={3}
          blur={2.2}
          far={2.5}
        />

        <BackgroundParticles />

        {(emotion === 'excited' || emotion === 'happy') && (
          <Sparkles
            count={emotion === 'excited' ? 30 : 15}
            scale={3.5}
            size={6}
            speed={0.4}
            color={emotion === 'excited' ? '#FFD700' : '#FF9090'}
          />
        )}

        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={2.2}
          maxDistance={5.5}
          rotateSpeed={0.4}
          zoomSpeed={0.6}
          minPolarAngle={Math.PI / 3}
          maxPolarAngle={Math.PI / 1.5}
          target={[0, 1.3, 0]}
        />
      </Canvas>

      {isTalking && <AudioBars amplitudeRef={amplitudeRef} />}

      {emotion === 'thinking' && !isTalking && (
        <div className="thought-bubble">???</div>
      )}

      {showHint && (
        <div className="interaction-hint">拖拽鼠标旋转查看数字人</div>
      )}
    </div>
  );
}
