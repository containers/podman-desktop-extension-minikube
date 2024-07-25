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

export function getMinikubeHome(): string | undefined {
  const minikubeConfiguration = extensionApi.configuration.getConfiguration('minikube');
  const minikubeHome = minikubeConfiguration.get<string>('home');
  // Check env if configuration is not applied in UI
  if (!minikubeHome) {
    const env = process.env;
    return env.MINIKUBE_HOME;
  } else {
    return minikubeHome;
  }
}

// search if minikube is available in the path
export async function detectMinikube(pathAddition: string, installer: MinikubeInstaller): Promise<string> {
  try {
    await extensionApi.process.exec('minikube', ['version'], {
      env: {
        PATH: getMinikubePath(),
        MINIKUBE_HOME: getMinikubeHome(),
      },
    });
    return 'minikube';
  } catch (e) {
    // ignore and try another way
  }

  const assetInfo = await installer.getAssetInfo();
  if (assetInfo) {
    try {
      await extensionApi.process.exec(assetInfo.name, ['version'], {
        env: {
          PATH: getMinikubePath().concat(path.delimiter).concat(pathAddition),
          MINIKUBE_HOME: getMinikubeHome(),
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
    await extensionApi.process.exec('mkdir', ['-p', localBinDir], { isAdmin: true });
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
