// src/runner.js
const { chromium, expect } = require('playwright/test');
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const { recoverStep } = require('./recovery-agent');
const VISUAL_DELAY = 500; // Delay in ms to make execution visible
async function executeStep(page, step) {
    console.log(`  ▶️ Executing: ${step.stepName}`);
    const timeout = 5000; // 5 second timeout per step

    switch (step.action) {
        case 'goto':
            await page.goto(step.value, { timeout });
            break;
        case 'click':
            await page.locator(step.selector).click({ timeout });
            break;
        case 'fill':
            await page.locator(step.selector).fill(step.value, { timeout });
            break;
        case 'press':
            await page.locator(step.selector).press(step.value, { timeout });
            break;
        case 'wait':
            console.log(`    ...waiting for ${step.value}ms`);
            await page.waitForTimeout(parseInt(step.value, 10));
            break;
        case 'expect':
            switch (step.assertion) {
                case 'toBeVisible':
                    await expect(page.locator(step.selector)).toBeVisible({ timeout });
                    break;
            }
            break;
        default:
            throw new Error(`Unknown action: ${step.action}`);
    }
}

async function runTest(testFilePath) {
    let browser;
    try {
        browser = await chromium.launch({ 
            headless: false,
            slowMo: VISUAL_DELAY, // Adds a delay before each Playwright action
        });
        const page = await browser.newPage();
        const testData = JSON.parse(readFileSync(testFilePath, 'utf-8'));
        const testSteps = testData.steps || []; // Handle cases where steps might be missing
        let testFailed = false;

        for (let i = 0; i < testSteps.length; i++) {
            let step = testSteps[i];
            
            try {
                await executeStep(page, step);
                await page.waitForTimeout(VISUAL_DELAY / 2); // Wait after the step to see the result
                console.log('    ✅ Success\n');
            } catch (error) {
                console.warn(`    ⚠️ Step failed: ${error.message.split('\n')[0]}`);
                console.log('    🤔 Attempting self-healing recovery...');

                const recoveredStep = await recoverStep(page, step, testSteps.slice(0, i));
                
                if (recoveredStep) {
                    console.log(`    ✨ Recovery successful! New selector: "${recoveredStep.selector}"`);
                    try {
                        await executeStep(page, recoveredStep); // Retry with the new step
                        await page.waitForTimeout(VISUAL_DELAY / 2); // Wait after the step to see the result
                        console.log('    ✅ Success on retry!\n');
                        // Persist the fix for future runs
                        testSteps[i] = recoveredStep;
                        writeFileSync(testFilePath, JSON.stringify(testData, null, 2));
                    } catch (retryError) {
                        console.error(`    ❌ Recovery attempt failed: ${retryError.message.split('\n')[0]}`);
                        testFailed = true;
                        break;
                    }
                } else {
                    console.error('    ❌ Recovery failed. Could not find a new selector. Aborting.');
                    testFailed = true;
                    break;
                }
            }
        }

        console.log(testFailed ? '🛑 Test finished with errors.' : '🎉 Test completed successfully!');
        if (testFailed) process.exit(1);
        return !testFailed; // Return success status
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// This block allows the script to be run directly from the command line
if (require.main === module) {
    (async () => {
        const testFilePath = process.argv[2];
        if (!testFilePath) {
            console.error('🛑 Error: Please provide a path to the test JSON file.');
            console.log('Usage: node src/runner.js <path/to/your/test.json>');
            process.exit(1);
        }
        await runTest(testFilePath);
    })();
}

module.exports = { runTest };
