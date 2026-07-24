import { useState, useCallback, useRef } from 'react';

// 1ms 静音 MP3，用作 autoplay 解锁
const SILENT_MP3 = 'data:audio/mpeg;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTGFTb25vdGVEb21haW5hdGlvbiBQcm9kLjk5LjEwLjEwAAAAUHJvbWlzZSAxLjE0LjEwMAUgbWFRdWlja1RpbWVzIFNvbGlUYXhpc0Rpc3RyaWN0ZWRNb2RlAAAAAAAAAAAAAAAA//sQxAADB6Q7pALCYNz/+xDEDv/+5DMAJgQZRqpLCAa8AACf/+xDEDv8AAABP/+5DMAaQRZqpLCAb//+xDEDgQAAAV/+xDMAaQRZqrLCAc//+xDEDgQAAAV/+xDMAaQRZqrLCAcAAGgAAAAAAAAD/+xDMAVARZqrLCAcAAA//sQZAEP8AAAaQAAAAgAAA0gAAABAAkxvAGgD/////////////////////////////////////////sQZB4P8AAAaQAAAAgAAA0gAAABAAkxvAGgD';

/**
 * TTS Hook - 复用持久化 audio 元素，绕过 autoplay 限制
 */
export function useEdgeTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef(null);
  const readyRef = useRef(false);          // audio 是否已被解锁
  const currentBlobUrlRef = useRef(null);
  const playTokenRef = useRef(0);

  /**
   * 在用户手势内初始化并解锁 audio 元素
   */
  const unlockAudio = useCallback(() => {
    if (readyRef.current) return;
    try {
      const audio = new Audio();
      audio.src = SILENT_MP3;
      audio.loop = false;
      audio.volume = 0;
      audio.muted = true;
      const p = audio.play();
      if (p && p.then) p.catch(() => {});
      audioRef.current = audio;
      readyRef.current = true;
    } catch (e) {
      console.warn('[TTS] unlock failed:', e);
    }
  }, []);

  /**
   * 切换 audio 到指定 URL，等它真正开始播放
   */
  const playUrl = useCallback((url) => {
    return new Promise((resolve, reject) => {
      const audio = audioRef.current;
      if (!audio) {
        reject(new Error('Audio not unlocked'));
        return;
      }

      // 取消旧的 token
      const myToken = ++playTokenRef.current;

      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        audio.oncanplay = null;
        audio.onended = null;
        audio.onerror = null;
        audio.removeAttribute('src');
        audio.load();
        if (currentBlobUrlRef.current) {
          URL.revokeObjectURL(currentBlobUrlRef.current);
          currentBlobUrlRef.current = null;
        }
      };

      audio.oncanplay = () => {
        if (myToken !== playTokenRef.current) {
          cleanup();
          resolve();
          return;
        }
        // 解除静音，恢复音量
        audio.muted = false;
        audio.volume = 1;
        audio.play().catch((err) => {
          cleanup();
          reject(err);
        });
        setIsSpeaking(true);
        resolve();
      };

      audio.onended = () => {
        setIsSpeaking(false);
        cleanup();
      };

      audio.onerror = (e) => {
        if (myToken !== playTokenRef.current) {
          cleanup();
          resolve();
          return;
        }
        setIsSpeaking(false);
        cleanup();
        reject(e);
      };

      // 设置新的 src（保留 muted=true 直到开始播放，避免突然出声）
      audio.muted = true;
      audio.volume = 0;
      if (currentBlobUrlRef.current) URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = url;
      audio.src = url;
      audio.load();
    });
  }, []);

  /**
   * 把文字合成为语音并播放（直接覆盖）
   */
  const speakOne = useCallback(async (text) => {
    if (isMuted || !text || !text.trim()) return;
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
      });
      if (!res.ok) throw new Error('TTS 请求失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      await playUrl(url);
    } catch (err) {
      console.error('[TTS] Speak error:', err);
      setIsSpeaking(false);
    }
  }, [isMuted, playUrl]);

  /**
   * 多段文字按调用顺序排队播放，不会互相打断
   */
  const queueRef = useRef([]);
  const playingRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (playingRef.current) return;
    playingRef.current = true;
    while (queueRef.current.length > 0) {
      const text = queueRef.current.shift();
      await speakOne(text);
    }
    playingRef.current = false;
  }, [speakOne]);

  const speak = useCallback((text) => {
    if (isMuted || !text || !text.trim()) return;
    const trimmed = text.trim();
    // 去重：如果队列最后一项就是相同文字，跳过
    const q = queueRef.current;
    if (q.length > 0 && q[q.length - 1] === trimmed) return;
    q.push(trimmed);
    processQueue();
  }, [isMuted, processQueue]);

  const stopSpeaking = useCallback(() => {
    queueRef.current = [];
    playTokenRef.current++;
    const audio = audioRef.current;
    if (audio) {
      audio.oncanplay = null;
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch {}
    }
    if (currentBlobUrlRef.current) {
      URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = null;
    }
    setIsSpeaking(false);
    playingRef.current = false;
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      if (!prev) stopSpeaking();
      return !prev;
    });
  }, [stopSpeaking]);

  return {
    isSpeaking,
    isMuted,
    isSupported: true,
    speak,
    stopSpeaking,
    toggleMute,
    unlockAudio,   // 暴露给 App.jsx 在用户手势中调用
  };
}