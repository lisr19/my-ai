import React, { useEffect, useRef } from 'react';
import './CharacterAvatar.css';

/**
 * 卡通角色头像组件
 * 通过 SVG 绘制14岁卡通少女"小柚"，支持10种表情切换
 *
 * Props:
 *   emotion: 'smile' | 'happy' | 'thinking' | 'surprised' | 'sad' | 'angry' | 'talking' | 'idle' | 'excited' | 'shy'
 *   isTalking: boolean - 是否正在说话（驱动嘴型动画）
 */
export default function CharacterAvatar({ emotion = 'smile', isTalking = false }) {
  const avatarRef = useRef(null);

  // 表情切换时添加"弹跳"效果
  useEffect(() => {
    if (!avatarRef.current) return;
    avatarRef.current.classList.remove('bounce');
    void avatarRef.current.offsetWidth; // 触发重排
    avatarRef.current.classList.add('bounce');
  }, [emotion]);

  // 组合表情类名
  const exprClass = isTalking ? 'expr-talking' : `expr-${emotion}`;

  return (
    <div className="avatar-container" ref={avatarRef}>
      <div className="avatar-glow" />
      <svg
        className={`character-svg ${exprClass}`}
        viewBox="0 0 300 360"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* ========== 头发后层 ========== */}
        <ellipse className="hair-back" cx="150" cy="170" rx="115" ry="130" fill="#FF8C42" />
        {/* 双马尾 */}
        <ellipse cx="55" cy="200" rx="35" ry="70" fill="#FF8C42" transform="rotate(-15 55 200)" />
        <ellipse cx="245" cy="200" rx="35" ry="70" fill="#FF8C42" transform="rotate(15 245 200)" />
        {/* 发带 */}
        <rect x="38" y="145" width="30" height="12" rx="6" fill="#FF6B9D" transform="rotate(-15 53 151)" />
        <rect x="232" y="145" width="30" height="12" rx="6" fill="#FF6B9D" transform="rotate(15 247 151)" />

        {/* ========== 脸部 ========== */}
        <ellipse className="face" cx="150" cy="175" rx="88" ry="98" fill="#FFDFD0" />

        {/* 耳朵 */}
        <ellipse cx="65" cy="185" rx="12" ry="18" fill="#FFDFD0" />
        <ellipse cx="235" cy="185" rx="12" ry="18" fill="#FFDFD0" />

        {/* ========== 头发前层（刘海） ========== */}
        <path
          d="M 62 120 Q 70 75 110 70 Q 130 55 150 58 Q 170 55 190 70 Q 230 75 238 120 Q 240 140 235 155 L 210 130 Q 200 138 185 128 L 165 140 Q 150 130 135 140 L 115 128 Q 100 138 90 155 Q 65 140 62 120 Z"
          fill="#FF8C42"
        />
        {/* 刘海高光 */}
        <path
          d="M 100 85 Q 120 72 140 75"
          stroke="#FFB07A"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          opacity="0.6"
        />

        {/* ========== 眉毛 ========== */}
        {/* 默认眉毛 */}
        <g className="brows-default">
          <path className="brow-left" d="M 100 148 Q 115 142 130 148" stroke="#D4761E" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path className="brow-right" d="M 170 148 Q 185 142 200 148" stroke="#D4761E" strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>
        {/* 生气眉毛 */}
        <g className="brows-angry">
          <path d="M 100 145 L 132 155" stroke="#D4761E" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M 200 145 L 168 155" stroke="#D4761E" strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>
        {/* 思考眉毛 */}
        <g className="brows-thinking">
          <path d="M 100 150 Q 115 145 130 150" stroke="#D4761E" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M 170 145 Q 185 140 200 145" stroke="#D4761E" strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>

        {/* ========== 眼睛 ========== */}
        {/* --- 默认圆眼 --- */}
        <g className="eyes-default">
          <g className="eye-left">
            <ellipse cx="115" cy="180" rx="16" ry="20" fill="white" />
            <ellipse className="iris" cx="115" cy="182" rx="12" ry="16" fill="#5B8DEF" />
            <ellipse cx="115" cy="183" rx="7" ry="10" fill="#2C3E50" />
            <circle cx="119" cy="177" r="4" fill="white" />
            <circle cx="111" cy="187" r="2" fill="white" opacity="0.7" />
          </g>
          <g className="eye-right">
            <ellipse cx="185" cy="180" rx="16" ry="20" fill="white" />
            <ellipse className="iris" cx="185" cy="182" rx="12" ry="16" fill="#5B8DEF" />
            <ellipse cx="185" cy="183" rx="7" ry="10" fill="#2C3E50" />
            <circle cx="189" cy="177" r="4" fill="white" />
            <circle cx="181" cy="187" r="2" fill="white" opacity="0.7" />
          </g>
        </g>

        {/* --- 开心眯眼 (^_^) --- */}
        <g className="eyes-happy">
          <path d="M 100 182 Q 115 168 130 182" stroke="#2C3E50" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M 170 182 Q 185 168 200 182" stroke="#2C3E50" strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>

        {/* --- 惊讶大眼 --- */}
        <g className="eyes-surprised">
          <circle cx="115" cy="180" r="20" fill="white" />
          <circle cx="115" cy="180" r="10" fill="#2C3E50" />
          <circle cx="119" cy="175" r="4" fill="white" />
          <circle cx="185" cy="180" r="20" fill="white" />
          <circle cx="185" cy="180" r="10" fill="#2C3E50" />
          <circle cx="189" cy="175" r="4" fill="white" />
        </g>

        {/* --- 难过垂眼 --- */}
        <g className="eyes-sad">
          <g>
            <ellipse cx="115" cy="183" rx="14" ry="12" fill="white" />
            <ellipse cx="113" cy="187" rx="8" ry="9" fill="#5B8DEF" />
            <ellipse cx="113" cy="188" rx="5" ry="6" fill="#2C3E50" />
          </g>
          <g>
            <ellipse cx="185" cy="183" rx="14" ry="12" fill="white" />
            <ellipse cx="183" cy="187" rx="8" ry="9" fill="#5B8DEF" />
            <ellipse cx="183" cy="188" rx="5" ry="6" fill="#2C3E50" />
          </g>
          {/* 眼泪 */}
          <path className="tear-left" d="M 105 200 Q 102 215 105 222 Q 108 215 105 200" fill="#7EC8E3" opacity="0.8" />
        </g>

        {/* --- 兴奋星星眼 --- */}
        <g className="eyes-excited">
          <g transform="translate(115, 180)">
            <path d="M 0,-16 L 4,-5 L 16,-3 L 6,4 L 9,16 L 0,8 L -9,16 L -6,4 L -16,-3 L -4,-5 Z" fill="#FFD700" stroke="#FF8C00" strokeWidth="1.5" />
          </g>
          <g transform="translate(185, 180)">
            <path d="M 0,-16 L 4,-5 L 16,-3 L 6,4 L 9,16 L 0,8 L -9,16 L -6,4 L -16,-3 L -4,-5 Z" fill="#FFD700" stroke="#FF8C00" strokeWidth="1.5" />
          </g>
        </g>

        {/* --- 害羞半闭眼 --- */}
        <g className="eyes-shy">
          <path d="M 100 183 Q 115 178 130 183" stroke="#2C3E50" strokeWidth="3.5" fill="none" strokeLinecap="round" />
          <path d="M 170 183 Q 185 178 200 183" stroke="#2C3E50" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </g>

        {/* --- 待机半闭眼 --- */}
        <g className="eyes-idle">
          <line x1="100" y1="182" x2="130" y2="182" stroke="#2C3E50" strokeWidth="3.5" strokeLinecap="round" />
          <line x1="170" y1="182" x2="200" y2="182" stroke="#2C3E50" strokeWidth="3.5" strokeLinecap="round" />
        </g>

        {/* ========== 腮红 ========== */}
        <g className="blush">
          <ellipse className="blush-left" cx="95" cy="215" rx="18" ry="12" fill="#FFB6C1" opacity="0.6" />
          <ellipse className="blush-right" cx="205" cy="215" rx="18" ry="12" fill="#FFB6C1" opacity="0.6" />
        </g>

        {/* ========== 嘴巴 ========== */}
        {/* 微笑 */}
        <path className="mouth-smile" d="M 135 232 Q 150 244 165 232" stroke="#E85A6C" strokeWidth="4" fill="none" strokeLinecap="round" />
        {/* 开心大笑 */}
        <g className="mouth-happy">
          <path d="M 128 228 Q 150 258 172 228 Q 150 240 128 228" fill="#E85A6C" />
          <path d="M 135 235 Q 150 248 165 235" fill="white" />
        </g>
        {/* 思考小嘴 */}
        <path className="mouth-thinking" d="M 145 235 Q 150 233 155 235" stroke="#E85A6C" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        {/* 惊讶O嘴 */}
        <ellipse className="mouth-surprised" cx="150" cy="236" rx="8" ry="10" fill="#E85A6C" />
        {/* 难过 */}
        <path className="mouth-sad" d="M 135 240 Q 150 228 165 240" stroke="#E85A6C" strokeWidth="4" fill="none" strokeLinecap="round" />
        {/* 生气嘟嘴 */}
        <path className="mouth-angry" d="M 140 236 Q 150 230 160 236 Q 150 242 140 236" fill="#E85A6C" />
        {/* 说话动画嘴 */}
        <g className="mouth-talking">
          <ellipse cx="150" cy="235" rx="10" ry="6" fill="#E85A6C" />
        </g>
        {/* 兴奋大笑 */}
        <g className="mouth-excited">
          <path d="M 125 226 Q 150 260 175 226 Q 150 245 125 226" fill="#E85A6C" />
          <path d="M 132 233 Q 150 250 168 233" fill="white" />
          <ellipse cx="150" cy="250" rx="10" ry="5" fill="#FF6B7A" />
        </g>
        {/* 害羞抿嘴 */}
        <path className="mouth-shy" d="M 140 235 L 160 235" stroke="#E85A6C" strokeWidth="4" fill="none" strokeLinecap="round" />

        {/* ========== 身体（肩膀+衣领） ========== */}
        <path
          d="M 75 290 Q 75 270 100 262 L 200 262 Q 225 270 225 290 L 225 360 L 75 360 Z"
          fill="#5B8DEF"
        />
        {/* 衣领 */}
        <path d="M 120 262 Q 135 278 150 278 Q 165 278 180 262" stroke="white" strokeWidth="3" fill="none" />
        {/* 衣服图案 - 小星星 */}
        <g transform="translate(150, 315)">
          <path d="M 0,-12 L 3,-4 L 12,-3 L 5,3 L 7,12 L 0,6 L -7,12 L -5,3 L -12,-3 L -3,-4 Z" fill="white" opacity="0.5" />
        </g>
      </svg>

      {/* 思考气泡 */}
      <div className="thought-bubble">???</div>
    </div>
  );
}
