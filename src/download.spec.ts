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

import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach } from 'node:test';

import type { Octokit } from '@octokit/rest';
import type * as extensionApi from '@podman-desktop/api';
import { env, process as processCore, window } from '@podman-desktop/api';
import { afterEach, describe, expect, test, vi } from 'vitest';

import type { MinikubeGithubReleaseArtifactMetadata } from './download';
import { MinikubeDownload } from './download';

// Create the OS class as well as fake extensionContext
const extensionContext: extensionApi.ExtensionContext = {
  storagePath: '/extension-folder/',
  subscriptions: [],
} as unknown as extensionApi.ExtensionContext;

// We are also testing fs, but we need fs for reading the JSON file, so we will use "vi.importActual"
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const fsActual = await vi.importActual<typeof import('node:fs')>('node:fs');

const releases: MinikubeGithubReleaseArtifactMetadata[] = [
  JSON.parse(
    fsActual.readFileSync(path.resolve(__dirname, '../tests/resources/minikube-github-release-all.json'), 'utf8'),
  ),
].map((release: { name: string; tag_name: string; id: number }) => {
  return {
    label: release.name || release.tag_name,
    tag: release.tag_name,
    id: release.id,
  };
});

vi.mock('@podman-desktop/api', () => ({
  env: {
    isWindows: false,
    isLinux: false,
    isMac: false,
  },
  process: {
    exec: vi.fn(),
  },
  window: {
    showQuickPick: vi.fn(),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
  },
}));

const listReleaseAssetsMock = vi.fn();
const listReleasesMock = vi.fn();
const getReleaseAssetMock = vi.fn();
const octokitMock: Octokit = {
  repos: {
    listReleases: listReleasesMock,
    listReleaseAssets: listReleaseAssetsMock,
    getReleaseAsset: getReleaseAssetMock,
  },
} as unknown as Octokit;

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

test('expect getLatestVersionAsset to return the first release from a list of releases', async () => {
  // Expect the test to return the first release from the list (as the function simply returns the first one)
  const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);
  vi.spyOn(minikubeDownload, 'grabLatestsReleasesMetadata').mockResolvedValue(releases);
  const result = await minikubeDownload.getLatestVersionAsset();
  expect(result).toBeDefined();
  expect(result).toEqual(releases[0]);
});

test('get release asset id should return correct id', async () => {
  const resultREST = JSON.parse(
    fsActual.readFileSync(path.resolve(__dirname, '../tests/resources/minikube-github-release-assets.json'), 'utf8'),
  );

  listReleaseAssetsMock.mockImplementation(() => {
    return { data: resultREST };
  });

  const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);
  const assetId = await minikubeDownload.getReleaseAssetId(167707968, 'linux', 'x64');

  expect(assetId).equals(167708030);
});

test('throw if there is no release asset for that os and arch', async () => {
  const resultREST = JSON.parse(
    fsActual.readFileSync(path.resolve(__dirname, '../tests/resources/minikube-github-release-assets.json'), 'utf8'),
  );

  listReleaseAssetsMock.mockImplementation(() => {
    return { data: resultREST };
  });

  const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);
  await expect(minikubeDownload.getReleaseAssetId(167707968, 'windows', 'x64')).rejects.toThrowError(
    'No asset found for windows and amd64',
  );
});

test('test download of minikube passes and that mkdir and executable mocks are called', async () => {
  const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);

  vi.spyOn(minikubeDownload, 'getReleaseAssetId').mockResolvedValue(167707925);
  vi.spyOn(minikubeDownload, 'downloadReleaseAsset').mockResolvedValue();
  vi.spyOn(minikubeDownload, 'makeExecutable').mockResolvedValue();
  const makeExecutableMock = vi.spyOn(minikubeDownload, 'makeExecutable');
  const mkdirMock = vi.spyOn(fs.promises, 'mkdir');

  // Mock that the storage path does not exist
  vi.mock('node:fs');
  vi.spyOn(fs, 'existsSync').mockImplementation(() => {
    return false;
  });

  // Mock the mkdir to return "success"
  mkdirMock.mockResolvedValue(undefined);

  await minikubeDownload.download(releases[0]);

  // Expect the mkdir and executables to have been called
  expect(mkdirMock).toHaveBeenCalled();
  expect(makeExecutableMock).toHaveBeenCalled();
});

describe('getMinikubeExtensionPath', () => {
  test('window platform should add .exe suffix', async () => {
    (env.isWindows as boolean) = true;

    const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);
    expect(minikubeDownload.getMinikubeExtensionPath()).toStrictEqual(expect.stringMatching('.*\\minikube.exe$'));
  });

  test('non-window platform should not add .exe suffix', async () => {
    (env.isWindows as boolean) = false;

    const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);
    expect(minikubeDownload.getMinikubeExtensionPath()).toStrictEqual(expect.stringMatching('.*\\minikube$'));
  });
});

describe('selectVersion', () => {
  test('should throw an error if no releases has been found', async () => {
    const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);
    vi.spyOn(minikubeDownload, 'grabLatestsReleasesMetadata').mockResolvedValue([]);

    await expect(async () => {
      await minikubeDownload.selectVersion();
    }).rejects.toThrowError('cannot grab minikube releases');
  });

  test('should throw an error if user did not select any version', async () => {
    const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);
    vi.spyOn(minikubeDownload, 'grabLatestsReleasesMetadata').mockResolvedValue([
      {
        label: 'v1.5.2',
        tag: 'v1.5.2',
        id: 55,
      },
    ]);

    vi.mocked(window.showQuickPick).mockResolvedValue(undefined);

    await expect(async () => {
      await minikubeDownload.selectVersion();
    }).rejects.toThrowError('No version selected');
  });

  test('should use quick pick api to request user to select version', async () => {
    const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);
    const release = {
      label: 'v1.5.2',
      tag: 'v1.5.2',
      id: 55,
    };
    vi.spyOn(minikubeDownload, 'grabLatestsReleasesMetadata').mockResolvedValue([release]);

    vi.mocked(window.showQuickPick).mockResolvedValue(release);

    const result = await minikubeDownload.selectVersion();
    expect(result).toStrictEqual(release);

    expect(window.showQuickPick).toHaveBeenCalledWith([release], {
      placeHolder: 'Select Kind version to download',
    });
  });

  test('should filter out existing version if cliTool is provided as argument', async () => {
    const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);
    const release = {
      label: 'v1.5.2',
      tag: 'v1.5.2',
      id: 55,
    };
    vi.spyOn(minikubeDownload, 'grabLatestsReleasesMetadata').mockResolvedValue([
      {
        label: 'v1.5.1',
        tag: 'v1.5.1',
        id: 54,
      },
      release,
    ]);

    vi.mocked(window.showQuickPick).mockResolvedValue(release);

    const result = await minikubeDownload.selectVersion({
      version: '1.5.1',
    } as unknown as extensionApi.CliTool);
    expect(result).toStrictEqual(release);

    expect(window.showQuickPick).toHaveBeenCalledWith([release], {
      placeHolder: 'Select Kind version to download',
    });
  });
});

describe('install', () => {
  test('install should download the asset provided', async () => {
    (env.isWindows as boolean) = true;
    const release: MinikubeGithubReleaseArtifactMetadata = {
      tag: 'v1.2.3',
      id: 55,
      label: 'v1.5.2',
    };
    vi.mocked(window.showInformationMessage).mockResolvedValue('Yes');

    const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);

    vi.spyOn(minikubeDownload, 'download').mockResolvedValue('/download/asset/path');

    vi.mocked(processCore.exec).mockResolvedValue({
      stdout: '',
      stderr: '',
      command: '',
    });

    await minikubeDownload.install(release);
    expect(minikubeDownload.download).toHaveBeenCalledWith(release);
  });

  test('install fallback to download path if user declined system wide install', async () => {
    (env.isWindows as boolean) = true;
    const release: MinikubeGithubReleaseArtifactMetadata = {
      tag: 'v1.2.3',
      id: 55,
      label: 'v1.5.2',
    };

    // refuse system wide installed
    vi.mocked(window.showInformationMessage).mockResolvedValue('No');

    const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);

    vi.spyOn(minikubeDownload, 'download').mockResolvedValue('/download/asset/path');

    const file = await minikubeDownload.install(release);
    expect(file).toBe('/download/asset/path');
    expect(processCore.exec).not.toHaveBeenCalled();
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'minikube binary has been successfully downloaded.\n\nWould you like to install it system-wide for accessibility on the command line? This will require administrative privileges.',
      'Yes',
      'Cancel',
    );
  });

  test('user should be notified if system-wide installed failed', async () => {
    (env.isLinux as boolean) = true;
    const release: MinikubeGithubReleaseArtifactMetadata = {
      tag: 'v1.2.3',
      id: 55,
      label: 'v1.5.2',
    };

    // refuse system wide installed
    vi.mocked(window.showInformationMessage).mockResolvedValue('Yes');
    vi.mocked(processCore.exec).mockRejectedValue(new Error('Something horrible'));

    const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);

    vi.spyOn(minikubeDownload, 'download').mockResolvedValue('/download/asset/path');

    const file = await minikubeDownload.install(release);

    expect(file).toBe('/download/asset/path');
    expect(processCore.exec).toHaveBeenCalled();
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      'Something went wrong while trying to install minikube system-wide: Error: Error making binary executable: Error: Something horrible',
    );
  });
});

describe('findMinikube', () => {
  test('should use system wide first', async () => {
    (env.isWindows as boolean) = true;

    const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);

    vi.mocked(processCore.exec).mockResolvedValue({
      stdout: '/dummy/tmp/minikube',
      stderr: '',
      command: '',
    });

    const result = await minikubeDownload.findMinikube();
    expect(result).toBe('/dummy/tmp/minikube');
  });

  test('system wide missing should fallback to local extension folder', async () => {
    (env.isWindows as boolean) = false;
    vi.mocked(processCore.exec).mockRejectedValue(new Error('dummy error'));

    const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);

    vi.mocked(fs.existsSync).mockReturnValue(true);

    const result = await minikubeDownload.findMinikube();
    expect(result).toStrictEqual(expect.stringContaining('extension-folder'));
  });

  test('system wide missing should fallback to local extension folder', async () => {
    (env.isWindows as boolean) = false;
    vi.mocked(processCore.exec).mockRejectedValue(new Error('dummy error'));

    const minikubeDownload = new MinikubeDownload(extensionContext, octokitMock);

    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await minikubeDownload.findMinikube();
    expect(result).toBeUndefined();
  });
});
