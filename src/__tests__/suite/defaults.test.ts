import * as assert from 'assert';

import { test } from 'mocha';
import { getFileName } from '../../utils/path';

suite('Default Tests', async () => {
  test('Workbench foldername', () => {
    const answer = "data........gov";
    const filePath = "/Users/JohnDoeUserName/Data/data........gov";
    const fileName = getFileName(filePath);
    return assert.strictEqual(answer, fileName);
  });
});
