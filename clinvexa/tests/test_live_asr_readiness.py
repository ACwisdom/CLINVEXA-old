import importlib.util
from clinvexa import live_asr
from clinvexa.consultations import ConsultationService, ConsultationError
import pytest


def test_missing_installation_cannot_start_a_recording(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    status = live_asr.status()
    assert not status['installed'] and not status['ready'] and status['error']
    service = ConsultationService(tmp_path / 'consultations')
    with pytest.raises(ConsultationError, match='缺失|不完整'):
        service.start(patient_id='synthetic', patient_name='', consent_confirmed=True)
    assert not list((tmp_path / 'consultations').glob('*/consultation.json'))


def test_directory_alone_is_not_an_installed_model(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    (tmp_path / 'models' / 'clinvexa-live' / live_asr.QWEN_NAME).mkdir(parents=True)
    assert live_asr.model_directory(live_asr.QWEN_NAME) is None
    assert not live_asr.status('shanghai')['installed']


def test_missing_library_is_reported_even_when_model_files_exist(tmp_path, monkeypatch):
    monkeypatch.setattr(live_asr, 'model_directory', lambda *args: tmp_path)
    monkeypatch.setattr(importlib.util, 'find_spec', lambda name: None)
    status = live_asr.status('yue')
    assert not status['ready'] and not status['installed']
    assert '运行库缺失' in status['error']


def test_decode_failure_is_a_recoverable_response(tmp_path, monkeypatch):
    monkeypatch.setattr(live_asr, 'warmup', lambda dialect: {'ready': True, 'model': live_asr.QWEN_NAME})
    result = live_asr.transcribe(str(tmp_path / 'missing.wav'))
    assert not result['success'] and result['transcript'] == ''
    assert 'FileNotFoundError' in result['error']
