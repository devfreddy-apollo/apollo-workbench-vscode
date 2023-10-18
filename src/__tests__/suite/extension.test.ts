import * as assert from 'assert';
import { suite, before, afterEach } from 'mocha';
import {
  activateExtension,
  cleanupWorkbenchFiles,
} from '../helpers';

const key = 'Extension activation';

suite(key, () => {
  before(activateExtension);
  afterEach(cleanupWorkbenchFiles);
});
