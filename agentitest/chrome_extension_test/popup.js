document.addEventListener('DOMContentLoaded', () => {
  const inputBox = document.getElementById('inputBox');
  const submitBtn = document.getElementById('submitBtn');
  const resultMsg = document.getElementById('resultMsg');
  const micBtn = document.getElementById('micBtn');
  const clearBtn = document.getElementById('clearBtn');

  let isListening = false;
  let recognition;

  // Helper function to append messages to the result area
  const appendMessage = (message, className = '') => {
    const wrapper = document.createElement('div');
    // Check if the message is HTML or plain text
    if (message.startsWith('<')) {
        wrapper.innerHTML = message;
    } else {
        // For plain text, wrap it in a <p> tag and add an icon if it's an error
        const isError = className.includes('error');
        wrapper.innerHTML = `${isError ? '<span class="cross-circle"></span>' : ''}<p class="${isError ? 'error-text' : ''}">${message}</p>`;
    }
    wrapper.className = `report-item ${className}`; // Apply report-item class and custom class
    resultMsg.appendChild(wrapper);
    resultMsg.scrollTop = resultMsg.scrollHeight; // Scroll to bottom
  };

  // === Text Persistence and Clear Button Logic ===

  // Load saved text when the popup opens
  chrome.storage.local.get(['savedPrompt'], (result) => {
    if (result.savedPrompt) {
      inputBox.value = result.savedPrompt;
      clearBtn.classList.remove('hidden');
    }
  });

  // Save text as the user types
  inputBox.addEventListener('input', () => {
    const text = inputBox.value;
    chrome.storage.local.set({ savedPrompt: text });
    clearBtn.classList.toggle('hidden', !text);
  });

  // Handle clear button click
  clearBtn.addEventListener('click', () => {
    inputBox.value = '';
    chrome.storage.local.remove(['savedPrompt']);
    clearBtn.classList.add('hidden');
    // If voice recognition is running, stop it
    if (isListening) {
      recognition.stop();
    }
  });

  // === Voice Recognition Logic ===
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    micBtn.addEventListener('click', () => {
      if (isListening) {
        recognition.stop();
      } else {
        recognition.start();
      }
    });

    recognition.onstart = () => {
      isListening = true;
      micBtn.classList.add('listening');
      micBtn.title = 'Stop listening';
    };

    recognition.onresult = (event) => {
      let transcript = event.results[0][0].transcript;
      // Check if there is existing text in the input box.
      if (inputBox.value.trim().length > 0) {
        // Append the new transcript with a space.
        inputBox.value += ' ' + transcript;
      } else {
        // Otherwise, just set the value.
        inputBox.value = transcript;
      }
      // Trigger input event to save the new text
      inputBox.dispatchEvent(new Event('input'));
    };

    recognition.onspeechend = () => {
      recognition.stop();
    };

    recognition.onend = () => {
      isListening = false;
      micBtn.classList.remove('listening');
      micBtn.textContent = '🎤';
      micBtn.title = 'Start listening';
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed') {
        appendMessage('Voice recognition was blocked. Please allow microphone access for this extension.', 'error');
      } else {
        appendMessage(`Voice recognition error: ${event.error}`, 'error');
      }
      console.error('Voice recognition error:', event);
    };
  } else {
    // Hide mic button if the browser doesn't support the API
    micBtn.style.display = 'none';
  }

  // Listener for the submit button
  submitBtn.addEventListener('click', async () => {
    // Clear previous results and disable button
    resultMsg.innerHTML = ''; // Clear all previous messages
    submitBtn.disabled = true;

    const promptText = inputBox.value;
    if (!promptText) {
      appendMessage('Error: Please enter a prompt.', 'error');
      submitBtn.disabled = false;
      return;
    }

    try {
      // Get the URL of the currently active tab to send to the server
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      // Send the prompt and URL to the local server
      const serverResponse = await fetch('http://localhost:8000/run-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText, url: tab.url }),
      });

      const responseText = await serverResponse.text();

      // Check for specific agent failure messages first.
      if (responseText.includes('Stopping due to 3 consecutive failures')) {
        appendMessage(responseText, 'error flex items-start gap-2');
      } else if (responseText.includes('API call failed')) {
        appendMessage(responseText, 'error flex items-start gap-2');
      } else {
        try {
          const data = JSON.parse(responseText);
          // If the server provides a 'logs' array, display each log message
          if (data.logs && Array.isArray(data.logs)) {
            data.logs.forEach(log => {
              appendMessage(log.message, log.type || 'info'); // Use type from log or default to 'info'
            });
          }
          
          // Display the final status and result from the server
          if (data.status && data.result) {
            if (data.status === 'success') {
              // Format the final result with a header and footer for clarity
              const finalResultHtml = `</span><p>${data.result}</p>`;
              appendMessage(finalResultHtml, 'flex items-start gap-2');
            } else {
              appendMessage(`Result: ${data.result}`, 'error flex items-start gap-2');
            }
          } else {
            appendMessage(`Error: Server returned valid JSON but missing 'status' or 'result' fields.`, 'error flex items-start gap-2');
          }
          
        } catch (jsonError) {
          // Handle cases where the response is not the specific error and not valid JSON.
          appendMessage(`Error: Unexpected non-JSON response from server.`, 'error flex items-start gap-2');
        }
      }
    } catch (error) {
      appendMessage(`Error: ${error.message}. Is the local server running?`, 'error');
      console.error('Error communicating with the server:', error);
    } finally {
      // Re-enable the button
      submitBtn.disabled = false;
    }
  });

  // Listener for messages from other parts of the extension (e.g., content script)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_POPUP_PROMPT') {
      sendResponse({ prompt: inputBox.value });
    }
  });
});
