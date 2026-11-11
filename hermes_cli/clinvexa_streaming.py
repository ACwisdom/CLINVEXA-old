"""Bridge configured SDK content streams to async desktop tasks.

Only user-visible content deltas are forwarded. Provider reasoning fields are
never read. Inline thinking blocks, including split tags, are suppressed.
"""
from __future__ import annotations
import asyncio
import threading


class ModelStreamError(ValueError):
    """Public, non-sensitive failure category; never expose SDK request bodies."""
    def __init__(self, code: str):
        self.code = code
        super().__init__({
            'timeout': '模型响应超时，请重试',
            'authentication': '模型服务鉴权失败，请检查凭证',
            'rate_limit': '模型服务繁忙，请稍后重试',
            'connection': '模型流式连接中断，请重试',
            'provider': '模型服务未完成请求，请重试',
        }.get(code, '模型流式响应中断，请重试'))

class VisibleContent:
    def __init__(self):
        self.buffer = ""
        self.thinking = False

    def feed(self, text: str, final: bool = False) -> str:
        self.buffer += text
        output = ""
        while self.buffer:
            tag = "</think>" if self.thinking else "<think>"
            index = self.buffer.find(tag)
            if index >= 0:
                if not self.thinking:
                    output += self.buffer[:index]
                self.buffer = self.buffer[index + len(tag):]
                self.thinking = not self.thinking
                continue
            keep = 0
            if not final:
                for length in range(1, min(len(tag), len(self.buffer) + 1)):
                    if self.buffer.endswith(tag[:length]):
                        keep = length
            safe = self.buffer[:-keep] if keep else self.buffer
            if not self.thinking:
                output += safe
            self.buffer = self.buffer[-keep:] if keep else ""
            break
        return output

async def content_stream(*, on_metadata=None, **kwargs):
    from agent.auxiliary_client import call_llm
    loop = asyncio.get_running_loop()
    queue = asyncio.Queue()
    stopped = threading.Event()
    stream_box = []
    def close_stream():
        if stream_box:
            stream = stream_box[0]
            if hasattr(stream, 'close'):
                try:
                    stream.close()
                except Exception:
                    pass
    def put(value):
        if not stopped.is_set():
            try:
                loop.call_soon_threadsafe(queue.put_nowait, value)
            except RuntimeError:
                pass  # The owning request/event loop has already closed.
    def worker():
        stream = None
        try:
            stream = call_llm(stream=True, **kwargs)
            stream_box.append(stream)
            if stopped.is_set():
                return
            visible = VisibleContent()
            size = 0
            for chunk in ([stream] if hasattr(stream, "choices") else stream):
                if stopped.is_set():
                    break
                choices = getattr(chunk, "choices", None)
                if not choices:
                    continue
                finish = getattr(choices[0], 'finish_reason', None)
                if finish:
                    put(('metadata', {'finishReason': finish}))
                delta = getattr(choices[0], "delta", None) or getattr(choices[0], "message", None)
                text = getattr(delta, "content", None)
                if isinstance(text, str):
                    text = visible.feed(text)
                    size += len(text)
                    if size > 60000:
                        raise ValueError("output exceeds desktop limit")
                    if text:
                        put(text)
            tail = visible.feed("", final=True)
            if tail:
                put(tail)
        except Exception as exc:
            status = getattr(exc, 'status_code', None)
            code = ('authentication' if status in (401, 403) else
                    'rate_limit' if status == 429 else
                    'timeout' if 'timeout' in type(exc).__name__.lower() else
                    'connection' if 'connection' in type(exc).__name__.lower() else 'provider')
            put(ModelStreamError(code))
        finally:
            close_stream()
            put(None)
    task = asyncio.create_task(asyncio.to_thread(worker))
    try:
        while True:
            item = await queue.get()
            if item is None:
                break
            if isinstance(item, Exception):
                raise item
            if isinstance(item, tuple):
                if on_metadata:
                    on_metadata(item[1])
                continue
            yield item
    finally:
        stopped.set()
        if not task.done():
            # Release the obsolete HTTP read too, not just its asyncio waiter.
            cleanup = asyncio.create_task(asyncio.to_thread(close_stream))
            cleanup.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
        task.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
