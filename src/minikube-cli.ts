/**********************************************************************
 * Copyright (C) 2024 Red Hat, Inc.
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
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';

import type { CliTool, Disposable, Event, Logger } from '@podman-desktop/api';
import { cli, EventEmitter, process as processCore, window } from '@podman-desktop/api';

import { imageLocation, minikubeCliName, minikubeDescription, minikubeDisplayName } from './constants';
import type { MinikubeDownload, MinikubeGithubReleaseArtifactMetadata } from './download';
import {
  deleteFile,
  getBinarySystemPath,
  getMinikubeHome,
  getMinikubePath,
  installBinaryToSystem,
  whereBinary,
} from './util';

export interface MinikubeExecutableInfo {
  version: string;
  path: string;
}

export class MinikubeCli implements Disposable {
  #cliTool: CliTool | undefined;
  #cliInfo: MinikubeExecutableInfo | undefined;

  private readonly _onCliUpdate = new EventEmitter<MinikubeExecutableInfo | undefined>();
  readonly onCliUpdate: Event<MinikubeExecutableInfo | undefined> = this._onCliUpdate.event;

  constructor(private minikubeDownload: MinikubeDownload) {}

  dispose(): void {
    // dispose cli tool
    this.#cliTool?.dispose();
    this.#cliTool = undefined;
    // dispose event system
    this._onCliUpdate.dispose();
  }

  isInstalled(): boolean {
    return this.#cliInfo !== undefined;
  }

  protected update(info: MinikubeExecutableInfo | undefined): void {
    this.#cliInfo = info;
    if (info) {
      this.#cliTool?.updateVersion(info);
    }

    this._onCliUpdate.fire(info);
  }

  getInfo(): MinikubeExecutableInfo {
    if (!this.#cliInfo) throw new Error('minikube executable not installed');
    return this.#cliInfo;
  }

  init(): void {
    // register the cli tool
    this.#cliTool = cli.createCliTool({
      name: minikubeCliName,
      displayName: minikubeDisplayName,
      markdownDescription: minikubeDescription,
      images: {
        icon: imageLocation,
      },
    });

    // register installer
    let artifact: MinikubeGithubReleaseArtifactMetadata | undefined;
    this.#cliTool?.registerInstaller({
      selectVersion: () =>
        this.selectVersion().then(result => {
          artifact = result;
          return result.tag.replace('v', '').trim();
        }),
      doInstall: (logger: Logger) => {
        if (!artifact) throw new Error('select version undefined');
        return this.doInstall(logger, artifact);
      },
      doUninstall: (logger: Logger) =>
        this.doUninstall(logger).then(() => {
          artifact = undefined;
        }),
    });

    // register updater
    this.#cliTool?.registerUpdate({
      selectVersion: () =>
        this.selectVersion().then(result => {
          artifact = result;
          return result.tag.replace('v', '').trim();
        }),
      doUpdate: (logger: Logger) => {
        if (!artifact) throw new Error('select version undefined');
        return this.doInstall(logger, artifact);
      },
    });

    // detect async
    this.detect()
      .then(cliInfo => {
        this.update(cliInfo);
      })
      .catch((err: unknown) => {
        this.#cliInfo = undefined;
        console.error('Something went wrong while trying to detect minikube on the system', err);
      });
  }

  /**
   * This method takes as argument a path to an executable and start
   * a process with it with version argument
   * @param executable
   * @protected
   */
  protected async getVersion(executable: string): Promise<string> {
    const result = await processCore.exec(executable, ['version', '--short'], {
      env: {
        PATH: getMinikubePath(),
        MINIKUBE_HOME: getMinikubeHome(),
      },
    });
    return result.stdout.replace('v', '').trim();
  }

  protected async detect(): Promise<MinikubeExecutableInfo> {
    let path: string;
    try {
      path = await whereBinary('minikube');
    } catch (_error: unknown) {
      // fallback to extension path
      path = this.minikubeDownload.getMinikubeExtensionPath();
    }

    if (!existsSync(path)) throw new Error('cannot found minikube on system.');

    const version = await this.getVersion(path);
    return {
      version: version,
      path: path,
    };
  }

  protected async selectVersion(): Promise<MinikubeGithubReleaseArtifactMetadata> {
    let lastReleasesMetadata = await this.minikubeDownload.grabLatestsReleasesMetadata();

    // if the user already has an installed version, we remove it from the list
    if (this.#cliInfo) {
      lastReleasesMetadata = lastReleasesMetadata.filter(release => release.tag.slice(1) !== this.#cliInfo?.version);
    }

    // Show the quickpick
    const selectedRelease = await window.showQuickPick(lastReleasesMetadata, {
      placeHolder: 'Select Kind version to download',
    });

    if (selectedRelease) {
      return selectedRelease;
    } else {
      throw new Error('No version selected');
    }
  }

  protected async doInstall(logger: Logger, artifact: MinikubeGithubReleaseArtifactMetadata): Promise<void> {
    // download the cli
    logger.log(`downloading ${artifact.tag}`);
    const destFile = await this.minikubeDownload.download(artifact);
    let path = destFile;
    try {
      // install system-wide
      path = await installBinaryToSystem(destFile, 'minikube');
    } catch (e: unknown) {
      logger.warn(`cannot install minikube system-wide: ${String(e)}`);
    } finally {
      logger.log(`minikube ${artifact.tag} installed at ${path}`);
      const version = artifact.tag.replace('v', '').trim();
      this.update({
        path,
        version,
      });
    }
  }

  protected async doUninstall(logger: Logger): Promise<void> {
    if (!this.#cliInfo) throw new Error('cannot uninstalled minikube: the extension did not detect any installed.');

    const extensionMinikubeExecutable = this.minikubeDownload.getMinikubeExtensionPath();
    if (this.#cliInfo.path === extensionMinikubeExecutable) {
      await rm(this.#cliInfo.path);
    } else if (this.#cliInfo.path === getBinarySystemPath('minikube')) {
      logger.log('Removing minikube system-wide installed');
      return deleteFile(this.#cliInfo.path);
    } else {
      logger.error('cannot uninstall minikube not-installed by the extension.');
      throw new Error('cannot uninstall minikube not-installed by the extension.');
    }

    // final cleanup on the extension storage
    if (existsSync(extensionMinikubeExecutable)) {
      await rm(extensionMinikubeExecutable);
    }

    // notify we are not installed anymore
    this.update(undefined);
  }
}
