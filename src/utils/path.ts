import { Uri } from "vscode";
import { Utils } from "vscode-uri";

// https://github.com/microsoft/vscode-uri#readme
export function getFileName(filePath: string){
  const uri = Uri.parse(filePath);
  return Utils.basename(uri);
}