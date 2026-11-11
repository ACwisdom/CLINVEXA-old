import pytest
from hermes_cli.clinvexa_streaming import VisibleContent, content_stream
from types import SimpleNamespace as NS
import asyncio
import threading

def test_split_thinking_tags_never_leak():
    v = VisibleContent()
    output = ''.join(v.feed(part) for part in ['<thi','nk>private',' reasoning</th','ink>医生','可见结果'])
    assert output == '医生可见结果'
    assert v.feed('',final=True) == ''

@pytest.mark.asyncio
async def test_reasoning_delta_ignored_content_streamed(monkeypatch):
    def chunks(**kwargs):
        assert kwargs['stream'] is True
        yield NS(choices=[NS(delta=NS(reasoning_content='hidden',content=None))])
        yield NS(choices=[NS(delta=NS(content='第一段'))])
        yield NS(choices=[NS(delta=NS(content='第二段'))])
    monkeypatch.setattr('agent.auxiliary_client.call_llm',chunks)
    assert [part async for part in content_stream(messages=[])] == ['第一段','第二段']


@pytest.mark.asyncio
async def test_finish_reason_preserved_separately_from_visible_content(monkeypatch):
    def chunks(**kwargs):
        assert 'on_metadata' not in kwargs
        yield NS(choices=[NS(delta=NS(content='{"summary":"abc'), finish_reason=None)])
        yield NS(choices=[NS(delta=NS(content=None), finish_reason='length')])
    monkeypatch.setattr('agent.auxiliary_client.call_llm', chunks)
    metadata = {}
    assert ''.join([part async for part in content_stream(messages=[], on_metadata=metadata.update)]) == '{"summary":"abc'
    assert metadata['finishReason'] == 'length'


@pytest.mark.asyncio
async def test_cancellation_closes_pending_transport(monkeypatch):
    ready, closed = threading.Event(), threading.Event()
    class BlockedStream:
        def __iter__(self):
            ready.set()
            closed.wait(2)
            return iter([])
        def close(self):
            closed.set()
    monkeypatch.setattr('agent.auxiliary_client.call_llm', lambda **kwargs: BlockedStream())
    async def consume():
        return [part async for part in content_stream(messages=[])]
    pending = asyncio.create_task(consume())
    assert await asyncio.to_thread(ready.wait, 1)
    pending.cancel()
    with pytest.raises(asyncio.CancelledError):
        await pending
    assert await asyncio.to_thread(closed.wait, 0.5)


@pytest.mark.asyncio
async def test_provider_error_is_categorized_without_secret_details(monkeypatch):
    from hermes_cli.clinvexa_streaming import ModelStreamError
    class RateError(Exception):
        status_code = 429
    def fail(**kwargs):
        raise RateError('secret-token-and-patient-body')
    monkeypatch.setattr('agent.auxiliary_client.call_llm', fail)
    with pytest.raises(ModelStreamError) as caught:
        _ = [part async for part in content_stream(messages=[])]
    assert caught.value.code == 'rate_limit'
    assert 'secret' not in str(caught.value)
