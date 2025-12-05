let isRecording = false;
let recordedActions = [];
let currentTabId = null;
let currentTestFileName = '';
const SERVER_URL = 'http://localhost:5001';

// Function to send status updates to the popup
function sendStatusToPopup() {
    chrome.runtime.sendMessage({ action: 'updateStatus', isRecording: isRecording, fileName: currentTestFileName });
}

function sendPlayStatusToPopup(status, logs = '', error = false) {
    chrome.runtime.sendMessage({ action: 'updatePlayStatus', status, logs, error });
}

// Listener for messages from popup.js or content_script.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startRecording') {
        if (!isRecording && message.fileName) {
            isRecording = true;
            recordedActions = [];
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                currentTabId = tabs[0].id;
                // Inject content script if not already there and send start message
                chrome.scripting.executeScript({
                    target: { tabId: currentTabId },
                    files: ['content_script.js']
                }, () => {
                    chrome.tabs.sendMessage(currentTabId, { action: 'startRecording' });
                });
            });
            currentTestFileName = message.fileName;
            console.log('Recording started.');
            sendStatusToPopup();
        }
    } else if (message.action === 'stopRecording') {
        if (isRecording) {
            isRecording = false;
            if (currentTabId) {
                chrome.tabs.sendMessage(currentTabId, { action: 'stopRecording' });
            }
            const fileNameToSave = currentTestFileName; // Capture before clearing
            console.log(`Recording stopped. Saving to ${fileNameToSave}. Actions:`, recordedActions);
            saveScript(recordedActions, fileNameToSave);
            currentTestFileName = ''; // Clear for the next session
            sendStatusToPopup();
            sendResponse({ saved: true, fileName: fileNameToSave });
        }
    } else if (message.action === 'recordAction' && isRecording && sender.tab.id === currentTabId) {
        recordedActions.push(message.data);
        console.log('Recorded action:', message.data);
    } else if (message.action === 'addWait' && isRecording) {
        const waitStep = {
            type: 'wait',
            value: message.time,
            stepName: `Wait for ${message.time}ms`
        };
        recordedActions.push(waitStep);
        console.log('Recorded action:', waitStep);
        sendResponse({ success: true });

    } else if (message.action === 'getStatus') {
        sendResponse({ isRecording: isRecording, fileName: currentTestFileName });
    } else if (message.action === 'getTestFiles') {
        fetch(`${SERVER_URL}/get-tests`)
            .then(response => response.json())
            .then(data => sendResponse({ files: data.files }))
            .catch(error => {
                console.error('Error fetching test files:', error);
                sendResponse({ files: [] });
            });
        return true; // Indicates async response
    } else if (message.action === 'playTests') {
        fetch(`${SERVER_URL}/run-tests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: message.fileNames })
        })
        .then(response => response.json())
        .then(data => {
            sendPlayStatusToPopup(data.message, data.logs || '');
            sendResponse({ success: true });
        })
        .catch(async (error) => {
            console.error('Error playing tests:', error);
            // Try to parse error response from FastAPI
            let logs = 'Error: Could not connect to server to run tests.';
            try {
                const errorJson = await error.response.json();
                logs = errorJson.detail; // FastAPI puts message in 'detail'
            } catch (e) { /* Ignore if parsing fails */ }
            sendPlayStatusToPopup('A test run failed. See logs.', logs, true);
            sendResponse({ success: result.success });
        });
        return true; // Indicates async response
    }
    return true; // Indicate async response for stopRecording
});

// Function to save the recorded script to a local server
async function saveScript(actions, scriptName) {
    if (actions.length === 0) {
        console.warn("No actions recorded to save.");
        return;
    }

    // Construct the JSON structure based on your example
    const scriptData = {
        name: scriptName.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), // "Recorded Test 12345"
        variables: {}, // For now, no variables are captured by the extension
        steps: actions.map(action => {
            // Map content script actions to your desired JSON format
            const step = {
                action: action.type,
                selector: action.selector,
                url: action.url,
                stepName: action.stepName || `${action.type} on ${action.selector || action.url}`
            };
            if (action.value !== undefined) {
                step.value = action.value;
            }
            if (action.key !== undefined) {
                step.key = action.key;
            }
            if (action.assertion !== undefined) {
                step.action = 'expect'; // Override action type
                step.assertion = action.assertion;
            }

            // Ensure 'goto' actions use the 'value' field for the URL
            if (step.action === 'goto') {
                step.value = step.url;
            }
            return step;
        })
    };

    try {
        // IMPORTANT: This assumes a local server is running to receive the script.
        const response = await fetch(`${SERVER_URL}/save-script`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(scriptData)
        });
        
        const result = await response.json();
        if (response.ok) {
            console.log('✅ Script saved successfully by local server!', result);
        } else {
            console.error('❌ Failed to save script. Server responded with an error.', {
                status: response.status,
                statusText: response.statusText,
                body: result
            });
        }
    } catch (error) {
        console.error('Error sending script to local server:', error);
        console.warn(`Make sure your local server is running on ${SERVER_URL}`);
    }
}