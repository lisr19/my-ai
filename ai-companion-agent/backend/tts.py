#!/usr/bin/env python3
"""
Edge TTS 语音合成（纯文本模式，无 SSML）
Neural 语音自带自然语调，不需要额外 SSML

用法: python tts.py <text> <output_path>
"""

import asyncio
import sys
import edge_tts
import traceback

# 中文女声（活泼风格，自带动听语调）
VOICE = 'zh-CN-XiaoyiNeural'


async def synthesize(text, output_path):
    communicate = edge_tts.Communicate(text, VOICE)
    await communicate.save(output_path)


if __name__ == '__main__':
    try:
        text = sys.argv[1]
        output_path = sys.argv[2] if len(sys.argv) > 2 else '/tmp/tts_output.mp3'
        asyncio.run(synthesize(text, output_path))
    except Exception:
        traceback.print_exc()
        sys.exit(1)
