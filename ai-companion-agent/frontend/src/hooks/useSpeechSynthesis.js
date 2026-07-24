import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * 语音合成 Hook (TTS) - 使用浏览器 Web Speech API
 */
export function useSpeechSynthesis() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const utteranceRef = useRef(null);

  useEffect(() => {
    if ('speechSynthesis' in window) {
      setIsSupported(true);
    }
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // 尝试选择中文女声
  const getVoice = useCallback(() => {
    if (!isSupported) return null;
    const voices = window.speechSynthesis.getVoices();
    // 优先选择中文女声
    const preferred = voices.find(v =>
      v.lang.startsWith('zh') && (v.name.includes('Female') || v.name.includes('女') || v.name.includes('Ting'))
    );
    return preferred || voices.find(v => v.lang.startsWith('zh')) || voices[0];
  }, [isSupported]);

  const speak = useCallback((text) => {
    if (!isSupported || isMuted || !text) return;

    // 取消之前的播报
    window.speechSynthesis.cancel();

    // 移除颜文字等符号，让语音更自然
    const cleanText = text
      .replace(/\(.*?\)/g, '')
      .replace(/[✧◕ᴗ≧≦◡≖▽⁄]+/g, '')
      .replace(/~+/g, '～')
      .trim();

    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = 'zh-CN';
    utterance.rate = 1.1;
    utterance.pitch = 1.3; // 提高音调模拟少女音
    utterance.volume = 1;

    const voice = getVoice();
    if (voice) utterance.voice = voice;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [isSupported, isMuted, getVoice]);

  const stopSpeaking = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [isSupported]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      if (!prev) {
        window.speechSynthesis.cancel();
        setIsSpeaking(false);
      }
      return !prev;
    });
  }, []);

  return {
    isSpeaking,
    isMuted,
    isSupported,
    speak,
    stopSpeaking,
    toggleMute,
  };
}
