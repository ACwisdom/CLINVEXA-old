from dataclasses import replace
import json
from fastapi.testclient import TestClient
from clinvexa.consultation_intelligence import validated_item
from clinvexa.consultations import ConsultationService, consultation_payload
from clinvexa.main import create_app

def test_fact_requires_quote_not_model_invention():
    transcript = '医生：有没有青霉素过敏？患者：没有药物过敏。'
    assert validated_item({'type':'field','key':'allergy_history','value':'否认药物过敏','evidence':'没有药物过敏'}, transcript)
    assert validated_item({'type':'field','key':'allergy_history','value':'青霉素过敏','evidence':'患者：青霉素过敏'}, transcript) is None
    assert validated_item({'type':'field','key':'invented','value':'test','evidence':'没有药物过敏'}, transcript) is None
    assert validated_item({'type':'suggestion','title':'核对过敏史','reason':'尚需核对','evidence':'没有药物过敏'}, transcript)['requires_human_review']

def test_stream_preserves_edits_and_new_audio(tmp_path, monkeypatch):
    service = ConsultationService(tmp_path, lambda _: {'success': True, 'transcript': '合成测试'})
    record = service.start(patient_id='synthetic', patient_name='', consent_confirmed=True, dialect='shanghai')
    record = replace(record, transcript='咳嗽三天青霉素过敏', raw_transcript='咳嗽三天青霉素过敏', segments=({'sequence':0},))
    service._save(record)
    def items(_):
        yield {'type':'field','key':'chief_complaint','value':'咳嗽3天','evidence':'咳嗽三天'}
        current = service.save_doctor_draft(record.id, draft='医生手动定稿', revision=0)
        service._save(replace(current, transcript=current.transcript+'没有长期用药',segments=(*current.segments, {'sequence':1})))
        yield {'type':'suggestion','title':'补问伴随症状','reason':'信息不足','evidence':'咳嗽三天'}
    monkeypatch.setattr('clinvexa.consultation_intelligence.stream_analysis', items)
    events = list(service.analyze_stream(record.id))
    assert [e['type'] for e in events] == ['progress','field','suggestion','done']
    saved = service.get(record.id)
    assert len(saved.segments) == 2 and saved.analysis_segments == 1
    assert saved.dialect == 'shanghai'
    assert consultation_payload(saved)['draft_text'] == '医生手动定稿'
    assert saved.suggestions and saved.analysis_warning
    assert '没有长期用药' in saved.transcript

def test_stream_failure_keeps_transcript_and_no_false_success(tmp_path, monkeypatch):
    service = ConsultationService(tmp_path, lambda _: {'success': True, 'transcript': '合成测试'})
    r = service.start(patient_id='synthetic',patient_name='',consent_confirmed=True)
    service._save(replace(r, transcript='咳嗽',raw_transcript='咳嗽'))
    def broken(_): raise RuntimeError('secret private request')
    monkeypatch.setattr('clinvexa.consultation_intelligence.stream_analysis',broken)
    client = TestClient(create_app(consultation_service=service))
    response = client.post(f'/clinvexa/consultations/{r.id}/analysis')
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]['type'] == 'error'
    assert 'secret' not in response.text
    assert service.get(r.id).analysis_mode == 'pending'
    assert service.get(r.id).transcript == '咳嗽'

def test_corrected_words_survive_new_audio_and_original_is_preserved(tmp_path):
    from test_consultation_stream import wav
    service = ConsultationService(tmp_path, lambda _: {'success':True,'transcript':'无长期用药。'})
    r = service.start(patient_id='synthetic',patient_name='',consent_confirmed=True)
    service.append_audio(r.id,sequence=0,audio=wav())
    service.correct_transcript(r.id,text='青霉素过敏。',segment_count=1)
    updated = service.append_audio(r.id,sequence=1,audio=wav(3000))
    assert updated.transcript.startswith('青霉素过敏。')
    assert updated.transcript.endswith('无长期用药。')
    assert updated.raw_transcript.count('无长期用药') == 2
    assert '青霉素' not in updated.raw_transcript

def test_stream_accepts_pretty_json_and_hides_thinking(monkeypatch):
    from types import SimpleNamespace as NS
    from clinvexa.consultation_intelligence import stream_analysis
    text = '<think>private</think>```json\n' + json.dumps({
        'type': 'field', 'key': 'chief_complaint', 'value': '腹痛3天',
        'evidence': '肚子痛三天'}, ensure_ascii=False, indent=2) + '\n```'
    chunks = [NS(choices=[NS(delta=NS(content=text[i:i+7]))]) for i in range(0, len(text), 7)]
    monkeypatch.setattr('agent.auxiliary_client.call_llm', lambda **_: iter(chunks))
    monkeypatch.setattr('hermes_cli.config.load_config', lambda: {'model': {}})
    assert list(stream_analysis('肚子痛三天')) == [{'type':'field','key':'chief_complaint','value':'腹痛3天','evidence':'肚子痛三天'}]

def test_role_inference_is_grounded_and_saved(tmp_path, monkeypatch):
    service = ConsultationService(tmp_path, lambda _: {'success': True, 'transcript': '合成测试'})
    r = service.start(patient_id='synthetic',patient_name='',consent_confirmed=True)
    service._save(replace(r, transcript='医生问哪里不舒服患者说肚子痛三天'))
    role = validated_item({'type':'utterance','role':'患者','evidence':'肚子痛三天'}, '医生问哪里不舒服患者说肚子痛三天')
    assert role['inferred'] is True
    assert validated_item({'type':'utterance','role':'患者','evidence':'胸痛'}, r.transcript) is None
    monkeypatch.setattr('clinvexa.consultation_intelligence.stream_analysis', lambda _: iter([
        {'type':'field','key':'chief_complaint','value':'腹痛3天','evidence':'肚子痛三天'}, role]))
    assert list(service.analyze_stream(r.id))[-1]['type'] == 'done'
    assert service.get(r.id).analysis_turns == (role,)
    assert not service.get(r.id).suggestions

def test_auth_error_is_actionable_without_leaking_response(tmp_path, monkeypatch):
    service = ConsultationService(tmp_path, lambda _: {'success': True, 'transcript': '合成测试'})
    r = service.start(patient_id='synthetic',patient_name='',consent_confirmed=True)
    service._save(replace(r, transcript='肚子痛'))
    class AuthError(Exception): status_code = 401
    def broken(_): raise AuthError('secret-token')
    monkeypatch.setattr('clinvexa.consultation_intelligence.stream_analysis', broken)
    event = list(service.analyze_stream(r.id))[-1]
    assert '鉴权' in event['message'] and 'secret-token' not in str(event)

def test_production_entrypoint_loads_profile_before_server(monkeypatch):
    from clinvexa.main import main
    order = []
    monkeypatch.setattr('hermes_cli.env_loader.load_hermes_dotenv', lambda: order.append('credentials'))
    monkeypatch.setattr('uvicorn.run', lambda *a, **kw: order.append('server'))
    main()
    assert order == ['credentials', 'server']

def test_source_ids_preserve_quotes_and_reject_invented_ids():
    source = {'s0': '昨晚体温三十九度', 's1': '没有既往病史'}
    item = {'type':'field','key':'present_illness','value':'昨晚体温39℃','evidence_ids':['s0']}
    assert validated_item(item, ''.join(source.values()), source)['evidence'] == source['s0']
    assert validated_item({**item, 'evidence_ids':['invented']}, ''.join(source.values()), source) is None

def test_opening_question_waits_for_answer_without_false_model_failure(tmp_path, monkeypatch):
    service = ConsultationService(tmp_path, lambda _: {'success': True, 'transcript': '合成测试'})
    r = service.start(patient_id='synthetic',patient_name='',consent_confirmed=True)
    service._save(replace(r, transcript='今天哪里不舒服？'))
    monkeypatch.setattr('clinvexa.consultation_intelligence.stream_analysis', lambda _: iter([
        {'type':'utterance','role':'医生','text':'今天哪里不舒服？','evidence':'今天哪里不舒服？','inferred':True}]))
    events = list(service.analyze_stream(r.id))
    assert not any(event['type'] == 'error' for event in events)
    assert events[-1]['type'] == 'done'
    assert service.get(r.id).draft is None
