"""Behavior tests for proactive custom-endpoint output budgeting."""

from agent.request_budget import (
    apply_dynamic_output_budget,
    calculate_dynamic_output_budget,
    should_apply_dynamic_output_budget,
)


def test_custom_chat_completions_is_budgeted_only_on_custom_wire():
    assert should_apply_dynamic_output_budget(provider="custom", api_mode="chat_completions")
    assert should_apply_dynamic_output_budget(provider="custom:n260", api_mode="chat_completions")
    assert not should_apply_dynamic_output_budget(provider="openrouter", api_mode="chat_completions")
    assert not should_apply_dynamic_output_budget(provider="custom", api_mode="codex_responses")


def test_implicit_output_uses_stable_8k_cap_on_64k_model():
    budget = calculate_dynamic_output_budget(
        context_length=65_536,
        estimated_input_tokens=23_500,
    )
    assert budget.was_implicit is True
    assert budget.output_tokens == 8_192
    assert budget.estimated_input_tokens + budget.safety_margin_tokens + budget.output_tokens < 65_536


def test_explicit_small_cap_is_preserved():
    budget = calculate_dynamic_output_budget(
        context_length=65_536,
        estimated_input_tokens=23_500,
        requested_output_tokens=2_048,
    )
    assert budget.was_implicit is False
    assert budget.output_tokens == 2_048


def test_explicit_oversized_cap_is_clamped_to_remaining_window():
    budget = calculate_dynamic_output_budget(
        context_length=65_536,
        estimated_input_tokens=60_000,
        requested_output_tokens=65_536,
    )
    assert budget.output_tokens == 4_881
    assert (
        budget.estimated_input_tokens
        + budget.safety_margin_tokens
        + budget.output_tokens
        == budget.context_length
    )


def test_final_request_contains_exactly_one_provider_appropriate_cap():
    kwargs = {
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 65_536,
        "max_completion_tokens": 65_536,
    }
    budget = apply_dynamic_output_budget(
        kwargs,
        context_length=65_536,
        estimated_input_tokens=63_000,
        max_tokens_param_fn=lambda value: {"max_completion_tokens": value},
    )
    assert budget.output_tokens == 1_881
    assert kwargs["max_completion_tokens"] == 1_881
    assert "max_tokens" not in kwargs
    assert "max_output_tokens" not in kwargs
