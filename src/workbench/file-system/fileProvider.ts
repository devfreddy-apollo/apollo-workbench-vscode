import { existsSync, readdirSync } from 'fs';
import path, { join, parse, resolve, normalize } from 'path';
import { commands, ProgressLocation, Uri, window, workspace } from 'vscode';
import { StateManager } from '../stateManager';
import { WorkbenchDiagnostics } from '../diagnosticsManager';
import { log } from '../../utils/logger';
import { load, dump } from 'js-yaml';
import { TextDecoder, TextEncoder } from 'util';
import { ApolloConfig } from './ApolloConfig';
import { Rover } from '../rover';
import { getFileName } from '../../utils/path';
import { homedir } from 'os';
import { print, parse as gqlParse } from 'graphql';
import { extractEntities } from '../federationCompletionProvider';
import { openFolder } from '../../commands/extension';
export const schemaFileUri = (filePath: string, wbFilePath: string) => {
  if (parse(filePath).dir == '.') {
    const wbFileFolder = wbFilePath.split(getFileName(wbFilePath))[0];
    return Uri.parse(resolve(wbFileFolder, normalize(filePath)));
  }
  return Uri.parse(filePath);
};

export const tempSchemaFilePath = (wbFilePath: string, subgraphName: string) =>
  Uri.parse(
    resolve(
      StateManager.instance.extensionGlobalStoragePath,
      'schemas',
      `${getFileName(wbFilePath)}-${subgraphName}.graphql`,
    ),
  );
export const tempOperationFilePath = (
  wbFilePath: string,
  operationName: string,
) =>
  Uri.parse(
    resolve(
      StateManager.instance.extensionGlobalStoragePath,
      'operations',
      `${getFileName(wbFilePath)}-${operationName}.graphql`,
    ),
  );

export class FileProvider {
  private static _instance: FileProvider;
  static get instance(): FileProvider {
    if (!this._instance) this._instance = new FileProvider();

    return this._instance;
  }

  private workbenchFiles: Map<string, ApolloConfig> = new Map();

  async writeTempOperationFile(wbFilePath: string, operationName: string) {
    const wbFile = this.workbenchFileFromPath(wbFilePath);
    const operation = wbFile.operations[operationName];
    const parsedQuery = gqlParse(operation.document);
    const uri = tempOperationFilePath(wbFilePath, operationName);
    await workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(print(parsedQuery)),
    );

    return uri;
  }

  async writeTempSchemaFile(
    wbFilePath: string,
    subgraphName: string,
    sdl?: string,
  ) {
    if (sdl == undefined) {
      const subgraph =
        this.workbenchFileFromPath(wbFilePath)?.subgraphs[subgraphName];
      sdl = await Rover.instance.subgraphFetch(subgraph);

      if (!sdl && subgraph.schema.graphref) {
        const didSelectProfile = await this.selectRoverProfile(
          subgraph.schema.graphref,
        );
        if (!didSelectProfile) return undefined;
      } else if (!sdl) {
        window.showErrorMessage(
          `Unable to fetch schema remote endpoint: ${
            subgraph.schema.subgraph_url ?? subgraph.routing_url ?? 'undefined'
          }`,
        );
        return undefined;
      }
    }

    const tempLocation = tempSchemaFilePath(wbFilePath, subgraphName);
    await workspace.fs.writeFile(tempLocation, new TextEncoder().encode(sdl));

    return tempLocation;
  }
  async selectRoverProfile(graphref?: string) {
    const value = await window.showErrorMessage(
      'Unable to fetch schema from GraphOS. Is your API key stored under another profile with Rover when you configured it?',
      'Configure Profile',
    );
    if (value == 'Configure Profile') {
      const profiles = await Rover.instance.getProfiles();
      const selectedProfile = await window.showQuickPick(profiles, {
        title:
          'Select which rover profile should be configured for this Workbench workspace',
      });
      if (selectedProfile) {
        StateManager.settings_roverConfigProfile = selectedProfile;
        window.showInformationMessage(
          `${selectedProfile} was configured for this workspace. You should now be able to view GraphOS subgraph schemas as long as the profile has a valid api key for your ${
            graphref ? graphref : 'APOLLO_GRAPH_REF'
          }.`,
        );

        return true;
      }
    }

    return false;
  }

  workbenchFileFromPath(path: string): ApolloConfig {
    let wbFile = this.workbenchFiles.get(path);
    if (!wbFile)
      //we're on Windows
      wbFile = this.workbenchFiles.get(path.replace(/\//g, '\\'));

    if (!wbFile) throw new Error(`Unable to get workbench file from ${path}`);

    return wbFile;
  }
  async convertSubgraphToDesign(
    wbFilePath: string,
    subgraphName: string,
    designPath?: string,
  ) {
    const wbFile = this.workbenchFileFromPath(wbFilePath);
    wbFile.subgraphs[subgraphName].schema.workbench_design =
      designPath ?? wbFile.subgraphs[subgraphName].schema.file;

    if (!wbFile.subgraphs[subgraphName].schema.workbench_design) {
      //Need to get schema
      const tempUri = await FileProvider.instance.writeTempSchemaFile(
        wbFilePath,
        subgraphName,
      );
      if (tempUri && StateManager.workspaceRoot) {
        const schemaFilePath = resolve(
          StateManager.workspaceRoot,
          `${subgraphName}.graphql`,
        );
        const schemaFileUri = Uri.parse(schemaFilePath);
        await workspace.fs.copy(tempUri, schemaFileUri, {
          overwrite: true,
        });

        wbFile.subgraphs[subgraphName].schema.workbench_design = schemaFilePath;
      }
    }

    await workspace.fs.writeFile(
      Uri.parse(wbFilePath),
      new TextEncoder().encode(dump(wbFile)),
    );
  }

  async refreshWorkbenchFileComposition(wbFilePath: string) {
    log(`Refreshing composition for ${wbFilePath}`);
    return await window.withProgress(
      { location: ProgressLocation.Notification },
      async (progress) => {
        const wbFile = this.workbenchFileFromPath(wbFilePath);
        const designName = getFileName(wbFilePath);

        progress.report({
          message: `Composing ${designName}...`,
        });

        try {
          if (wbFile) {
            const tempPath = await this.createTempWorkbenchFile(
              wbFile,
              wbFilePath,
            );
            const compResults = await Rover.instance.compose(tempPath);
            if (compResults.data.success) {
              WorkbenchDiagnostics.instance.clearCompositionDiagnostics(
                wbFilePath,
              );
              //Need to get entities and add to state
              const designEntities = extractEntities(
                compResults.data.core_schema ?? '',
              );
              StateManager.instance.workspaceState_setEntities({
                designPath: wbFilePath,
                entities: designEntities,
              });

              return compResults.data.core_schema;
            } else if (compResults.error) {
              if (compResults.error.message == 'Failed to execute command') {
                log(`Something went wrong with rover`);
                window.showErrorMessage(
                  `Unable to compose ${getFileName(
                    wbFilePath,
                  )}. Failed to execute command with rover, do you have rover installed?`,
                );
              } //if (compResults.error.details) {
              else
                await WorkbenchDiagnostics.instance.setCompositionErrors(
                  wbFilePath,
                  wbFile,
                  compResults.error?.details?.build_errors ?? [
                    { ...compResults.error, nodes: [] },
                  ],
                );
              // } else {
              //   window.showErrorMessage(compResults.error.message);
              // }
            }
          }
        } catch (err: any) {
          log(err.message);
        }
      },
    );
  }

  //All workbench files in opened VS Code folder
  async refreshLocalWorkbenchFiles() {
    // Clear all workbench files and workbench diagnostics
    this.workbenchFiles.clear();
    WorkbenchDiagnostics.instance.clearAllDiagnostics();
    StateManager.instance.workspaceState_clearEntities();

    const workspaceRoot = StateManager.workspaceRoot;
    if (workspaceRoot) {
      const workbenchFileURIs = await this.getWorkbenchFilesInDirectory(
        workspaceRoot,
      );

      if (workbenchFileURIs.length > 0) {
        for (let i = 0; i < workbenchFileURIs.length; i++) {
          const uri = workbenchFileURIs[i];
          const wbFilePath = uri.path;

          try {
            const yamlFile = await workspace.fs.readFile(uri);
            const wbString = yamlFile.toString();
            const wbFile = load(wbString) as ApolloConfig;

            this.workbenchFiles.set(wbFilePath, wbFile);
            WorkbenchDiagnostics.instance.createWorkbenchFileDiagnostics(
              getFileName(wbFilePath),
              wbFilePath,
            );

            await this.refreshWorkbenchFileComposition(wbFilePath);
          } catch (err) {
            window.showErrorMessage(
              `Workbench file was not in the correct format. File located at ${wbFilePath}`,
            );
          }
        }
      }
    }
  }
  getWorkbenchFiles() {
    return this.workbenchFiles;
  }

  //Workbench File Implementations
  async createWorkbenchFileLocally(designName: string, wbFile: ApolloConfig) {
    if (StateManager.workspaceRoot) {
      const wbFilePath = resolve(
        StateManager.workspaceRoot,
        `${designName}.yaml`,
      );
      await this.writeWorkbenchConfig(wbFilePath, wbFile);
    }
  }
  /**
   * Creates a temporary copy of a local config file so we can modify schema based on workbench_design
   * @param ApolloConfig file
   * @param Path to ApolloConfig file
   * @returns Path where temporary config file lives
   */
  async createTempWorkbenchFile(wbFile: ApolloConfig, wbFilePath: string) {
    const wbTempFolder = resolve(homedir(), '.apollo-workbench');
    const tempPath = resolve(homedir(), '.apollo-workbench', 'supergraph.yaml');
    await workspace.fs.createDirectory(Uri.parse(wbTempFolder));

    const tempWbFile = ApolloConfig.copy(wbFile);
    Object.keys(wbFile.subgraphs).forEach((subgraphName) => {
      if (wbFile.subgraphs[subgraphName].schema.workbench_design) {
        tempWbFile.subgraphs[subgraphName].schema.file = resolve(
          StateManager.workspaceRoot ?? '',
          wbFile.subgraphs[subgraphName].schema.workbench_design ?? '',
        );

        delete tempWbFile.subgraphs[subgraphName].schema.subgraph_url;
      } else if (wbFile.subgraphs[subgraphName].schema.file) {
        tempWbFile.subgraphs[subgraphName].schema.file = resolve(
          StateManager.workspaceRoot ?? '',
          wbFile.subgraphs[subgraphName].schema.file ?? '',
        );
      }
    });

    await this.writeWorkbenchConfig(tempPath, tempWbFile, false);

    return tempPath;
  }

  async writeWorkbenchConfig(
    path: string,
    wbFile: ApolloConfig,
    shouldRefresh = true,
  ) {
    await workspace.fs.writeFile(
      Uri.parse(path),
      new TextEncoder().encode(dump(wbFile)),
    );

    if (shouldRefresh)
      StateManager.instance.localSupergraphTreeDataProvider.refresh();
  }

  workbenchFileByGraphName(name: string) {
    let wbFilePath = '';
    let wbFile: ApolloConfig = new ApolloConfig();
    this.workbenchFiles.forEach((value, key) => {
      if (getFileName(key) == name) {
        wbFilePath = key;
        wbFile = value;
      }
    });

    return { wbFile, path: wbFilePath };
  }
  workbenchFilePathBySchemaFilePath(schemaPath: string) {
    let path = '';
    let name = '';
    this.workbenchFiles.forEach((wbFile, wbFilePath) => {
      Object.keys(wbFile.subgraphs).forEach((subgraphName) => {
        const subgraph = wbFile.subgraphs[subgraphName];
        if (
          subgraph.schema.file == schemaPath ||
          subgraph.schema.workbench_design == schemaPath
        ) {
          path = wbFilePath;
          name = subgraphName;
        }
      });
    });

    return { path, subgraphName: name };
  }

  private async getWorkbenchFilesInDirectory(dirPath: string) {
    if (!dirPath || dirPath == '.') return [];

    const workbenchFiles = new Array<Uri>();
    const directories = new Array<string>();
    directories.push(dirPath);

    while (directories.length > 0) {
      const directory = directories[0];
      const dirents = readdirSync(directory, { withFileTypes: true });
      for (const dirent of dirents) {
        const directoryPath = path.resolve(directory, dirent.name);
        if (dirent.isDirectory() && dirent.name != 'node_modules') {
          directories.push(directoryPath);
        } else if (dirent.name.includes('.yaml')) {
          const yamlFile = await workspace.fs.readFile(
            Uri.parse(directoryPath),
          );
          const yaml = load(new TextDecoder().decode(yamlFile)) as ApolloConfig;
          if (yaml?.federation_version) {
            workbenchFiles.push(Uri.parse(directoryPath));
          }
        }
      }

      directories.splice(0, 1);
    }

    return workbenchFiles;
  }

  getPreloadedWorkbenchFiles() {
    const items: { fileName: string; path: string }[] = [];
    const preloadFileDir = join(
      __dirname,
      '..',
      '..',
      '..',
      'media',
      `preloaded-files`,
    );
    if (existsSync(preloadFileDir)) {
      const preloadedDirectory = readdirSync(preloadFileDir, {
        encoding: 'utf-8',
      });
      preloadedDirectory.map((item) => {
        items.push({
          fileName: item.split('.')[0],
          path: `${preloadFileDir}/${item}`,
        });
      });
    }
    return items;
  }
}
