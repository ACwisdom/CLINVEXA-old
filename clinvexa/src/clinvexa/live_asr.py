"""Local sentence ASR with punctuation and explicit dialect routing."""
from __future__ import annotations
import os
import importlib.util
import logging
import threading
import time
import wave
from pathlib import Path
MODEL_NAME = "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09"
QWEN_NAME = "sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25"
LEGACY_NAME = "sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23"
_models: dict = {}
_lock = threading.RLock()
_engine_locks = {name: threading.RLock() for name in (MODEL_NAME, QWEN_NAME, LEGACY_NAME)}
_error: str | None = None
_errors: dict[str, str] = {}
_loading: set[str] = set()
_required = {
    MODEL_NAME: ('model.int8.onnx', 'tokens.txt'),
    QWEN_NAME: ('conv_frontend.onnx', 'encoder.int8.onnx', 'decoder.int8.onnx', 'tokenizer/vocab.json', 'tokenizer/merges.txt'),
    LEGACY_NAME: ('tokens.txt', 'encoder-epoch-99-avg-1.int8.onnx', 'decoder-epoch-99-avg-1.onnx', 'joiner-epoch-99-avg-1.int8.onnx'),
}

def model_directory(name: str = MODEL_NAME) -> Path | None:
    home = os.getenv("HERMES_HOME") or os.getenv("CLINVEXA_RUNTIME_HOME")
    if not home: return None
    path = Path(home) / "models" / "clinvexa-live" / name
    return path if all((path / file).is_file() and (path / file).stat().st_size > 0 for file in _required[name]) else None

def selected_model(dialect: str = 'auto') -> str:
    return QWEN_NAME if dialect in {'shanghai', 'beijing'} or (dialect in {'auto', 'zh'} and model_directory(QWEN_NAME)) else (MODEL_NAME if model_directory() else LEGACY_NAME)

def status(dialect: str = 'auto') -> dict:
    selected = selected_model(dialect)
    qwen = model_directory(QWEN_NAME) is not None
    dependencies = importlib.util.find_spec('sherpa_onnx') is not None and importlib.util.find_spec('numpy') is not None
    installed = model_directory(selected) is not None and dependencies
    error = ('本地语音识别运行库缺失，请修复或重新安装完整安装包' if not dependencies else
             '本地方言识别模型缺失或不完整，请修复或重新安装完整安装包' if not model_directory(selected) else _errors.get(selected))
    return {"installed": installed, "ready": installed and selected in _models, "loading": selected in _loading,
            "provider": "sherpa-onnx", "model": selected, "error": error,
            "dialects": ["auto", "zh", "yue", "beijing"] + (["shanghai"] if qwen else []),
            "dialect_model_installed": qwen, "dialect_ready": QWEN_NAME in _models, "processing": "local"}

def warmup(dialect: str = "auto") -> dict:
    global _error
    # Prefer the installed punctuation-capable model for general consultation;
    # retain the dedicated Cantonese route and a lightweight installation fallback.
    name = selected_model(dialect)
    directory = model_directory(name)
    if directory is None:
        return status(dialect)
    with _engine_locks[name]:
        if name not in _models:
            _loading.add(name)
            try:
                import sherpa_onnx
                if name == MODEL_NAME:
                    model = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                        model=str(directory / "model.int8.onnx"), tokens=str(directory / "tokens.txt"),
                        num_threads=2, language="auto", use_itn=True)
                elif name == QWEN_NAME:
                    model = sherpa_onnx.OfflineRecognizer.from_qwen3_asr(
                        conv_frontend=str(directory / "conv_frontend.onnx"),
                        encoder=str(directory / "encoder.int8.onnx"), decoder=str(directory / "decoder.int8.onnx"),
                        tokenizer=str(directory / "tokenizer"), num_threads=2, max_new_tokens=128)
                else:
                    model = sherpa_onnx.OnlineRecognizer.from_transducer(
                        tokens=str(directory / "tokens.txt"), encoder=str(directory / "encoder-epoch-99-avg-1.int8.onnx"),
                        decoder=str(directory / "decoder-epoch-99-avg-1.onnx"), joiner=str(directory / "joiner-epoch-99-avg-1.int8.onnx"),
                        num_threads=2, sample_rate=16000, feature_dim=80, provider="cpu")
                _models[name] = model
                _error = None
                _errors.pop(name, None)
            except Exception as error:
                _error = f"本地语音模型未就绪：{type(error).__name__}"
                _errors[name] = _error
                logging.getLogger(__name__).exception('Local ASR initialization failed for %s', name)
            finally:
                _loading.discard(name)
    return status(dialect)

def transcribe(path: str, dialect: str = "auto") -> dict:
    try:
        return _transcribe(path, dialect)
    except Exception as error:
        logging.getLogger(__name__).exception('Local audio decode failed (%s)', type(error).__name__)
        return {'success': False, 'transcript': '', 'error': f'本地音频解码失败（{type(error).__name__}），原音频已保留，可重试'}


def _transcribe(path: str, dialect: str = "auto") -> dict:
    started = time.monotonic()
    readiness = warmup(dialect)
    if not readiness["ready"]:
        return {"success": False, "transcript": "", "error": readiness["error"]}
    import numpy as np
    with wave.open(path, "rb") as audio:
        rate, count = audio.getframerate(), audio.getnframes()
        if audio.getnchannels() != 1 or audio.getsampwidth() != 2 or rate <= 0 or count / rate > 12:
            return {"success": False, "transcript": "", "error": "需要不超过12秒的单声道 PCM16 WAV"}
        samples = np.frombuffer(audio.readframes(count), dtype=np.int16).astype(np.float32) / 32768
    if not len(samples) or float(np.sqrt(np.mean(samples * samples))) < 0.001:
        return {"success": True, "transcript": "", "provider": readiness["model"]}
    with _engine_locks[readiness["model"]]:
        name = readiness["model"]
        model = _models[name]
        stream = model.create_stream()
        stream.accept_waveform(rate, samples)
        if name == LEGACY_NAME:
            stream.accept_waveform(rate, np.zeros(int(rate * 0.8), dtype=np.float32))
            stream.input_finished()
            while model.is_ready(stream): model.decode_stream(stream)
            text = model.get_result(stream)
        else:
            model.decode_stream(stream)
            text = stream.result.text
    return {"success": True, "transcript": text, "provider": name,
            "language": str(getattr(stream.result, "lang", "")) if name != LEGACY_NAME else "",
            "latency_ms": round((time.monotonic() - started) * 1000)}
