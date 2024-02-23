/**********************************************************************
 * Copyright (C) 2023-2024 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import * as os from 'node:os';
import * as path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import * as extensionApi from '@podman-desktop/api';
import type { MinikubeInstaller } from './minikube-installer';
import * as fs from 'node:fs';

export interface SpawnResult {
  stdOut: string;
  stdErr: string;
  error: undefined | string;
}

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  logger?: extensionApi.Logger;
}

const macosExtraPath = '/usr/local/bin:/opt/homebrew/bin:/opt/local/bin:/opt/podman/bin';

export function getMinikubePath(): string {
  const env = process.env;
  if (extensionApi.env.isMac) {
    if (!env.PATH) {
      return macosExtraPath;
    } else {
      return env.PATH.concat(':').concat(macosExtraPath);
    }
  } else {
    return env.PATH;
  }
}

export function getMinikubeHome(): string {
  const env = process.env
  if (!env.MINIKUBE_HOME || env.MINIKUBE_HOME === '') {
    return path.join(os.homedir(), '.minikube')
  } else {
    return env.MINIKUBE_HOME
  }
}

// search if minikube is available in the path
export async function detectMinikube(pathAddition: string, installer: MinikubeInstaller): Promise<string> {
  try {
    await runCliCommand('minikube', ['version'], { env: { PATH: getMinikubePath(), MINIKUBE_HOME: getMinikubeHome() } });
    return 'minikube';
  } catch (e) {
    // ignore and try another way
  }

  const assetInfo = await installer.getAssetInfo();
  if (assetInfo) {
    try {
      await runCliCommand(assetInfo.name, ['version'], {
        env: {
          PATH: getMinikubePath().concat(path.delimiter).concat(pathAddition),
          MINIKUBE_HOME: getMinikubeHome()
        },
      });
      return pathAddition
        .concat(path.sep)
        .concat(extensionApi.env.isWindows ? assetInfo.name + '.exe' : assetInfo.name);
    } catch (e) {
      console.error(e);
    }
  }
  return undefined;
}

export function runCliCommand(
  command: string,
  args: string[],
  options?: RunOptions,
  token?: extensionApi.CancellationToken,
): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    let stdOut = '';
    let stdErr = '';
    let err = '';
    let env = Object.assign({}, process.env); // clone original env object

    // In production mode, applications don't have access to the 'user' path like brew
    if (extensionApi.env.isMac || extensionApi.env.isWindows) {
      env.PATH = getMinikubePath();
      if (extensionApi.env.isWindows) {
        // Escape any whitespaces in command
        command = `"${command}"`;
      }
    } else if (env.FLATPAK_ID) {
      // need to execute the command on the host
      args = ['--host', command, ...args];
      command = 'flatpak-spawn';
    }

    if (options?.env) {
      env = Object.assign(env, options.env);
    }

    const spawnProcess = spawn(command, args, { shell: extensionApi.env.isWindows, env });
    // if the token is cancelled, kill the process and reject the promise
    token?.onCancellationRequested(() => {
      killProcess(spawnProcess);
      options?.logger?.error('Execution cancelled');
      // reject the promise
      reject(new Error('Execution cancelled'));
    });
    // do not reject as we want to store exit code in the result
    spawnProcess.on('error', error => {
      if (options?.logger) {
        options.logger.error(error);
      }
      stdErr += error;
      err += error;
    });

    spawnProcess.stdout.setEncoding('utf8');
    spawnProcess.stdout.on('data', data => {
      if (options?.logger) {
        options.logger.log(data);
      }
      stdOut += data;
    });
    spawnProcess.stderr.setEncoding('utf8');
    spawnProcess.stderr.on('data', data => {
      if (args?.[0] === 'create' || args?.[0] === 'delete') {
        if (options?.logger) {
          options.logger.log(data);
        }
        if (typeof data === 'string' && data.indexOf('error') >= 0) {
          stdErr += data;
        } else {
          stdOut += data;
        }
      } else {
        stdErr += data;
      }
    });

    spawnProcess.on('close', exitCode => {
      if (exitCode == 0) {
        resolve({ stdOut, stdErr, error: err });
      } else {
        if (options?.logger) {
          options.logger.error(stdErr);
        }
        reject(new Error(stdErr));
      }
    });
  });
}

// Takes a binary path (e.g. /tmp/minikube) and installs it to the system. Renames it based on binaryName
// supports Windows, Linux and macOS
// If using Windows or Mac, we will use sudo-prompt in order to elevate the privileges
// If using Linux, we'll use pkexec and polkit support to ask for privileges.
// When running in a flatpak, we'll use flatpak-spawn to execute the command on the host
export async function installBinaryToSystem(binaryPath: string, binaryName: string): Promise<void> {
  const system = process.platform;

  // Before copying the file, make sure it's executable (chmod +x) for Linux and Mac
  if (system === 'linux' || system === 'darwin') {
    try {
      await extensionApi.process.exec('chmod', ['+x', binaryPath]);
      console.log(`Made ${binaryPath} executable`);
    } catch (error) {
      throw new Error(`Error making binary executable: ${error}`);
    }
  }

  // Create the appropriate destination path (Windows uses AppData/Local, Linux and Mac use /usr/local/bin)
  // and the appropriate command to move the binary to the destination path
  let destinationPath: string;
  let command: string;
  let args: string[];
  if (system === 'win32') {
    destinationPath = path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WindowsApps', `${binaryName}.exe`);
    command = 'copy';
    args = [`"${binaryPath}"`, `"${destinationPath}"`];
  } else {
    destinationPath = path.join('/usr/local/bin', binaryName);
    command = 'cp';
    args = [binaryPath, destinationPath];
  }

  // If on macOS or Linux, check to see if the /usr/local/bin directory exists,
  // if it does not, then add mkdir -p /usr/local/bin to the start of the command when moving the binary.
  const localBinDir = '/usr/local/bin';
  if ((system === 'linux' || system === 'darwin') && !fs.existsSync(localBinDir)) {
    if (system === 'darwin') {
      args.unshift('mkdir', '-p', localBinDir, '&&');
    } else {
      // add mkdir -p /usr/local/bin just after the first item or args array (so it'll be in the -c shell instruction)
      args[args.length - 1] = `mkdir -p /usr/local/bin && ${args[args.length - 1]}`;
    }
  }

  try {
    // Use admin prileges / ask for password for copying to /usr/local/bin
    await extensionApi.process.exec(command, args, { isAdmin: true });
    console.log(`Successfully installed '${binaryName}' binary.`);
  } catch (error) {
    console.error(`Failed to install '${binaryName}' binary: ${error}`);
    throw error;
  }
}

function killProcess(spawnProcess: ChildProcess) {
  if (extensionApi.env.isWindows) {
    spawn('taskkill', ['/pid', spawnProcess.pid?.toString(), '/f', '/t']);
  } else {
    spawnProcess.kill();
  }
}
