import React, { useState, useRef, useEffect } from 'react';

/**
 * 输入区组件 - 文字输入、图片上传、语音输入
 */
export default function InputArea({
  onSend,
  onVoiceStart,
  onVoiceStop,
  isListening,
  voiceTranscript,
  isListeningSupported,
  disabled,
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState([]);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  // 语音转文字结果同步到输入框
  useEffect(() => {
    if (voiceTranscript) {
      setText(voiceTranscript);
    }
  }, [voiceTranscript]);

  // 自动调整文本框高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [text]);

  const handleSend = () => {
    if ((!text.trim() && images.length === 0) || disabled) return;
    onSend({ text: text.trim(), images });
    setText('');
    setImages([]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      if (!file.type.startsWith('image/')) return;
      if (file.size > 10 * 1024 * 1024) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImages(prev => [...prev, { dataUrl: ev.target.result, name: file.name }]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = (ev) => {
          setImages(prev => [...prev, { dataUrl: ev.target.result, name: 'pasted.png' }]);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const removeImage = (idx) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
  };

  const handleVoiceToggle = () => {
    if (isListening) {
      onVoiceStop?.();
    } else {
      onVoiceStart?.();
    }
  };

  return (
    <div className="input-area">
      {/* 图片预览 */}
      {images.length > 0 && (
        <div className="image-preview-row">
          {images.map((img, idx) => (
            <div key={idx} className="image-preview">
              <img src={img.dataUrl} alt="" />
              <button className="image-remove" onClick={() => removeImage(idx)}>x</button>
            </div>
          ))}
        </div>
      )}

      <div className="input-row">
        {/* 图片上传按钮 */}
        <button
          className="input-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          title="上传图片"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="2"/>
            <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
            <path d="M3 16l5-5 4 4 3-3 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          style={{ display: 'none' }}
          onChange={handleImageSelect}
        />

        {/* 文字输入框 */}
        <textarea
          ref={textareaRef}
          className="text-input"
          placeholder={isListening ? '正在听...' : '输入消息，或点击麦克风说话...'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
          rows="1"
        />

        {/* 语音按钮 */}
        {isListeningSupported && (
          <button
            className={`input-btn voice-btn ${isListening ? 'listening' : ''}`}
            onClick={handleVoiceToggle}
            disabled={disabled}
            title="语音输入"
          >
            {isListening ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <rect x="9" y="3" width="6" height="12" rx="3"/>
                <path d="M5 11v1a7 7 0 0 0 14 0v-1" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/>
                <line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <rect x="9" y="3" width="6" height="12" rx="3"/>
                <path d="M5 11v1a7 7 0 0 0 14 0v-1"/>
                <line x1="12" y1="19" x2="12" y2="22"/>
              </svg>
            )}
          </button>
        )}

        {/* 发送按钮 */}
        <button
          className="input-btn send-btn"
          onClick={handleSend}
          disabled={disabled || (!text.trim() && images.length === 0)}
          title="发送"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
