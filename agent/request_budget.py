"""Dynamic output-token budgeting for OpenAI-compatible custom endpoints.

Many vLLM-compatible servers interpret an omitted ``max_tokens`` as the full
model window.  A valid prompt then fails because ``input + max_tokens`` exceeds
that same window.  CLINVEXA resolves the real context length separately; this
module turns that value into a safe per-request output cap before the request is
sent.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Mapping, MutableMapping, Optional


OUTPUT_TOKEN_KEYS = ("max_output_tokens", "max_completion_tokens", "max_tokens")
DEFAULT_DYNAMIC_OUTPUT_TOKENS = 8_192


@dataclass(frozen=True)
class DynamicOutputBudget:
    context_length: int
    estimated_input_tokens: int
    safety_margin_tokens: int
    requested_output_tokens: int
    output_tokens: int
    was_implicit: bool


def _positive_int(value: object) -> Optional[int]:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def should_apply_dynamic_output_budget(*, provider: str, api_mode: str) -> bool:
    """Return whether this request uses an unknown OpenAI-compatible server."""
    normalized = (provider or "").strip().lower()
    return api_mode == "chat_completions" and (
        normalized == "custom" or normalized.startswith("custom:")
    )


def calculate_dynamic_output_budget(
    *,
    context_length: int,
    estimated_input_tokens: int,
    requested_output_tokens: Optional[int] = None,
    implicit_output_tokens: int = DEFAULT_DYNAMIC_OUTPUT_TOKENS,
) -> DynamicOutputBudget:
    """Calculate an output cap that always fits inside the detected window."""
    context = max(1, int(context_length))
    estimated_input = max(0, int(estimated_input_tokens))
    # Keep enough room for provider-side chat-template/tokenizer differences,
    # while avoiding an excessive penalty on the minimum 64K CLINVEXA window.
    safety_margin = max(256, min(1_024, context // 100))
    available = max(1, context - estimated_input - safety_margin)
    explicit = _positive_int(requested_output_tokens)
    requested = explicit if explicit is not None else max(1, int(implicit_output_tokens))
    return DynamicOutputBudget(
        context_length=context,
        estimated_input_tokens=estimated_input,
        safety_margin_tokens=safety_margin,
        requested_output_tokens=requested,
        output_tokens=max(1, min(requested, available)),
        was_implicit=explicit is None,
    )


def apply_dynamic_output_budget(
    api_kwargs: MutableMapping[str, object],
    *,
    context_length: int,
    estimated_input_tokens: int,
    max_tokens_param_fn: Callable[[int], Mapping[str, int]],
) -> DynamicOutputBudget:
    """Mutate final request kwargs to contain one safe output-token parameter."""
    requested = None
    for key in OUTPUT_TOKEN_KEYS:
        value = _positive_int(api_kwargs.get(key))
        if value is not None:
            requested = value
            break
    budget = calculate_dynamic_output_budget(
        context_length=context_length,
        estimated_input_tokens=estimated_input_tokens,
        requested_output_tokens=requested,
    )
    for key in OUTPUT_TOKEN_KEYS:
        api_kwargs.pop(key, None)
    api_kwargs.update(max_tokens_param_fn(budget.output_tokens))
    return budget
