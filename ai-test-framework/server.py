import json
import os
import logging
import subprocess
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# --- CORS Middleware ---
# Allow the browser extension to communicate with this server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this to your extension's ID
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Pydantic Models for Data Validation ---
class Step(BaseModel):
    action: str
    selector: str | None = None
    value: str | None = None
    stepName: str | None = None
    key: str | None = None # Add the 'key' field to accept keyboard actions
    url: str | None = None

class ScriptData(BaseModel):
    name: str
    variables: dict
    steps: list[Step]

class RunTestsRequest(BaseModel):
    files: list[str]

# --- API Endpoints ---
@app.post("/save-script")
async def save_script(script_data: ScriptData):
    """
    Receives a complete script from the browser extension and saves it to a file.
    """
    logging.info("Received request to /save-script endpoint.")
    try:
        # Ensure the 'tests' directory exists relative to this script file.
        server_dir = os.path.dirname(__file__)
        tests_folder = os.path.join(server_dir, 'tests')
        logging.info(f"Server directory is: {os.path.abspath(server_dir)}")
        logging.info(f"Ensuring 'tests' folder exists at: {os.path.abspath(tests_folder)}")
        os.makedirs(tests_folder, exist_ok=True)

        # Sanitize the name for the filename
        filename = script_data.name.replace(" ", "_").lower() + ".json"
        filepath = os.path.join(tests_folder, filename)
        logging.info(f"Attempting to save script to: {os.path.abspath(filepath)}")

        with open(filepath, "w") as f:
            json.dump(script_data.dict(), f, indent=2)

        logging.info(f"✅ Script saved successfully to {os.path.abspath(filepath)}")
        return {"message": "Script saved successfully", "filepath": filepath}
    except Exception as e:
        logging.error(f"Error saving script: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/get-tests")
async def get_tests():
    """Returns a list of all .json test files in the tests directory."""
    logging.info("Received request to /get-tests endpoint.")
    try:
        server_dir = os.path.dirname(__file__)
        tests_folder = os.path.join(server_dir, 'tests')
        if not os.path.isdir(tests_folder):
            return {"files": []}
        
        files = [f for f in os.listdir(tests_folder) if f.endswith('.json')]
        logging.info(f"Found {len(files)} test files.")
        return {"files": files}
    except Exception as e:
        logging.error(f"Error getting test list: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/run-tests")
async def run_tests(request_data: RunTestsRequest):
    """Runs the selected test files using the Playwright runner."""
    files_to_run = request_data.files
    if not files_to_run:
        raise HTTPException(status_code=400, detail="No test files selected.")

    logging.info(f"Received request to run tests: {', '.join(files_to_run)}")
    
    server_dir = os.path.dirname(__file__)
    tests_folder = os.path.join(server_dir, 'tests')
    runner_script = os.path.join(server_dir, 'src', 'runner.js')
    all_logs = []

    try:
        for filename in files_to_run:
            # Security: Basic sanitization to prevent path traversal
            if '..' in filename or not filename.endswith('.json'):
                log_line = f"⚠️ Skipping invalid or malicious filename: {filename}"
                logging.warning(log_line)
                all_logs.append(log_line)
                continue
            
            test_file_path = os.path.join(tests_folder, filename)
            if not os.path.exists(test_file_path):
                log_line = f"⚠️ Test file not found, skipping: {test_file_path}"
                logging.warning(log_line)
                all_logs.append(log_line)
                continue

            logging.info(f"Executing: node {runner_script} {test_file_path}")
            # The `check=True` will raise CalledProcessError if the node script exits with a non-zero code (i.e., a test fails)
            result = subprocess.run(['node', runner_script, test_file_path], capture_output=True, text=True)
            all_logs.append(result.stdout)
            if result.stderr:
                all_logs.append(f"--- STDERR ---\n{result.stderr}")
            result.check_returncode() # Manually check and raise error if failed

        message = f"🎉 Successfully ran {len(files_to_run)} test(s)."
        logging.info(message)
        return {"success": True, "message": message, "logs": "\n".join(all_logs)}
    except subprocess.CalledProcessError as e:
        message = f"❌ A test failed during execution. See server console for details."
        all_logs.append(e.stdout)
        all_logs.append(f"--- STDERR ---\n{e.stderr}")
        logging.error(f"{message}\nRunner output:\n{''.join(all_logs)}")
        raise HTTPException(status_code=500, detail=message, headers={"X-Logs": "\n".join(all_logs)})
    except Exception as e:
        message = f"❌ An unexpected error occurred: {e}"
        logging.error(message, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e), headers={"X-Logs": "\n".join(all_logs)})

if __name__ == '__main__':
    import uvicorn
    tests_folder = os.path.join(os.path.dirname(__file__), 'tests')
    logging.info(f"Recorder server starting. Scripts will be saved to: {tests_folder}")
    uvicorn.run(app, host="0.0.0.0", port=5001)
