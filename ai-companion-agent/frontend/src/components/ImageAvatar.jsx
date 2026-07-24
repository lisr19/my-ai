import React, { useEffect, useRef, useState } from 'react';
import './ImageAvatar.css';
import avatarJoy from '../assets/avatar-joy.png';

// 情绪对应的滤镜与叠加层配置
const EMOTION_STYLES = {
  happy:    { filter: 'brightness(1.08) saturate(1.1)', overlay: 'sparkles' },
  excited:  { filter: 'brightness(1.12) saturate(1.15)', overlay: 'stars' },
  smile:    { filter: 'brightness(1.05) saturate(1.05)', overlay: 'blush' },
  shy:      { filter: 'brightness(1.03) saturate(0.95)', overlay: 'heavy-blush' },
  surprised:{ filter: 'brightness(1.08) contrast(1.05)', overlay: 'shock' },
  sad:      { filter: 'brightness(0.95) saturate(0.85)', overlay: 'tears' },
  angry:    { filter: 'sepia(0.15) saturate(1.2) hue-rotate(-10deg)', overlay: 'anger' },
  thinking: { filter: 'brightness(1.02)', overlay: 'question' },
  talking:  { filter: 'brightness(1.05)', overlay: 'none' },
  idle:     { filter: 'brightness(0.95) saturate(0.9)', overlay: 'sleep' },
};

export default function ImageAvatar({ emotion = 'smile', isTalking = false }) {
  const [blink, setBlink] = useState(false);
  const [mouthOpen, setMouthOpen] = useState(false);
  const blinkTimer = useRef(null);

  // 自动眨眼
  useEffect(() => {
    const scheduleBlink = () => {
      const delay = 2000 + Math.random() * 4000;
      blinkTimer.current = setTimeout(() => {
        setBlink(true);
        setTimeout(() => {
          setBlink(false);
          scheduleBlink();
        }, 150);
      }, delay);
    };
    scheduleBlink();
    return () => clearTimeout(blinkTimer.current);
  }, []);

  // 说话时嘴巴开合
  useEffect(() => {
    if (!isTalking) {
      setMouthOpen(false);
      return;
    }
    let mounted = true;
    const loop = async () => {
      while (mounted) {
        setMouthOpen(true);
        await new Promise(r => setTimeout(r, 120 + Math.random() * 120));
        if (!mounted) break;
        setMouthOpen(false);
        await new Promise(r => setTimeout(r, 80 + Math.random() * 100));
      }
    };
    loop();
    return () => { mounted = false; };
  }, [isTalking]);

  const style = EMOTION_STYLES[emotion] || EMOTION_STYLES.smile;

  return (
    <div className={`image-avatar ${emotion} ${isTalking ? 'talking' : ''}`}>
      <div className="avatar-glow" />

      {/* 主图片容器 */}
      <div
        className="avatar-picture-wrap"
        style={{ filter: style.filter }}
      >
        <img
          src={avatarJoy}
          alt="JOY"
          className="avatar-picture"
        />

        {/* 闭眼遮罩（眨眼动画） */}
        <div className={`avatar-eyelids ${blink ? 'closed' : ''}`}>
          <div className="eyelid left" />
          <div className="eyelid right" />
        </div>

        {/* 嘴巴开合遮罩（说话动画） */}
        <div className={`avatar-mouth ${mouthOpen ? 'open' : ''}`} />
      </div>

      {/* 情绪叠加层 */}
      <div className={`avatar-overlay ${style.overlay}`}>
        {style.overlay === 'blush' && (
          <>
            <div className="blush left" />
            <div className="blush right" />
          </>
        )}
        {style.overlay === 'heavy-blush' && (
          <>
            <div className="blush left heavy" />
            <div className="blush right heavy" />
          </>
        )}
        {style.overlay === 'tears' && (
          <>
            <div className="tear left" />
            <div className="tear right" />
          </>
        )}
        {style.overlay === 'anger' && (
          <>
            <div className="anger-mark left">💢</div>
            <div className="anger-mark right">💢</div>
          </>
        )}
        {style.overlay === 'shock' && <div className="shock-mark">!</div>}
        {style.overlay === 'question' && <div className="question-mark">?</div>}
        {style.overlay === 'sleep' && (
          <div className="sleep-zzz">
            <span>Z</span>
            <span>Z</span>
            <span>Z</span>
          </div>
        )}
        {(style.overlay === 'sparkles' || style.overlay === 'stars') && (
          <div className="sparkles">
            <span>✨</span>
            <span>✨</span>
            <span>✨</span>
          </div>
        )}
      </div>

      {/* 说话时的声波动画 */}
      {isTalking && (
        <div className="voice-waves">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
      )}
    </div>
  );
}
