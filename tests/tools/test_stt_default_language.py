"""CLINVEXA Simplified-Chinese STT language contract."""

from hermes_cli.config import DEFAULT_CONFIG
from tools.transcription_tools import _resolve_stt_language


class TestDefaultSttLanguage:
    def test_default_config_pins_mandarin(self):
        assert DEFAULT_CONFIG["stt"]["language"] == "zh"

    def test_default_local_backend_uses_medium_multilingual_model(self):
        assert DEFAULT_CONFIG["stt"]["local"]["model"] == "medium"
        assert DEFAULT_CONFIG["stt"]["local"]["language"] == "zh"


    def test_per_provider_still_wins_over_default(self, monkeypatch):
        monkeypatch.delenv("HERMES_LOCAL_STT_LANGUAGE", raising=False)
        stt = dict(DEFAULT_CONFIG["stt"])
        stt["groq"] = {"language": "he"}
        assert _resolve_stt_language("groq", stt) == "he"
