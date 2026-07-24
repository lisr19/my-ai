import { useState, useCallback, useRef } from 'react';

/**
 * TTS 语音合成 Hook（后端代理）
 * 通过后端 /api/tts 获取高质量语音（macOS Tingting）
 * 多段文字按调用顺序排队播放，不会互相打断
 */
export function useEdgeTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef(null);
  const queueRef = useRef([]);        // 等待播放的队列
  const playingRef = useRef(false);   // 是否正在播放队列
  const abortRef = useRef(null);

  /**
   * 合成并播放单段
   */
  const playOne = useCallback(async (text) => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() }),
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (!res.ok) throw new Error('TTS 请求失败');

      const blob = await res.blob();
      if (controller.signal.aborted) return;

      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      return new Promise((resolve) => {
        const cleanup = () => {
          URL.revokeObjectURL(url);
          if (audioRef.current === audio) audioRef.current = null;
          resolve();
        };
        audio.onended = () => {
          setIsSpeaking(false);
          cleanup();
        };
        audio.onerror = () => {
          setIsSpeaking(false);
          cleanup();
        };
        audioRef.current = audio;
        setIsSpeaking(true);
        audio.play().catch(() => {
          setIsSpeaking(false);
          cleanup();
        });
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[TTS] Play error:', err);
    }
  }, []);

  /**
   * 处理队列：顺序播放
   */
  const processQueue = useCallback(async () => {
    if (playingRef.current) return;
    playingRef.current = true;

    while (queueRef.current.length > 0) {
      if (abortRef.current?.signal.aborted) break;
      const text = queueRef.current.shift();
      try {
        await playOne(text);
      } catch {
        // playOne handles its own errors
      }
    }

    setIsSpeaking(false);
    playingRef.current = false;
  }, [playOne]);

  /**
   * 添加到播放队列
   */
  const speak = useCallback((text) => {
    if (isMuted || !text || !text.trim()) return;
    const trimmed = text.trim();
    // 去重：如果队列最后一个就是相同文字，跳过
    const q = queueRef.current;
    if (q.length > 0 && q[q.length - 1] === trimmed) return;
    q.push(trimmed);
    processQueue();
  }, [isMuted, processQueue]);

  const stopSpeaking = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    queueRef.current = [];
    setIsSpeaking(false);
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
  };
}