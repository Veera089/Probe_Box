const { GoogleGenerativeAI } = require("@google/generative-ai");

/**
 * Attempts to recover a failed test step by asking an LLM for a new selector.
 * @param {import('playwright').Page} page The Playwright page object.
 * @param {object} failedStep The step that failed.
 * @param {object[]} previousSteps The steps that executed successfully before the failure.
 * @returns {Promise<object|null>} A new step object with a corrected selector, or null if recovery fails.
 */
async function recoverStep(page, failedStep, previousSteps) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn('GEMINI_API_KEY environment variable not set. Cannot perform recovery.');
        return null;
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        // Use a stable and widely available model like 'gemini-pro'.
        // The 'gemini-1.5-flash' model may not be available on the v1 API.
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const domSnapshot = await page.content();

        const prompt = `
            A Playwright test step failed.
            Original step: ${JSON.stringify(failedStep)}
            The selector "${failedStep.selector}" was not found.

            Here are the previous successful steps:
            ${JSON.stringify(previousSteps, null, 2)}

            Here is the current DOM structure of the page:
            \`\`\`html
            ${domSnapshot.substring(0, 8000)} 
            \`\`\`

            Based on the failed step's description ("${failedStep.stepName}") and the DOM, find a more robust CSS selector for the intended element.
            Respond with ONLY the new CSS selector as a single line of plain text.
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const newSelector = response.text().trim().replace(/`/g, ''); // Clean up response

        if (newSelector && newSelector !== failedStep.selector) {
            return { ...failedStep, selector: newSelector };
        }
        return null;
    } catch (error) {
        console.error("Error calling LLM for recovery:", error);
        return null;
    }
}

module.exports = { recoverStep };