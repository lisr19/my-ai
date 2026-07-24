import React, { useEffect, useRef } from 'react';
import avatarJoy from '../assets/avatar-joy.png';

/**
 * 聊天窗口组件 - 显示对话消息气泡
 */
export default function ChatWindow({ messages, isThinking }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isThinking]);

  return (
    <div className="chat-window" ref={scrollRef}>
      {messages.length === 0 && !isThinking && (
        <div className="chat-empty">
          <p>同学你好呀～把题目、单词或语法问题发给老师吧！</p>
          <p className="chat-empty-hint">支持文字、图片、语音输入</p>
        </div>
      )}
      {messages.map((msg, idx) => (
        <div key={idx} className={`message-row ${msg.role}`}>
          {msg.role === 'assistant' && (
            <img
              src={avatarJoy}
              alt="JOY"
              className="message-avatar"
              style={{ objectFit: 'cover' }}
            />
          )}
          <div className={`message-bubble ${msg.role}`}>
            {msg.images && msg.images.length > 0 && (
              <div className="message-images">
                {msg.images.map((img, i) => (
                  <img key={i} src={img.dataUrl} alt={img.name || ''} className="message-image" />
                ))}
              </div>
            )}
            <div className="message-text">{msg.content}</div>
          </div>
          {msg.role === 'user' && (
            <div className="message-avatar user-avatar">
              <span>我</span>
            </div>
          )}
        </div>
      ))}
      {isThinking && (
        <div className="message-row assistant">
          <img
            src={avatarJoy}
            alt="JOY"
            className="message-avatar"
            style={{ objectFit: 'cover' }}
          />
          <div className="message-bubble assistant thinking">
            <span className="dot" />
            <span className="dot" />
            <span className="dot" />
          </div>
        </div>
      )}
    </div>
  );
}