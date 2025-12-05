document.addEventListener('DOMContentLoaded', () => {
    const recordButton = document.getElementById('recordButton');
    const stopButton = document.getElementById('stopButton');
    const fileNameInput = document.getElementById('fileName');
    const statusDisplay = document.getElementById('status');
    const refreshTestsButton = document.getElementById('refreshTestsButton');
    const testFilesList = document.getElementById('testFilesList');
    const playButton = document.getElementById('playButton');
    const playStatusDisplay = document.getElementById('playStatus');
    const playLogs = document.getElementById('playLogs');
    const addWaitButton = document.getElementById('addWaitButton');
    const waitInput = document.getElementById('waitInput');
    const assertVisibleButton = document.getElementById('assertVisibleButton');

    function initialize() {
        // Request initial recording status from background script
        chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
            updateUI(response.isRecording, response.fileName);
        });
        refreshTestList();
    }

    recordButton.addEventListener('click', () => {
        const fileName = fileNameInput.value.trim();
        if (!fileName) {
            statusDisplay.textContent = 'Error: Please enter a file name.';
            statusDisplay.style.color = 'red';
            return;
        }
        // Immediately disable the button for better UX
        recordButton.disabled = true;
        statusDisplay.textContent = 'Status: Starting...';
        statusDisplay.style.color = '#17a2b8';

        chrome.runtime.sendMessage({ action: 'startRecording', fileName: fileName });
    });

    stopButton.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'stopRecording' }, (response) => {
            if (response && response.saved) {
                statusDisplay.textContent = `Status: Saved to ${response.fileName}`;
                statusDisplay.style.color = '#007bff';
                refreshTestList(); // Refresh the list after saving a new test
            }
        });
    });

    // Listen for status updates from the background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'updateStatus') {
            updateUI(message.isRecording, message.fileName);
        } else if (message.action === 'updatePlayStatus') {
            playButton.disabled = false; // Re-enable play button after run
            playStatusDisplay.textContent = message.status || '';
            playStatusDisplay.style.color = message.error ? 'red' : '#007bff';
            playLogs.textContent = message.logs || ''; // Display the logs
        } else if (message.action === 'assertionAdded') {
            playStatusDisplay.textContent = message.status;
            playStatusDisplay.style.color = message.error ? 'red' : 'blue';
        }
    });

    addWaitButton.addEventListener('click', () => {
        const waitTime = waitInput.value;
        if (waitTime && parseInt(waitTime, 10) > 0) {
            chrome.runtime.sendMessage({ action: 'addWait', time: waitTime }, (response) => {
                statusDisplay.textContent = `Status: Added ${waitTime}ms wait.`;
                statusDisplay.style.color = '#17a2b8'; // Info color
            });
        }
    });

    assertVisibleButton.addEventListener('click', () => {
        statusDisplay.textContent = 'Pick an element to assert visibility...';
        statusDisplay.style.color = '#ffc107';
        // Tell content script to start picking
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'startPicking' });
        });
        window.close(); // Close the popup so the user can interact with the page
    });

    refreshTestsButton.addEventListener('click', refreshTestList);

    playButton.addEventListener('click', () => {
        const selectedFiles = Array.from(testFilesList.selectedOptions).map(option => option.value);
        if (selectedFiles.length === 0) {
            playStatusDisplay.textContent = 'Please select at least one test to play.';
            playStatusDisplay.style.color = 'red';
            return;
        }
        playStatusDisplay.textContent = `Playing ${selectedFiles.length} test(s)...`;
        playStatusDisplay.style.color = 'blue';
        playButton.disabled = true;
        playLogs.textContent = ''; // Clear previous logs
        chrome.runtime.sendMessage({ action: 'playTests', fileNames: selectedFiles }, (response) => {
            playButton.disabled = false;
            // Status update will be handled by 'updatePlayStatus' messages
        });
    });

    function refreshTestList() {
        chrome.runtime.sendMessage({ action: 'getTestFiles' }, (response) => {
            testFilesList.innerHTML = ''; // Clear existing options
            if (response && response.files) {
                response.files.forEach(file => {
                    const option = document.createElement('option');
                    option.value = file;
                    option.textContent = file;
                    testFilesList.appendChild(option);
                });
            }
        });
    }

    function updateUI(isRecording, fileName = '') {
        recordButton.disabled = isRecording;
        stopButton.disabled = !isRecording;
        fileNameInput.disabled = isRecording;
        addWaitButton.disabled = !isRecording; // Can only add wait while recording
        assertVisibleButton.disabled = !isRecording; // Can only assert while recording
        fileNameInput.value = isRecording ? fileName : '';

        statusDisplay.textContent = `Status: ${isRecording ? 'Recording...' : 'Idle'}`;
        statusDisplay.style.color = isRecording ? '#28a745' : '#6c757d';
    }

    initialize();
});