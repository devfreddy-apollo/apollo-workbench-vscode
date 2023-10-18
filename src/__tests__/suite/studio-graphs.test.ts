import * as assert from 'assert';

import { test } from 'mocha';
import { activateExtension, cleanupWorkbenchFiles } from '../helpers';
import { StateManager } from '../../workbench/stateManager';
import { NotLoggedInTreeItem } from '../../workbench/tree-data-providers/apolloStudioGraphsTreeDataProvider';
import { ExtensionContext, commands, window } from 'vscode';
import { getFileName } from '../../utils/path';

suite('StudioGraphs', async () => {
  window.showInformationMessage('Activating extension');
  const context = await activateExtension();

  test('Should display login item', async function () {
    // UI Navigation
    await commands.executeCommand('local-supergraph-designs.focus');

    //Setup
    StateManager.init(context);
    StateManager.instance.globalState_userApiKey = '';

    //Get TreeView children
    const studioGraphTreeItems =
      await StateManager.instance.apolloStudioGraphsProvider.getChildren();

    //Assert
    studioGraphTreeItems.forEach((studioGraphTreeItem) =>
      assert.notStrictEqual(
        studioGraphTreeItem as NotLoggedInTreeItem,
        undefined,
      ),
    );
  });
});
