import io
import wave
from concurrent.futures import ThreadPoolExecutor

import pytest

from clinvexa.consultations import ConsultationError, ConsultationService, consultation_payload


def wav(value=2000):
    output = io.BytesIO()
    with wave.open(output, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(int(value).to_bytes(2, 'little', signed=True) * 16000)
    return output.getvalue()


def test_packet_boundary_does_not_split_chinese_medical_term():
    from clinvexa.consultations import _join_stream_text
    assert _join_stream_text(["建议血", "常规检查"]) == "建议血常规检查"
    assert _join_stream_text(["blood", "count"]) == "blood count"


def test_stream_updates_before_finish_and_does_not_rerun_model(tmp_path):
    calls = []
    def transcribe(path):
        calls.append(path)
        return {'success': True, 'transcript': '主诉：咳嗽3天。' if len(calls) == 1 else '过敏史：青霉素过敏。'}
    service = ConsultationService(tmp_path, transcribe, lambda _: pytest.fail('Stream finalize must not run another model'))
    record = service.start(patient_id='p1', patient_name='测试', consent_confirmed=True)
    first = service.append_audio(record.id, sequence=0, audio=wav())
    assert first.status == 'recording'
    assert '咳嗽' in first.transcript and first.draft is None
    second = service.append_audio(record.id, sequence=1, audio=wav(3000))
    assert '青霉素过敏' in second.transcript and second.draft is None
    final = service.finish_stream(record.id, segment_count=2, duration_ms=2000)
    assert final.status == 'ready'
    assert len(calls) == 2
    assert service.finish_stream(record.id, segment_count=2, duration_ms=2000) == final


def test_retry_idempotent_conflicting_and_out_of_order_rejected(tmp_path):
    calls = []
    service = ConsultationService(tmp_path, lambda path: calls.append(path) or {'success': True, 'transcript': '主诉：头痛一天。'})
    record = service.start(patient_id='p1', patient_name='', consent_confirmed=True)
    with ThreadPoolExecutor(2) as pool:
        futures = [pool.submit(service.append_audio, record.id, sequence=0, audio=wav()) for _ in range(2)]
        assert all(future.result().status == 'recording' for future in futures)
    assert len(calls) == 1
    with pytest.raises(ConsultationError, match='内容不一致'):
        service.append_audio(record.id, sequence=0, audio=wav(3000))
    with pytest.raises(ConsultationError, match='顺序不连续'):
        service.append_audio(record.id, sequence=2, audio=wav())
    with pytest.raises(ConsultationError, match='音频未处理'):
        service.finish_stream(record.id, segment_count=2, duration_ms=2000)


def test_failed_segment_is_retryable_and_doctor_edits_survive_incremental_results(tmp_path):
    attempts = 0
    def transcribe(_):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return {'success': False, 'error': 'provider unavailable'}
        return {'success': True, 'transcript': '主诉：咳嗽3天。'}
    service = ConsultationService(tmp_path, transcribe)
    record = service.start(patient_id='p1', patient_name='', consent_confirmed=True)
    with pytest.raises(ConsultationError):
        service.append_audio(record.id, sequence=0, audio=wav())
    assert service.get(record.id).segments == ()
    service.save_doctor_draft(record.id, draft='医生已核对的草稿', revision=0)
    updated = service.append_audio(record.id, sequence=0, audio=wav())
    assert consultation_payload(updated)['draft_text'] == '医生已核对的草稿'
    with pytest.raises(ConsultationError, match='其他窗口更新'):
        service.save_doctor_draft(record.id, draft='旧版本覆盖', revision=0)
    restarted = ConsultationService(tmp_path, transcribe)
    assert len(restarted.get(record.id).segments) == 1
    assert restarted.recent()[0]['patient_id'] == 'p1'


def test_patient_isolation_and_invalid_wav(tmp_path):
    service = ConsultationService(tmp_path, lambda _: {'success': True, 'transcript': '主诉：咳嗽。'})
    a = service.start(patient_id='a', patient_name='同名', consent_confirmed=True)
    b = service.start(patient_id='b', patient_name='同名', consent_confirmed=True)
    service.append_audio(a.id, sequence=0, audio=wav())
    assert not service.get(b.id).transcript
    with pytest.raises(ConsultationError, match='PCM WAV'):
        service.append_audio(b.id, sequence=0, audio=b'not-a-wav')


def test_durable_failed_audio_recovers_after_process_restart(tmp_path):
    service = ConsultationService(tmp_path, lambda _: {'success': False, 'error': '运行库缺失'})
    record = service.start(patient_id='synthetic', patient_name='', consent_confirmed=True)
    with pytest.raises(ConsultationError, match='运行库缺失'):
        service.append_audio(record.id, sequence=0, audio=wav())
    with pytest.raises(ConsultationError, match='原录音'):
        service.append_audio(record.id, sequence=0, audio=wav(3000))
    with pytest.raises(ConsultationError, match='音频未处理'):
        service.finish_stream(record.id, segment_count=0, duration_ms=1000)
    restored = ConsultationService(tmp_path, lambda _: {'success': True, 'transcript': '头痛三天。'})
    result = restored.recover_audio(record.id)
    assert len(result.segments) == 1 and '头痛三天' in result.transcript
    assert restored.recover_audio(record.id) == result
    assert restored.finish_stream(record.id, segment_count=1, duration_ms=1000).status == 'ready'
