from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import os
import sys
from importlib.metadata import version
import time
from typing import TYPE_CHECKING, Any

from agent_runner import run_agent_task
import allure
import pytest
from browser_use import (
    Agent,
    BrowserProfile,
    BrowserSession,
    ChatGoogle,
)
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, Error as PlaywrightError

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator


# Load environment variables from .env file
load_dotenv()
logger = logging.getLogger(__name__)

# Define the project root as the directory containing this conftest.py file
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

# Add the parent directory of 'agentitest' to sys.path to resolve 'browser_use'
FLEXI_ROOT = os.path.dirname(PROJECT_ROOT)
if FLEXI_ROOT not in sys.path:
    sys.path.insert(0, FLEXI_ROOT)


LLM_TEMPERATURE = 0.2

# --- Fixtures for Setup and Configuration ---


@pytest.fixture(scope="session")
def browser_version_info(browser_profile: BrowserProfile) -> dict[str, str]:
    """Fixture to get Playwright and browser version info."""
    try:
        with sync_playwright() as p:
            playwright_version: str = version("playwright")
            browser_type_name: str = (
                browser_profile.channel if browser_profile.channel else "chromium"
            )
            browser = p[browser_type_name].launch()
            browser_version: str = browser.version
            browser.close()
            return {
                "playwright_version": playwright_version,
                "browser_version": f"{browser_type_name} {browser_version}",
            }
    except Exception as e:
        logger.warning(f"Could not determine Playwright/browser version: {e}")
        return {
            "playwright_version": "N/A",
            "browser_version": "N/A",
        }


@pytest.fixture(scope="session", autouse=True)
def allure_environment(
    request: pytest.FixtureRequest,
    browser_version_info: dict[str, str],
) -> None:
    """Fixture to write environment details to a properties file for reporting.
    This runs once per session and is automatically used.
    By default, this creates `environment.properties` for Allure.
    """
    allure_dir: str | None = request.config.getoption("--alluredir")
    if not allure_dir:
        return

    ENVIRONMENT_PROPERTIES_FILENAME: str = "environment.properties"
    properties_file: str = os.path.join(allure_dir, ENVIRONMENT_PROPERTIES_FILENAME)

    try:
        os.makedirs(allure_dir, exist_ok=True)
    except OSError:
        return

    env_props: dict[str, str] = {
        "OS": os.name,
        "Python": f"{sys.version_info.major}.{sys.version_info.minor}",
        "Playwright": browser_version_info["playwright_version"],
        "Browser": browser_version_info["browser_version"],
        "Run URL": os.getenv("GITHUB_SERVER_URL", "")
        + "/"
        + os.getenv("GITHUB_REPOSITORY", "")
        + "/actions/runs/"
        + os.getenv("GITHUB_RUN_ID", ""),
    }
    with open(properties_file, "w") as f:
        f.writelines(f"{key}={value}\n" for key, value in env_props.items())


@pytest.fixture
async def llm() -> ChatGoogle:
    """Function-scoped fixture to initialize the language model."""
    DEFAULT_MODEL: str = "gemini-2.5-pro"
    model_name: str = os.getenv("GEMINI_MODEL", DEFAULT_MODEL)
    # Configure retry mechanism for API calls to handle transient errors like 503
    retry_config = {
        "max_retries": 5,  # Maximum number of retries
        "initial_delay": 2,  # Initial delay in seconds
        "backoff_factor": 2,  # Multiplier for delay (e.g., 2s, 4s, 8s, ...)
    }
    return ChatGoogle(
        model=model_name,
        temperature=LLM_TEMPERATURE,
        api_key=os.getenv("GEMINI_API_KEY"),
        retry_config=retry_config,
    )


@pytest.fixture(scope="session")
def browser_profile() -> BrowserProfile:
    """Session-scoped fixture for browser profile configuration."""
    headless_mode: bool = os.getenv("HEADLESS", "True").lower() in ("true", "1", "t")
    return BrowserProfile(headless=headless_mode, keep_alive=True)


@pytest.fixture
async def browser_session(
    browser_profile: BrowserProfile,
) -> AsyncGenerator[BrowserSession, None]:
    """Function-scoped fixture to manage the browser session's lifecycle."""
    session: BrowserSession = BrowserSession(browser_profile=browser_profile)
    await session.start()
    try:
        yield session
    finally:
        # Ensure proper cleanup of any pending tasks
        await asyncio.sleep(0.1)  # Allow pending operations to complete
        for task in asyncio.all_tasks():
            if not task.done() and 'aiohttp' in str(task):
                task.cancel()
        await session.stop()
        # Force close any remaining connections
        if hasattr(session, '_client_session'):
            await session._client_session.close()


# --- Allure Hook for Step-by-Step Reporting ---


async def record_step(agent: Agent) -> None:
    """Hook function that captures and records agent activity at each step."""
    history = agent.history

    last_action: dict[str, Any] = (
        history.model_actions()[-1] if history.model_actions() else {}
    )
    action_name: str = next(iter(last_action)) if last_action else "No action"
    action_params: dict[str, Any] = last_action.get(action_name, {})
    step_title: str = f"Action: {action_name}"
    param_str: str = ", ".join(f"{k}={v}" for k, v in action_params.items())
    if param_str:
        step_title += f"({param_str})"

    with allure.step(step_title):
        thoughts = history.model_thoughts()
        if thoughts:
            allure.attach(
                str(thoughts[-1]),
                name="Agent Thoughts",
                attachment_type=allure.attachment_type.TEXT,
            )

        url: str | None = history.urls()[-1] if history.urls() else "N/A"
        allure.attach(url, name="URL", attachment_type=allure.attachment_type.TEXT)

        last_history_item = history.history[-1] if history.history else None
        if last_history_item and last_history_item.metadata:
            duration: float = last_history_item.metadata.duration_seconds
            allure.attach(
                f"{duration:.2f}s",
                name="Step Duration",
                attachment_type=allure.attachment_type.TEXT,
            )

        # Attach Screenshot
        try:
            screenshot_b64 = await agent.browser_session.take_screenshot()
            if screenshot_b64:
                # Validate base64 string before decoding
                if isinstance(screenshot_b64, bytes):
                    # If it's already bytes, use it directly
                    screenshot_bytes: bytes | None = screenshot_b64
                elif is_valid_base64(screenshot_b64):
                    # If it's a valid base64 string, decode it
                    screenshot_bytes = base64.b64decode(screenshot_b64)
                else:
                    logger.warning("Invalid base64 padding in screenshot data")
                    screenshot_bytes = None

                if screenshot_bytes:
                    allure.attach(
                        screenshot_bytes,
                        name="Screenshot",
                        attachment_type=allure.attachment_type.PNG,
                    )
                    # Save screenshot to a local file
                    try:
                        screenshot_dir = os.path.join(PROJECT_ROOT, "screenshots")
                        os.makedirs(screenshot_dir, exist_ok=True)
                        # Generate a unique filename with a timestamp
                        timestamp = int(time.time() * 1000)
                        step_num = len(history.model_actions())
                        filename = f"step_{step_num}_{timestamp}.png"
                        filepath = os.path.join(screenshot_dir, filename)
                        with open(filepath, "wb") as f:
                            f.write(screenshot_bytes)
                    except Exception as e:
                        logger.warning(f"Failed to save screenshot to file: {e}")
        except PlaywrightError as e:
            # This can happen if the page is closed before the screenshot is taken,
            # which is common on the final step of an agent's task.
            if "No target with given id found" in str(e):
                logger.warning("Could not take screenshot: Page was already closed.")
        except Exception as e:
            logger.warning(f"Failed to take or attach screenshot: {e}")


# --- Utility Function for Base64 Validation ---


def is_valid_base64(s: Any) -> bool:
    """Check if a string or bytes is a valid base64 encoded data."""
    try:
        # If it's already bytes, try to decode it directly
        if isinstance(s, bytes):
            base64.b64decode(s, validate=True)
            return True

        # If it's a string, check if length is multiple of 4 and try to decode
        if isinstance(s, str):
            # Check if length is multiple of 4
            if len(s) % 4 != 0:
                return False
            base64.b64decode(s, validate=True)
            return True

        return False
    except binascii.Error:
        return False
