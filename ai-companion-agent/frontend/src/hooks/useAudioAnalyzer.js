import { useRef, useEffect, useCallback } from 'react';

/**
 * 实时音频分析 Hook
 * 通过 Web Audio API 分析音频元素的音量幅度，用于驱动口型动画
 *
 * @param {React.RefObject} audioRef - useEdgeTTS 暴露的 audio 元素 ref
 * @returns {{ amplitudeRef: React.RefObject }}
 *
 * 关键修复：
 * 1. 使用轮询 (setTimeout) 检测 audio 元素是否被创建
 *    - 因为 audioRef.current 改变不会触发 useEffect 重新执行
 * 2. checkReady() 内部循环检测，避免依赖副作用
 */
export function useAudioAnalyzer(audioRef) {
  const amplitudeRef = useRef(0);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const sourceRef = useRef(null);
  const rafRef = useRef(null);
  const pollTimerRef = useRef(null);
  const initializedRef = useRef(false);

  const cleanup = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.disconnect(); } catch {}
      sourceRef.current = null;
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch {}
      analyserRef.current = null;
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
    initializedRef.current = false;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const tryInit = () => {
      if (cancelled || initializedRef.current) return;

      const audio = audioRef && audioRef.current;
      if (!audio) {
        // audio 元素还没被创建，继续轮询
        pollTimerRef.current = setTimeout(tryInit, 250);
        return;
      }

      // 等待 audio 真正有 src（unlockAudio 会设置静音 mp3 作为 src）
      if (!audio.src || audio.src === window.location.href) {
        pollTimerRef.current = setTimeout(tryInit, 250);
        return;
      }

      // 初始化 Web Audio（如果浏览器不支持则跳过）
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        console.warn('[AudioAnalyzer] Web Audio API 不可用');
        return;
      }

      try {
        const audioCtx = new AudioCtx();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.4;
        analyser.minDecibels = -70;
        analyser.maxDecibels = -10;

        // 将 audio 元素连接到分析器
        const source = audioCtx.createMediaElementSource(audio);
        source.connect(analyser);
        analyser.connect(audioCtx.destination);

        audioCtxRef.current = audioCtx;
        analyserRef.current = analyser;
        sourceRef.current = source;
        initializedRef.current = true;

        // 启动分析循环
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const update = () => {
          if (!analyserRef.current) return;

          // 获取时域数据计算 RMS 音量
          analyser.getByteTimeDomainData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const v = (dataArray[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / dataArray.length);

          // 放大和平滑处理，让小幅度的声音也能驱动口型
          amplitudeRef.current = Math.min(1, rms * 4.5);

          rafRef.current = requestAnimationFrame(update);
        };
        update();

        console.log('[AudioAnalyzer] 初始化完成');
      } catch (e) {
        // 同一 audio 元素重复 createMediaElementSource 会抛 InvalidStateError
        // 此时说明已经初始化过了，忽略即可
        if (e && e.name === 'InvalidStateError') {
          initializedRef.current = true;
          console.log('[AudioAnalyzer] audio 元素已连接，跳过重复初始化');
        } else {
          console.warn('[AudioAnalyzer] 初始化失败:', e && e.message);
        }
      }
    };

    tryInit();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [audioRef, cleanup]);

  return { amplitudeRef };
}
