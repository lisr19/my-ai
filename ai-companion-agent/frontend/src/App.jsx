import React, { useState, useRef, useCallback, useEffect } from 'react';
import './App.css';
import ImageAvatar from './components/ImageAvatar.jsx';
import ChatWindow from './components/ChatWindow.jsx';
import InputArea from './components/InputArea.jsx';
import { useSpeechRecognition } from './hooks/useSpeechRecognition.js';
import { useEdgeTTS } from './hooks/useEdgeTTS.js';
import { sendChatMessage } from './services/api.js';
import { recognizeImages } from './utils/ocr.js';

const MAX_HISTORY = 10; // 保留最近10轮对话

export default function App() {
  const [messages, setMessages] = useState([]);
  const [emotion, setEmotion] = useState('smile');
  const [isThinking, setIsThinking] = useState(false);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(true);
  const idleTimerRef = useRef(null);

  // 语音 hooks
  const {
    isListening, transcript, isSupported: asrSupported,
    startListening, stopListening, clearTranscript,
  } = useSpeechRecognition();

  const {
    isSpeaking, isMuted,
    speak, stopSpeaking, toggleMute,
  } = useEdgeTTS();

  // 检查后端状态
  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then(data => setIsDemoMode(data.demoMode))
      .catch(() => setIsDemoMode(true));
  }, []);

  // 待机计时器：30秒无交互切换到待机表情
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (!isThinking && !isSpeaking) {
      idleTimerRef.current = setTimeout(() => {
        setEmotion('idle');
      }, 30000);
    }
  }, [isThinking, isSpeaking]);

  useEffect(() => {
    resetIdleTimer();
    return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); };
  }, [resetIdleTimer, messages, emotion]);

  // 发送消息
  const handleSend = useCallback(async ({ text, images: msgImages }) => {
    if (isThinking || isOcrLoading) return;

    const hasImages = msgImages.length > 0;
    let finalText = text || '';
    let ocrHint = '';

    // 如果上传了图片，先进行 OCR 识别（当前 DeepSeek key 不支持图片输入）
    if (hasImages) {
      setIsOcrLoading(true);
      setEmotion('thinking');
      try {
        const results = await recognizeImages(msgImages);
        const ocrParts = results
          .map((r, i) => `【图片${i + 1}】${r.name}\n${r.text || '（未能识别出文字）'}`)
          .join('\n\n');
        ocrHint = `\n\n（注：我通过 OCR 读取了图片中的文字，以下内容供你参考）\n${ocrParts}`;
        finalText = finalText
          ? `${finalText}${ocrHint}`
          : `请根据图片内容回答。${ocrHint}`;
      } catch (e) {
        console.error('OCR failed:', e);
        ocrHint = '（图片 OCR 识别失败，将尝试根据问题回答）';
        finalText = finalText
          ? `${finalText}\n${ocrHint}`
          : `请根据图片内容回答。${ocrHint}`;
      } finally {
        setIsOcrLoading(false);
      }
    }

    // 构建用户消息（最终显示在对话中的是原始文字，内部发送给 AI 的是带 OCR 的完整提示）
    const userMessage = {
      role: 'user',
      content: text,
      images: msgImages,
      _hasImages: hasImages,
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setIsThinking(true);
    setEmotion('thinking');
    stopSpeaking();

    // 构建发送给后端的消息（截取历史）
    const historyMessages = newMessages
      .slice(-MAX_HISTORY * 2)
      .map((m, idx) => {
        // 当前这条用户消息需要替换为带 OCR 的完整提示
        const isLastUser = idx === newMessages.length - 1;
        return {
          role: m.role,
          content: (isLastUser && m.role === 'user') ? finalText : m.content,
          _hasImages: false, // 不向后端发送图片（DeepSeek 不支持）
        };
      });

    let assistantText = '';
    let assistantEmotion = 'smile';
    let ttsSpokenLength = 0;       // 已经被 speak 覆盖的字符数（全量文字）

    // 添加空的 assistant 消息（用于流式填充）
    const assistantIdx = newMessages.length;
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    sendChatMessage(historyMessages, [], {
      onEmotion: (emo) => {
        assistantEmotion = emo;
        setEmotion(emo);
      },
      onText: (chunk) => {
        assistantText += chunk;
        setMessages(prev => {
          const updated = [...prev];
          updated[assistantIdx] = {
            role: 'assistant',
            content: assistantText,
          };
          return updated;
        });

        // 文字出来后立刻生成语音，覆盖当前全部文字（从头开始）
        if (!isMuted && ttsSpokenLength === 0 && assistantText.length >= 10) {
          ttsSpokenLength = assistantText.length;
          speak(assistantText);
        }
      },
      onDone: () => {
        setIsThinking(false);
        if (assistantEmotion === 'smile' && !assistantText) setEmotion('smile');

        // 流结束后，只播还没覆盖到的剩余部分（不会重复第一句）
        if (!isMuted && ttsSpokenLength > 0) {
          const remaining = assistantText.slice(ttsSpokenLength).trim();
          if (remaining.length >= 2) {
            ttsSpokenLength = assistantText.length;
            speak(remaining);
          }
        } else if (!isMuted && ttsSpokenLength === 0 && assistantText) {
          speak(assistantText);
        }
        resetIdleTimer();
      },
      onError: (errMsg) => {
        setIsThinking(false);
        setEmotion('sad');
        setMessages(prev => {
          const updated = [...prev];
          if (updated[assistantIdx]) {
            updated[assistantIdx] = {
              role: 'assistant',
              content: errMsg || '出错了，请稍后再试～',
            };
          }
          return updated;
        });
      },
    });
  }, [messages, isThinking, isOcrLoading, isMuted, speak, stopSpeaking, resetIdleTimer]);

  // 语音输入结束处理
  const handleVoiceStop = useCallback(() => {
    stopListening();
  }, [stopListening]);

  // 语音正在听时设置倾听表情
  useEffect(() => {
    if (isListening) {
      setEmotion('surprised'); // 倾听时用惊讶表情表示在听
    } else if (!isThinking && !isSpeaking && transcript) {
      setEmotion('smile');
    }
  }, [isListening]);

  // 说话状态联动表情
  useEffect(() => {
    if (isSpeaking && !isThinking) {
      setEmotion('talking');
    } else if (!isSpeaking && !isThinking && !isListening && emotion === 'talking') {
      setEmotion('smile');
    }
  }, [isSpeaking]);

  return (
    <div className="app">
      {/* 顶部栏 */}
      <header className="app-header">
        <div className="header-info">
          <h1 className="app-title">JOY</h1>
          <span className="app-subtitle">英语老师</span>
          <span className="app-status">
            {isDemoMode ? 'Demo 模式' : '在线'}
          </span>
        </div>
        <div className="header-actions">
          {/* 静音按钮 */}
            <button
              className="header-btn"
              onClick={toggleMute}
              title={isMuted ? '取消静音' : '静音'}
            >
              {isMuted ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                  <line x1="23" y1="9" x2="17" y2="15"/>
                  <line x1="17" y1="9" x2="23" y2="15"/>
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>
              )}
            </button>
          {/* 清空对话 */}
          <button
            className="header-btn"
            onClick={() => { setMessages([]); setEmotion('smile'); stopSpeaking(); }}
            title="清空对话"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </header>

      {/* 角色区 */}
      <div className="character-section">
        <ImageAvatar
          emotion={emotion}
          isTalking={isSpeaking}
        />
        <div className="emotion-label">
          {getEmotionLabel(emotion, isThinking, isListening, isOcrLoading)}
        </div>
      </div>

      {/* 对话区 */}
      <ChatWindow messages={messages} isThinking={isThinking} />

      {/* 输入区 */}
      <InputArea
        onSend={handleSend}
        onVoiceStart={startListening}
        onVoiceStop={handleVoiceStop}
        isListening={isListening}
        voiceTranscript={transcript}
        isListeningSupported={asrSupported}
        disabled={isThinking || isOcrLoading}
      />
    </div>
  );
}

function getEmotionLabel(emotion, isThinking, isListening, isOcrLoading) {
  if (isListening) return '正在倾听...';
  if (isOcrLoading) return '正在识别图片...';
  if (isThinking) return '思考中...';
  const labels = {
    smile: '微笑',
    happy: '开心',
    thinking: '讲解中',
    surprised: '惊讶',
    sad: '关心你',
    angry: '提醒',
    talking: '回答中',
    idle: '等待提问...',
    excited: '兴奋',
    shy: '害羞',
  };
  return labels[emotion] || '';
}
