let isRecording = false;

// Helper to generate a robust CSS selector for an element
function getSelector(element) {
    if (!element) return null;

    // Prioritize data-testid
    if (element.hasAttribute('data-testid')) {
        return `[data-testid="${element.getAttribute('data-testid')}"]`;
    }
    // Then ID
    if (element.id) {
        return `#${element.id}`;
    }
    // Then name attribute for inputs/selects
    if (element.name) {
        return `[name="${element.name}"]`;
    }
    // Try to get a unique CSS selector
    const path = [];
    while (element.nodeType === Node.ELEMENT_NODE) {
        let selector = element.nodeName.toLowerCase();
        if (element.id) {
            selector += `#${element.id}`;
            path.unshift(selector);
            break;
        } else {
            let sib = element, nth = 1;
            while (sib.previousElementSibling) {
                if (sib.previousElementSibling.nodeName.toLowerCase() === selector) {
                    nth++;
                }
                sib = sib.previousElementSibling;
            }
            if (nth !== 1) {
                selector += `:nth-of-type(${nth})`;
            }
        }
        path.unshift(selector);
        element = element.parentNode;
    }
    return path.join(' > ');
}

function generateStepName(actionType, selector, value, key) {
    let name = `${actionType}`;
    if (actionType === 'goto') {
        name += ` to ${value}`;
    } else if (actionType === 'type' || actionType === 'fill') {
        name += ` "${value}" into ${selector}`;
    } else if (actionType === 'click') {
        name += ` on ${selector}`;
    } else if (actionType === 'press') {
        name += ` key "${key}" on ${selector || 'page'}`;
    } else if (actionType === 'expect') {
        name = `Expect ${selector} to be visible`;
    } else if (actionType === 'select') {
        name += ` "${value}" in ${selector}`;
    }
    return name;
}

function recordAction(type, event, extra = {}) {
    if (!isRecording) return;

    const target = event.target;
    const selector = getSelector(target);
    const url = window.location.href;
    let value = target.value;

    const actionData = {
        type: type,
        selector: selector,
        url: url,
        ...extra
    };

    if (type === 'type' || type === 'fill') {
        actionData.value = value;
    } else if (type === 'click' && target.tagName === 'SELECT') {
        // Handle select change separately
        return;
    } else if (type === 'select') {
        actionData.value = value;
    }

    actionData.stepName = generateStepName(type, selector, value, extra.key);

    chrome.runtime.sendMessage({ action: 'recordAction', data: actionData });
}

function handleInput(event) {
    recordAction('type', event);
}

function handleClick(event) {
    if (event.target.tagName === 'SELECT') {
        // Select changes are handled by 'change' event
        return;
    }
    recordAction('click', event);
}

function handleKeydown(event) {
    if (event.key === 'Enter') {
        recordAction('press', event, { key: 'Enter' });
    }
}

function handleSelectChange(event) {
    recordAction('select', event);
}

let pickerActive = false;
let lastHoveredElement = null;

function handleMouseOver(event) {
    if (lastHoveredElement) {
        lastHoveredElement.style.outline = '';
    }
    lastHoveredElement = event.target;
    lastHoveredElement.style.outline = '2px solid #ffc107'; // Yellow outline
}

function handlePickerClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const selector = getSelector(event.target);
    const assertionStep = {
        type: 'expect',
        assertion: 'toBeVisible',
        selector: selector,
        stepName: generateStepName('expect', selector)
    };

    chrome.runtime.sendMessage({ action: 'recordAction', data: assertionStep });

    // Cleanup
    if (lastHoveredElement) {
        lastHoveredElement.style.outline = '';
    }
    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('click', handlePickerClick, true);
    pickerActive = false;
    console.log('Content script: Element picked, exiting picker mode.');
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'startRecording') {
        if (!isRecording) {
            isRecording = true;
            // Record initial navigation
            chrome.runtime.sendMessage({ action: 'recordAction', data: { type: 'goto', url: window.location.href, stepName: `Navigate to ${window.location.href}` } });
            document.addEventListener('click', handleClick, true); // Use capture phase to get clicks before they are handled by page scripts
            document.addEventListener('input', handleInput, true);
            document.addEventListener('keydown', handleKeydown, true);
            document.addEventListener('change', handleSelectChange, true); // For select elements
            console.log('Content script: Recording started.');
        }
    } else if (message.action === 'stopRecording') {
        if (isRecording) {
            isRecording = false;
            document.removeEventListener('click', handleClick, true);
            document.removeEventListener('input', handleInput, true);
            document.removeEventListener('keydown', handleKeydown, true);
            document.removeEventListener('change', handleSelectChange, true);
            console.log('Content script: Recording stopped.');
        }
    } else if (message.action === 'startPicking') {
        if (isRecording && !pickerActive) {
            pickerActive = true;
            console.log('Content script: Entering element picker mode.');
            document.addEventListener('mouseover', handleMouseOver, true);
            document.addEventListener('click', handlePickerClick, true);
        }
    }
});

// Initial check for recording status when content script is loaded
// This handles cases where the content script might be re-injected or page reloaded
chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
    if (response && response.isRecording) {
        // If recording was already active, re-attach listeners
        isRecording = true;
        document.addEventListener('click', handleClick, true);
        document.addEventListener('input', handleInput, true);
        document.addEventListener('keydown', handleKeydown, true);
        document.addEventListener('change', handleSelectChange, true);
        console.log('Content script: Re-attached listeners for ongoing recording.');
    }
});
