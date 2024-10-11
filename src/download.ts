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

import { existsSync, promises } from 'node:fs';
import * as fs from 'node:fs';
import { arch, platform } from 'node:os';
import * as path from 'node:path';

import type { Octokit } from '@octokit/rest';
import type * as extensionApi from '@podman-desktop/api';

export interface MinikubeGithubReleaseArtifactMetadata extends extensionApi.QuickPickItem {
  tag: string;
  id: number;
}

const githubOrganization = 'kubernetes';
const githubRepo = 'minikube';

export class MinikubeDownload {
  constructor(
    private readonly extensionContext: extensionApi.ExtensionContext,
    private readonly octokit: Octokit,
  ) {}

  // Provides last 5 majors releases from GitHub using the GitHub API
  // return name, tag and id of the release
  async grabLatestsReleasesMetadata(): Promise<MinikubeGithubReleaseArtifactMetadata[]> {
    // Grab last 5 majors releases from GitHub using the GitHub API
    const lastReleases = await this.octokit.repos.listReleases({
      owner: githubOrganization,
      repo: githubRepo,
      per_page: 10,
    });

    return lastReleases.data
      .filter(release => !release.prerelease)
      .map(release => {
        return {
          label: release.name ?? release.tag_name,
          tag: release.tag_name,
          id: release.id,
        };
      })
      .slice(0, 5);
  }

  async getLatestVersionAsset(): Promise<MinikubeGithubReleaseArtifactMetadata> {
    const latestReleases = await this.grabLatestsReleasesMetadata();
    return latestReleases[0];
  }

  // Download minikube from the artifact metadata: MinikubeGithubReleaseArtifactMetadata
  // this will download it to the storage bin folder as well as make it executable
  // return the path where the file has been downloaded
  async download(release: MinikubeGithubReleaseArtifactMetadata): Promise<string> {
    // Get asset id
    const assetId = await this.getReleaseAssetId(release.id, platform(), arch());

    // Get the storage and check to see if it exists before we download kubectl
    const storageData = this.extensionContext.storagePath;
    const storageBinFolder = path.resolve(storageData, 'bin');
    if (!existsSync(storageBinFolder)) {
      await promises.mkdir(storageBinFolder, { recursive: true });
    }

    // Correct the file extension and path resolution
    let fileExtension = '';
    if (process.platform === 'win32') {
      fileExtension = '.exe';
    }
    const minikubeDownloadLocation = path.resolve(storageBinFolder, `minikube${fileExtension}`);

    // Download the asset and make it executable
    await this.downloadReleaseAsset(assetId, minikubeDownloadLocation);
    await this.makeExecutable(minikubeDownloadLocation);

    return minikubeDownloadLocation;
  }

  async makeExecutable(filePath: string): Promise<void> {
    if (process.platform === 'darwin' || process.platform === 'linux') {
      // eslint-disable-next-line sonarjs/file-permissions
      await promises.chmod(filePath, 0o755);
    }
  }

  // Get the asset id of a given release number for a given operating system and architecture
  // operatingSystem: win32, darwin, linux (see os.platform())
  // arch: x64, arm64 (see os.arch())
  async getReleaseAssetId(releaseId: number, operatingSystem: string, arch: string): Promise<number> {
    let extension = '';
    if (operatingSystem === 'win32') {
      operatingSystem = 'windows';
      extension = '.exe';
    }
    if (arch === 'x64') {
      arch = 'amd64';
    }

    const listOfAssets = await this.octokit.repos.listReleaseAssets({
      owner: githubOrganization,
      repo: githubRepo,
      release_id: releaseId,
      per_page: 60,
    });

    const searchedAssetName = `minikube-${operatingSystem}-${arch}${extension}`;

    // search for the right asset
    const asset = listOfAssets.data.find(asset => searchedAssetName === asset.name);
    if (!asset) {
      throw new Error(`No asset found for ${operatingSystem} and ${arch}`);
    }

    return asset.id;
  }

  // download the given asset id
  async downloadReleaseAsset(assetId: number, destination: string): Promise<void> {
    const asset = await this.octokit.repos.getReleaseAsset({
      owner: githubOrganization,
      repo: githubRepo,
      asset_id: assetId,
      headers: {
        accept: 'application/octet-stream',
      },
    });

    // check the parent folder exists
    const parentFolder = path.dirname(destination);

    if (!fs.existsSync(parentFolder)) {
      await fs.promises.mkdir(parentFolder, { recursive: true });
    }
    // write the file
    await fs.promises.writeFile(destination, Buffer.from(asset.data as unknown as ArrayBuffer));
  }
}
