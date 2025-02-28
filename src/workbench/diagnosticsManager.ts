import {
  Diagnostic,
  DiagnosticCollection,
  DiagnosticSeverity,
  languages,
  Range,
  Uri,
} from 'vscode';
import { ApolloConfig } from './file-system/ApolloConfig';
import { RoverCompositionError } from './file-system/CompositionResults';
import {
  FileProvider,
  schemaFileUri,
  tempSchemaFilePath,
} from './file-system/fileProvider';
import { StateManager } from './stateManager';
import { getFileName } from '../utils/path';
import { ApolloRemoteSchemaProvider } from './docProviders';
import { existsSync, readFileSync } from 'fs';

interface WorkbenchDiagnosticCollections {
  compositionDiagnostics: DiagnosticCollection;
}

export class WorkbenchDiagnostics {
  public static instance: WorkbenchDiagnostics = new WorkbenchDiagnostics();

  diagnosticCollections: Map<string, WorkbenchDiagnosticCollections> = new Map<
    string,
    WorkbenchDiagnosticCollections
  >();

  createWorkbenchFileDiagnostics(graphName: string, wbFilePath: string) {
    if (this.diagnosticCollections.has(wbFilePath)) {
      const collection = this.getWorkbenchDiagnostics(wbFilePath);
      collection?.compositionDiagnostics.clear();
    } else {
      const compositionDiagnostics = languages.createDiagnosticCollection(
        `${graphName}-composition`,
      );
      const operationDiagnostics = languages.createDiagnosticCollection(
        `${graphName}-composition`,
      );

      StateManager.instance.context?.subscriptions.push(compositionDiagnostics);
      StateManager.instance.context?.subscriptions.push(operationDiagnostics);

      this.diagnosticCollections.set(wbFilePath, {
        compositionDiagnostics,
      });
    }
  }

  async setCompositionErrors(
    wbFilePath: string,
    wbFile: ApolloConfig,
    errors: RoverCompositionError[],
  ) {
    const compositionDiagnostics = this.getCompositionDiagnostics(wbFilePath);
    compositionDiagnostics.clear();

    const diagnosticsGroups = this.handleErrors(wbFilePath, errors);
    for (const sn in diagnosticsGroups) {
      const subgraph = wbFile.subgraphs[sn];
      if (subgraph) {
        if (subgraph.schema.file) {
          compositionDiagnostics.set(
            schemaFileUri(subgraph.schema.file, wbFilePath),
            diagnosticsGroups[sn],
          );
        } else if (subgraph.schema.workbench_design) {
          compositionDiagnostics.set(
            schemaFileUri(subgraph.schema.workbench_design, wbFilePath),
            diagnosticsGroups[sn],
          );
        }
        //    Account for a local change to remote source that we can't edit
        else {
          compositionDiagnostics.set(
            ApolloRemoteSchemaProvider.Uri(wbFilePath, sn),
            diagnosticsGroups[sn],
          );
        }
      } else {
        compositionDiagnostics.set(
          Uri.parse(wbFilePath),
          diagnosticsGroups[sn],
        );
      }
    }
  }

  clearCompositionDiagnostics(wbFilePath: string) {
    this.getCompositionDiagnostics(wbFilePath).clear();
  }
  clearAllDiagnostics() {
    this.diagnosticCollections.forEach((diagnosticCollection) => {
      diagnosticCollection.compositionDiagnostics.clear();
    });
  }
  private getCompositionDiagnostics(wbFilePath: string): DiagnosticCollection {
    return this.getWorkbenchDiagnostics(wbFilePath).compositionDiagnostics;
  }
  private getWorkbenchDiagnostics(wbFilePath: string) {
    const wbFileDiagnostics = this.diagnosticCollections.get(wbFilePath);
    if (wbFileDiagnostics != undefined) return wbFileDiagnostics;
    else throw new Error(`No Operation Diagnostic found for ${wbFilePath}`);
  }
  private handleErrors(wbFilePath: string, errors: RoverCompositionError[]) {
    const diagnosticsGroups: { [key: string]: Diagnostic[] } = {};
    const wbFile = FileProvider.instance.workbenchFileFromPath(wbFilePath);

    for (let i = 0; i < errors.length; i++) {
      const error = errors[i];
      const errorMessage = error.message;

      if (error.nodes && error.nodes.length > 0)
        error.nodes.forEach((errorNode) => {
          let subgraphName = errorNode.subgraph;
          if (!subgraphName && errorMessage.slice(0, 1) == '[') {
            subgraphName = errorMessage.split(']')[0].split('[')[1];
          } else if (!subgraphName) {
            Object.keys(wbFile.subgraphs).forEach((subgraph) => {
              const schema = wbFile.subgraphs[subgraph].schema;
              let schemaPath: Uri;
              if (schema.workbench_design) {
                schemaPath = Uri.parse(schema.workbench_design);
              } else if (schema.file) {
                schemaPath = Uri.parse(schema.file);
              } else {
                schemaPath = ApolloRemoteSchemaProvider.Uri(
                  wbFilePath,
                  subgraphName,
                );
              }
              if (existsSync(schemaPath.fsPath)) {
                const typeDefs = readFileSync(schemaPath.fsPath, {
                  encoding: 'utf-8',
                });
                if (errorNode.source == typeDefs) subgraphName = subgraph;
              }
            });

            if (!subgraphName) subgraphName = getFileName(wbFilePath);
          }

          const range = new Range(
            errorNode.start ? errorNode.start.line - 1 : 0,
            errorNode.start ? errorNode.start.column - 1 : 0,
            errorNode.end ? errorNode.end.line - 1 : 0,
            errorNode.start && errorNode.end
              ? errorNode.start.column + errorNode.end.column - 1
              : 0,
          );
          const diagnostic = this.generateDiagnostic(errorMessage,range);

          if (!diagnosticsGroups[subgraphName])
            diagnosticsGroups[subgraphName] = [diagnostic];
          else diagnosticsGroups[subgraphName].push(diagnostic);
        });
      else {
        const diagnostic = this.generateDiagnostic(errorMessage);

        if (!diagnosticsGroups[wbFilePath])
          diagnosticsGroups[wbFilePath] = [diagnostic];
        else diagnosticsGroups[wbFilePath].push(diagnostic);
      }
    }

    return diagnosticsGroups;
  }
  private generateDiagnostic(
    message: string,
    range: Range = new Range(0, 0, 0, 0),
    severity: DiagnosticSeverity = DiagnosticSeverity.Error,
  ) {
    const diagnostic = new Diagnostic(
      range,
      message,
      severity,
    );

    if (message.includes('If you meant the "@'))
      diagnostic.code = `addDirective:${message.split('"')[1]}`;

    return diagnostic;
  }
}
