from __future__ import annotations

from agent_runner import run_agent_task
from conftest import record_step
from browser_use import BrowserSession, ChatGoogle


class BaseAgentTest:
    """Base class for agent-based tests to reduce boilerplate."""

    BASE_URL = "https://discuss.google.dev/"

    async def validate_task(
        self,
        llm: ChatGoogle,
        browser_session: BrowserSession,
        task_instruction: str,
        expected_substring: str,
        ignore_case: bool = False,
    ) -> str:
        """Runs a task with the agent, prepends the BASE_URL, and performs common assertions."""
        full_task: str = f"Go to {self.BASE_URL}, then {task_instruction}"
        result_text: str = await run_agent_task(
            full_task, llm, browser_session, on_step_end=record_step
        )
        assert result_text is not None and result_text.strip() != "", (
            "Agent did not return a result."
        )

        if expected_substring:
            result_to_check = result_text.lower() if ignore_case else result_text
            # Check for the specific expected substring OR common confirmation phrases
            possible_confirmations = {
                expected_substring.lower() if ignore_case else expected_substring,
                "visible",
                "found",
                "confirmed",
                "i see it",
            }
            assert any(
                phrase in result_to_check for phrase in possible_confirmations
            ), f"Expected a confirmation like '{expected_substring}', but got: '{result_text}'"

        return result_text