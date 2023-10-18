import * as vscode from 'vscode';
import { suite, after, before } from 'mocha';

import { activateExtension } from '../helpers';

suite('No Folder Loaded in Workbench', () => {
  vscode.window.showInformationMessage('Start all tests.');
  before(activateExtension);
  after(() => undefined);
});
