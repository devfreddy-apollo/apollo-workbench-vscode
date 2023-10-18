import * as path from 'path';

import { runTests } from '@vscode/test-electron';

//Function for running the tests
//  @param `loadFolder` will load the testing folder and run the associated tests
//      default: No folder will be opened and default tests will be ran
export async function testRunner(loadFolder = false) {
  try {
    // The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');

    // The path to test runner
		// Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './suite/index');

    // Our workbench folder to test both "no folder" and "folder selected" tests
    const testWorkbenchFolder = path.resolve(__dirname, './test-workbench');
    
    // Debug
    console.log(JSON.stringify({ extensionDevelopmentPath, extensionTestsPath, testWorkbenchFolder }));
    // return await runTests({ extensionDevelopmentPath, extensionTestsPath });

    let testResults = 1;
    if (loadFolder) {
      testResults = await runTests({
        extensionDevelopmentPath,
        extensionTestsPath,
        launchArgs: [testWorkbenchFolder],
      });
    } else {
      testResults = await runTests({
        extensionDevelopmentPath,
        extensionTestsPath
      });
    }

    return testResults;
  } catch (err) {
    console.error(err);
    console.error('Failed to run tests');
    process.exit(1);
  }
}
