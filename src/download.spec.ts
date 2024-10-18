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
import { env } from '@podman-desktop/api';
import { afterEach, describe,expect, test, vi } from 'vitest';

import type { MinikubeGithubReleaseArtifactMetadata } from './download';
import { MinikubeDownload } from './download';

// Create the OS class as well as fake extensionContext
const extensionContext: extensionApi.ExtensionContext = {
  storagePath: '/fake/path',
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
