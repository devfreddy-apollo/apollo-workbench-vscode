import * as assert from 'assert';

import { test } from 'mocha';
import { activateExtension } from '../helpers';
import { StateManager } from '../../workbench/stateManager';
import { NotLoggedInTreeItem } from '../../workbench/tree-data-providers/apolloStudioGraphsTreeDataProvider';
import { window } from 'vscode';

suite('StudioOperations', async () => {
  window.showInformationMessage('Activating extension');
  const context = await activateExtension();

  test('Should display login item', async function () {
    //Setup
    StateManager.init(context);
    StateManager.instance.globalState_userApiKey = '';

    //Get TreeView children
    const studioGraphTreeItems =
      await StateManager.instance.apolloStudioGraphsProvider.getChildren();

    //Assert
    for (let i = 0; i < studioGraphTreeItems.length; i++)
      assert.notStrictEqual(
        studioGraphTreeItems[i] as NotLoggedInTreeItem,
        undefined,
      );
  });
});
