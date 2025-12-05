const { readdirSync } = require('fs');
const { join, resolve } = require('path');
const { runTest } = require('./runner'); // Import the runTest function

const TESTS_DIR = resolve(__dirname, '../tests');

(async () => {
    try {
        console.log(`🔍 Searching for test files in: ${TESTS_DIR}`);
        const allFiles = readdirSync(TESTS_DIR);
        const testFiles = allFiles.filter(file => file.endsWith('.json'));

        if (testFiles.length === 0) {
            console.log('No test files found in the /tests directory.');
            return;
        }

        console.log(`🚀 Found ${testFiles.length} test(s) to run.`);
        console.log('==================================================');

        let failedTests = 0;

        for (const testFile of testFiles) {
            const testFilePath = join(TESTS_DIR, testFile);
            console.log(`\n▶️  Running test: ${testFile}`);
            try {
                // Call the runTest function directly
                const success = await runTest(testFilePath);
                if (!success) throw new Error('Test failed');
            } catch (error) {
                failedTests++;
            }
            console.log('==================================================');
        }

        console.log(failedTests > 0 ? `\n🛑 Finished suite. ${failedTests} of ${testFiles.length} tests failed.` : `\n🎉 All ${testFiles.length} tests passed!`);
        process.exit(failedTests > 0 ? 1 : 0);
    } catch (error) {
        console.error('An unexpected error occurred while running the test suite:', error);
        process.exit(1);
    }
})();
