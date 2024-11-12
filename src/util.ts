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

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as extensionApi from '@podman-desktop/api';

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
    return env.PATH ?? '';
  }
}

export function getMinikubeAdditionalEnvs(): Record<string, string> {
  const env: Record<string, string> = {
    PATH: getMinikubePath(),
  };
  const minikubeHome = getMinikubeHome();
  if (minikubeHome) {
    env['MINIKUBE_HOME'] = minikubeHome;
  }
  return env;
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

export function getBinarySystemPath(binaryName: string): string {
  if (extensionApi.env.isWindows) {
    return path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WindowsApps', `${binaryName}.exe`);
  } else {
    return path.join('/usr/local/bin', binaryName);
  }
}

// Takes a binary path (e.g. /tmp/minikube) and installs it to the system. Renames it based on binaryName
// supports Windows, Linux and macOS
// If using Windows or Mac, we will use sudo-prompt in order to elevate the privileges
// If using Linux, we'll use pkexec and polkit support to ask for privileges.
// When running in a flatpak, we'll use flatpak-spawn to execute the command on the host
// @return the system-wide path where it is installed
export async function installBinaryToSystem(binaryPath: string, binaryName: string): Promise<string> {
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
  const destinationPath: string = getBinarySystemPath(binaryName);
  let command: string;
  let args: string[];
  if (system === 'win32') {
    command = 'copy';
    args = [`"${binaryPath}"`, `"${destinationPath}"`];
  } else {
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
    return destinationPath;
  } catch (error) {
    console.error(`Failed to install '${binaryName}' binary: ${error}`);
    throw error;
  }
}

export async function getMinikubeVersion(executable: string): Promise<string> {
  const result = await extensionApi.process.exec(executable, ['version', '--short']);
  return result.stdout.replace('v', '').trim();
}

/**
 * Given an executable name will find where it is installed on the system
 * @param executable
 */
export async function whereBinary(executable: string): Promise<string> {
  // grab full path for Linux and mac
  if (extensionApi.env.isLinux || extensionApi.env.isMac) {
    try {
      const { stdout: fullPath } = await extensionApi.process.exec('which', [executable]);
      return fullPath;
    } catch (err) {
      console.warn('Error getting full path', err);
    }
  } else if (extensionApi.env.isWindows) {
    // grab full path for Windows
    try {
      const { stdout: fullPath } = await extensionApi.process.exec('where.exe', [executable]);
      // remove all line break/carriage return characters from full path
      return fullPath.replace(/(\r\n|\n|\r)/gm, '');
    } catch (err) {
      console.warn('Error getting full path', err);
    }
  }

  throw new Error(`binary ${executable} not found.`);
}

export async function deleteFile(filePath: string): Promise<void> {
  if (filePath && fs.existsSync(filePath)) {
    try {
      await fs.promises.unlink(filePath);
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'EACCES' || error.code === 'EPERM')
      ) {
        await deleteFileAsAdmin(filePath);
      } else {
        throw error;
      }
    }
  }
}

export async function deleteFileAsAdmin(filePath: string): Promise<void> {
  const args: string[] = [filePath];
  const command = extensionApi.env.isWindows ? 'del' : 'rm';

  try {
    // Use admin prileges
    await extensionApi.process.exec(command, args, { isAdmin: true });
  } catch (error) {
    console.error(`Failed to uninstall '${filePath}': ${error}`);
    throw error;
  }
}
