// API 服务 - 与后端通信

export async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    return await res.json();
  } catch {
    return { status: 'error', demoMode: true };
  }
}

/**
 * 发送对话消息（流式）
 * @param {Array} messages - 对话历史
 * @param {Array} images - 图片列表 [{ dataUrl, name }]
 * @param {Object} callbacks - { onText, onEmotion, onDone, onError }
 */
export async function sendChatMessage(messages, images, callbacks) {
  const { onText, onEmotion, onDone, onError } = callbacks;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, images }),
    });

    if (!res.ok) {
      onError?.('网络错误，请检查后端服务是否启动');
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'text') {
            onText?.(parsed.content);
          } else if (parsed.type === 'emotion') {
            onEmotion?.(parsed.emotion);
          } else if (parsed.type === 'done') {
            onDone?.();
          } else if (parsed.type === 'error') {
            onError?.(parsed.message);
          }
        } catch {
          // skip
        }
      }
    }

    // onDone 已在 SSE done 事件中触发，不需要再次调用
  } catch (error) {
    onError?.('连接失败，请检查网络或后端服务');
  }
}
