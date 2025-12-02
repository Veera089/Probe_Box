import asyncio
import logging
import os
from agent_runner import run_agent_on_task
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables from .env file
load_dotenv()

app = FastAPI()

# Set up CORS middleware to allow requests from the Chrome extension.
# The browser sends a preflight OPTIONS request to check if the server allows
# cross-origin requests before sending the actual POST request.
app.add_middleware(
    CORSMiddleware,
    # For local development, allowing all origins is convenient.
    # For production, you would restrict this to specific domains.
    allow_origins=["*"],
    allow_credentials=True,
    # Allow all HTTP methods (GET, POST, etc.).
    allow_methods=["*"],
    # Allow all headers.
    allow_headers=["*"],
)


class TestRequest(BaseModel):
    prompt: str
    url: str


@app.post("/run-test")
async def run_test_endpoint(request: TestRequest):
    """
    Endpoint to receive a test prompt and URL, run the agent,
    and return the result.
    """
    logger.info(f"Received test request for URL: {request.url} with prompt: '{request.prompt}'")
    try:
        # Run the agent task and get the result
        # The user's prompt will contain the target URL for the main task.
        # The current page URL is used for the initial login.
        result = await run_agent_on_task(task_instruction=request.prompt, url=request.url, login_url=request.url)
        return {"status": "success", "result": result}
    except Exception as e:
        logger.error(f"An error occurred during agent execution: {e}", exc_info=True)
        # In case of an exception, return an error status
        return {"status": "error", "result": str(e)}