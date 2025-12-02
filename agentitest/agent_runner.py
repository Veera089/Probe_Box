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

    """
    # Check if the agent's task was successful by inspecting the final status.
    if not final_step or final_step.status != "completed":
        status = final_step.status if final_step else "unknown"
        thought = final_step.thought if final_step else "No final thought available."
        raise RuntimeError(f"Agent task failed with status '{status}'. Final thoughts: {thought}")
    
    return final_step.model_output.action[0].root.done.text
    """
"""
def _convert_agent_action_to_script_step(agent_action: Any) -> Optional[Dict[str, Any]]:
    
    #Converts an agent's ActionModel output to the structured script step format.
    #This function maps the internal `browser_use` action models to your desired JSON format.
    
    if not agent_action:
        return None

    # The agent_action is typically a list containing one ActionModel instance.
    # We need to extract the actual action from its 'root' attribute.
    # This assumes the structure of browser_use.actions.ActionModel
    action_root = getattr(agent_action[0], "root", agent_action[0])
    print(f"Converting agent action root: {action_root}")
    if hasattr(action_root, "navigate"):
        nav_action = action_root.navigate
        return {"action": "goto", "url": nav_action.url}
    elif hasattr(action_root, "click"):
        click_action = action_root.click
        return {"action": "click", "selector": click_action.selector}
    elif hasattr(action_root, "type"):
        type_action = action_root.type
        return {"action": "type", "selector": type_action.selector, "value": type_action.text}
    elif hasattr(action_root, "assert_text_visible"):
        assert_action = action_root.assert_text_visible
        # Map to 'assert_visible' with a text selector
        return {"action": "assert_visible", "selector": f"text={assert_action.text}"}
    elif hasattr(action_root, "assert_url_contains"):
        assert_action = action_root.assert_url_contains
        # This is a useful assertion, but not directly in your sample.
        # If you want to include it, the ScriptRunner would need to handle 'assert_url_contains'.
        # For now, we'll map it to a generic assert_visible if possible, or skip.
        logger.warning(f"Agent generated 'assert_url_contains' which is not directly in sample script format. Skipping or converting to generic assert.")
        return None # Or convert to a generic assert if applicable
    elif hasattr(action_root, "done"):
        done_action = action_root.done
        # 'done' is a terminal action for the agent.
        # If it contains a text, we can convert it to an assert_visible for the script.
        if done_action.text:
            logger.info(f"Converting 'done' action with text '{done_action.text}' to assert_visible.")
            return {"action": "assert_visible", "selector": f"text={done_action.text}"}
        return None # Otherwise, 'done' doesn't translate to a script step
    # Add mappings for other potential actions if the agent supports them
    # These would typically come from custom tools provided to the LLM.
    # For example, if the agent can output a 'press' action:
    # elif hasattr(action_root, "press"):
    #     press_action = action_root.press
    #     return {"action": "press", "selector": press_action.selector, "key": press_action.key}
    # elif hasattr(action_root, "select"):
    #     select_action = action_root.select
    #     return {"action": "select", "selector": select_action.selector, "value": select_action.value}
    # elif hasattr(action_root, "pick_date"):
    #     pick_date_action = action_root.pick_date
    #     return {"action": "pick_date", "strategy": pick_date_action.strategy}

    logger.warning(f"Unsupported agent action type for script generation: {action_root}")
    return None


async def generate_script_from_agent_task(
    full_task: str,
    llm: ChatGoogle,
    browser_session: BrowserSession,
    script_name: str = "Generated Script",
    variables: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    
    #Runs the browser agent in a 'recording' mode to generate a structured JSON script.
    #The agent still interacts with the browser to make decisions, but its actions
    #are captured and converted into a script format instead of just executing.
    
    logger.info(f"Generating script for task: {full_task}")
    agent = Agent(task=full_task, llm=llm, browser_session=browser_session)

    generated_steps: List[Dict[str, Any]] = []

    async def record_agent_step(current_agent: Agent) -> None:
        last_model_output = current_agent.history.model_output_history[-1] if current_agent.history.model_output_history else None
        if last_model_output and last_model_output.action:
            script_step = _convert_agent_action_to_script_step(last_model_output.action)
            if script_step:
                generated_steps.append(script_step)

    await asyncio.wait_for(agent.run(on_step_end=record_agent_step), timeout=180)

    script = {
        "name": script_name,
        "variables": variables if variables is not None else {},
        "steps": generated_steps,
    }

    logger.info(f"Script generation completed for task: {full_task}")
    return script
"""
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
