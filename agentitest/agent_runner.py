import asyncio
import os
import logging
from typing import Any, Optional, Dict, List
import json # Added for script generation
from browser_use import (
    Agent,
    BrowserProfile,
    BrowserSession,
    ChatGoogle,
)

logger = logging.getLogger(__name__)
LLM_TEMPERATURE = 0.2

def extract_done_text_and_status(final_step):
    model_output = getattr(final_step, "model_output", None)
    if not model_output or not getattr(model_output, "action", None):
        return None, None

    first_action = model_output.action[0]

    done = None
    # Case 1: ActionModel(root=DoneActionModel(done=DoneAction(...)))
    if hasattr(first_action, "root") and hasattr(first_action.root, "done"):
        done = first_action.root.done
    # Case 2: DoneActionModel(done=DoneAction(...))
    elif hasattr(first_action, "done"):
        done = first_action.done

    if not done:
        return None, None

    text = getattr(done, "text", None)
    success = getattr(done, "success", None)
    return text, success


async def run_agent_task(full_task: str, llm: ChatGoogle, browser_session: BrowserSession, on_step_end=None) -> str:
    #Initializes and runs the browser agent for a given task.
    logger.info(f"Running task: {full_task}")
    agent = Agent(task=full_task, llm=llm, browser_session=browser_session)

    # Run the agent and get the history of steps.
    history = await asyncio.wait_for(agent.run(on_step_end=on_step_end), timeout=180)

    # The 'history' is an iterable AgentHistoryList. We need to get the last step
    # to determine the final outcome of the task.
    # The last item in the history is the final step object.
    final_step = history.history[-1] if history.history else None

    result_text, success = extract_done_text_and_status(final_step)


    if not result_text:
        result_text = "Agent completed, but no textual result was available."

    # Wrap the result in HTML with an icon and a class for color styling based on the success flag.
    if success is True:
        icon = "👍"
        ui_text = f'{icon}<p class="success-text">{result_text}</p>'
    elif success is False:
        icon = "❌"
        ui_text = f'{icon}<p class="error-text">{result_text}</p>'
    else:
        ui_text = f'<p>{result_text}</p>'  # Default styling if success is unknown

    logger.info("Agent task completed. Final UI text: %r", ui_text)
    return ui_text

async def run_agent_on_task(task_instruction: str, url: str, login_url: str) -> str:
    """
    Initializes a browser, runs an agent task, and returns the result.
    This function is designed to be called from outside the pytest framework.
    """
    # Configure browser profile
    headless_mode = os.getenv("HEADLESS", "False").lower() in ("true", "1", "t")
    browser_profile = BrowserProfile(headless=headless_mode, keep_alive=False)

    # Initialize the language model
    llm = ChatGoogle(
        model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        temperature=LLM_TEMPERATURE,
        api_key=os.getenv("GEMINI_API_KEY"),
    )

    # Start a new browser session
    session = BrowserSession(browser_profile=browser_profile)
    await session.start()

    try:
        username = os.getenv("USERNAME", "ram+teacher+11@ck12.org")
        password = os.getenv("PASSWORD", "test123456")
        
        agent_rules = """
        You are controlling a web browser to sign-in or log in and perform a task.
        
        Critical rules for Assignment:
        - Any pop-up appears in-between which is not part of the main task flow, close it by clicking 'X' or 'Close' button.
        - If a due date is required, click the due date field, open the calendar, select any valid future date (2–7 days from today), confirm it so the field is filled, and only then submit the form."
        """
        
        login_steps = f"""
        Follow these steps to log in:

        1. Navigate to {login_url}.
        """

        if "/flexi/" in login_url:
            login_steps += """
        2. If a popup appears with a 'Next' button, repeatedly click 'Next' until a 'Got it' button appears, then click 'Got it'.
        3. After dismissing the popup, continue with the sign-in steps.
        """
        
        login_part = (
            f"Go to {login_url}, open the sign-in form, enter username {username} and password {password}, "
            "then press Enter in the password field to submit the form. "
        )

        main_task_part = (
            agent_rules
            + login_steps
            + "\n"
            + login_part
            + "\n\nNow perform the following task on that page:\n"
            + task_instruction
            + "\nDo not log out during this task."
        )


        logger.info("--- Starting Combined Agent Task ---")
        result_text = await run_agent_task(main_task_part, llm, session)
        return result_text or "Task completed, but no final text was returned."
    finally:
        await session.stop()
