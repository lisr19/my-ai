import { useState, useCallback, useRef } from 'react';

// 1ms 静音 MP3，用作 autoplay 解锁
const SILENT_MP3 = 'data:audio/mpeg;base64,SUQzBAAAAAABEVRYWFgAAAAtAAADY29tbWVudABCaWdTb3VuZEJhbmsuY29tIC8gTGFTb25vdGVEb21haW5hdGlvbiBQcm9kLjk5LjEwLjEwAAAAUHJvbWlzZSAxLjE0LjEwMAUgbWFRdWlja1RpbWVzIFNvbGlUYXhpc0Rpc3RyaWN0ZWRNb2RlAAAAAAAAAAAAAAAA//sQxAADB6Q7pALCYNz/+xDEDv/+5DMAJgQZRqpLCAa8AACf/+xDEDv8AAABP/+5DMAaQRZqpLCAb//+xDEDgQAAAV/+xDMAaQRZqrLCAc//+xDEDgQAAAV/+xDMAaQRZqrLCAcAAGgAAAAAAAAD/+xDMAVARZqrLCAcAAA//sQZAEP8AAAaQAAAAgAAA0gAAABAAkxvAGgD/////////////////////////////////////////sQZB4P8AAAaQAAAAgAAA0gAAABAAkxvAGgD';

/**
 * TTS Hook - 复用持久化 audio 元素，绕过 autoplay 限制
 *
 * 同时在用户手势中初始化 Web Audio API 分析器，
 * 用于驱动数字人口型动画（amplitudeRef）。
 */
export function useEdgeTTS() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef(null);

  // Web Audio 分析器（在用户手势中创建，符合浏览器 autoplay policy）
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const ampRafRef = useRef(null);
  const amplitudeRef = useRef(0);

  const readyRef = useRef(false);
  const currentBlobUrlRef = useRef(null);
  const playTokenRef = useRef(0);

  /**
   * 启动音频分析循环
   * 计算音频 RMS 音量幅度，用于驱动口型同步
   */
  const startAmplitudeLoop = useCallback(() => {
    if (ampRafRef.current || !analyserRef.current) return;
    const analyser = analyserRef.current;
    const buf = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (!analyserRef.current) return;
      analyser.getByteTimeDomainData(buf);

      // 计算 RMS（均方根）
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length);
      // 放大让小幅度的语音也能驱动口型
      amplitudeRef.current = Math.min(1, rms * 4.5);

      ampRafRef.current = requestAnimationFrame(tick);
    };
    ampRafRef.current = requestAnimationFrame(tick);
  }, []);

  /**
   * 在用户手势内初始化并解锁 audio 元素 + 音频分析器
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

      // 创建 Web Audio 分析器（必须在用户手势中创建）
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        try {
          const audioCtx = new AudioCtx();
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.4;
          analyser.minDecibels = -70;
          analyser.maxDecibels = -10;

          // 将 audio 元素连接到分析器，并输出到音箱
          const source = audioCtx.createMediaElementSource(audio);
          source.connect(analyser);
          analyser.connect(audioCtx.destination);

          audioCtxRef.current = audioCtx;
          analyserRef.current = analyser;

          // Chrome autoplay policy：恢复被挂起的音频上下文
          if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
          }

          // 启动分析循环
          startAmplitudeLoop();
          console.log('[TTS] Audio analyzer initialized');
        } catch (e) {
          console.warn('[TTS] Audio analyzer init failed:', e);
        }
      }
    } catch (e) {
      console.warn('[TTS] unlock failed:', e);
    }
  }, [startAmplitudeLoop]);

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
        // 音频结束，重置幅度
        amplitudeRef.current = 0;
        cleanup();
      };

      audio.onerror = (e) => {
        if (myToken !== playTokenRef.current) {
          cleanup();
          resolve();
          return;
        }
        setIsSpeaking(false);
        amplitudeRef.current = 0;
        cleanup();
        reject(e);
      };

      audio.muted = true;
      audio.volume = 0;
      if (currentBlobUrlRef.current) URL.revokeObjectURL(currentBlobUrlRef.current);
      currentBlobUrlRef.current = url;
      audio.src = url;
      audio.load();
    });
  }, []);

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
    const q = queueRef.current;
    if (q.length > 0 && q[q.length - 1] === trimmed) return;
    q.push(trimmed);
    processQueue();
  }, [isMuted, processQueue]);

  const stopSpeaking = useCallback(() => {
    queueRef.current = [];
    playTokenRef.current++;
    amplitudeRef.current = 0;
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
    unlockAudio,
    audioRef,
    amplitudeRef,  // 直接从 useEdgeTTS 暴露音频幅度引用
  };
}
