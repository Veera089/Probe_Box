// === Utility: Wait for an element to appear ===
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const element = document.querySelector(selector);
    if (element) return resolve(element);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(`Timeout: Element "${selector}" not found.`);
    }, timeout);
  });
}

// === Main logic ===
(async function initAgentLogger() {
  try {
    const inputField = await waitForElement('[aria-label="Chatbot User Input"]');
    const sendButton = await waitForElement('[aria-label="Send Input"]');
    const voiceButton = document.querySelector('[aria-label="Voice Input"]'); // optional

    const interactionLog = [];

    // Log typing
    inputField.addEventListener('input', (e) => {
      interactionLog.push({
        type: 'text-input',
        value: e.target.value,
        time: Date.now()
      });
    });

    // Log send clicks (with safety)
    sendButton.addEventListener('click', () => {
      const value = inputField?.value || '';
      interactionLog.push({
        type: 'send-input',
        value,
        time: Date.now()
      });
    });

    // Log voice button clicks
    if (voiceButton) {
      voiceButton.addEventListener('click', () => {
        interactionLog.push({
          type: 'voice-activation',
          time: Date.now()
        });
      });
    }

    // Helper function for popup
    function summarizeInteractions() {
      const summary = {
        questions: interactionLog
          .filter(item => item.type === 'send-input')
          .map(item => item.value),
        voiceCount: interactionLog.filter(item => item.type === 'voice-activation').length
      };
      console.log('Session Summary:', summary);
      return summary;
    }

    // Listen for popup messages
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'GET_SUMMARY') {
        sendResponse({ summary: summarizeInteractions() });
      }

      if (msg.type === 'USER_PROMPT') {
        console.log('User Prompt Received:', msg.text);
        const summary = summarizeInteractions();
        summary.lastPrompt = msg.text;
        sendResponse({ summary });
      }

      // Listen for requests from the test script
      if (msg.type === 'GET_USER_PROMPT') {
        chrome.runtime.sendMessage({ type: 'GET_POPUP_PROMPT' }, (response) => {
          sendResponse({ prompt: response.prompt });
        });
        return true; // Indicates that the response is sent asynchronously
      }

    });

    console.log('✅ Agent logger initialized.');
  } catch (err) {
    console.warn('Agent logger setup failed:', err);
  }
})();
