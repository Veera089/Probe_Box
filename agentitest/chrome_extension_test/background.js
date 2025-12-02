// background.js (manifest v3)
chrome.action.onClicked.addListener(async () => {
  try {
    // get the active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];

    if (!tab) {
      console.warn('No active tab found.');
      return;
    }

    const url = tab.url || '';

    // DO NOT inject into chrome:// pages
    if (url.startsWith('chrome://')) {
      console.warn('Cannot inject into chrome:// pages');
      // optional: notify the user (requires "notifications" permission in manifest if used)
      // chrome.notifications.create({ type: 'basic', iconUrl: 'icon.png', title: 'Injection blocked', message: 'This extension cannot run on chrome:// pages.' });
      return;
    }

    // Example 1: Inject inline function (simple)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { alert('Hello, World!'); }
    });

    // Example 2: Or, inject an external content script file instead:
    // await chrome.scripting.executeScript({
    //   target: { tabId: tab.id },
    //   files: ['content.js']
    // });

  } catch (err) {
    // catch network/permission/injection errors
    console.error('Script injection failed:', err);
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('Sample Input Extension installed.');
});

