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

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as extensionApi from '@podman-desktop/api';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { detectMinikube, getMinikubePath, getMinikubeHome, installBinaryToSystem } from './util';
import type { MinikubeInstaller } from './minikube-installer';
import * as fs from 'node:fs';
import * as path from 'node:path';

const { config } = vi.hoisted(() => {
  return {
    config: {
      get: vi.fn(),
      has: vi.fn(),
      update: vi.fn(),
    },
  };
});

vi.mock('@podman-desktop/api', async () => {
  return {
    window: {
      showInformationMessage: vi.fn().mockReturnValue(Promise.resolve('Yes')),
      showErrorMessage: vi.fn(),
      withProgress: vi.fn(),
      showNotification: vi.fn(),
    },
    process: {
      exec: vi.fn(),
    },
    env: {
      isMac: vi.fn(),
      isWindows: vi.fn(),
      isLinux: vi.fn(),
    },
    configuration: {
      getConfiguration: (): extensionApi.Configuration => config,
    },
    ProgressLocation: {
      APP_ICON: 1,
    },
    Disposable: {
      from: vi.fn(),
    },
  };
});

vi.mock('node:child_process');

// mock exists sync
vi.mock('node:fs', async () => {
  return {
    existsSync: vi.fn(),
  };
});

const originalProcessEnv = process.env;
beforeEach(() => {
  vi.resetAllMocks();
  process.env = {};
});

afterEach(() => {
  process.env = originalProcessEnv;
});

test('getMinikubePath on macOS', async () => {
  vi.mocked(extensionApi.env).isMac = true;

  const computedPath = getMinikubePath();
  expect(computedPath).toEqual('/usr/local/bin:/opt/homebrew/bin:/opt/local/bin:/opt/podman/bin');
});

test('getMinikubePath on macOS with existing PATH', async () => {
  const existingPATH = '/my-existing-path';
  process.env.PATH = existingPATH;
  vi.mocked(extensionApi.env).isMac = true;

  const computedPath = getMinikubePath();
  expect(computedPath).toEqual(`${existingPATH}:/usr/local/bin:/opt/homebrew/bin:/opt/local/bin:/opt/podman/bin`);
});

test('getMinikubeHome with empty configuration property', async () => {
  const existingEnvHome = '/my-existing-minikube-home';
  const existingConfigHome = '';
  process.env.MINIKUBE_HOME = existingEnvHome;

  const spyGetConfiguration = vi.spyOn(config, 'get');
  spyGetConfiguration.mockReturnValue(existingConfigHome);

  const computedHome = getMinikubeHome();

  expect(computedHome).toEqual(existingEnvHome);
  expect(computedHome).not.toEqual(existingConfigHome);
});

test('getMinikubeHome with empty configuration property', async () => {
  const existingEnvHome = '/my-existing-minikube-home';
  const existingConfigHome = '/my-another-existing-minikube-home';
  process.env.MINIKUBE_HOME = existingEnvHome;

  const spyGetConfiguration = vi.spyOn(config, 'get');
  spyGetConfiguration.mockReturnValue(existingConfigHome);

  const computedHome = getMinikubeHome();

  expect(computedHome).not.toEqual(existingEnvHome);
  expect(computedHome).toEqual(existingConfigHome);
});

test('detectMinikube', async () => {
  const fakeMinikubeInstaller = {
    getAssetInfo: vi.fn(),
  } as unknown as MinikubeInstaller;

  const execMock = vi.spyOn(extensionApi.process, 'exec').mockResolvedValue({
    command: '',
    stderr: '',
    stdout: '',
  });

  const result = await detectMinikube('', fakeMinikubeInstaller);
  expect(result).toEqual('minikube');

  // expect not called getAssetInfo
  expect(fakeMinikubeInstaller.getAssetInfo).not.toBeCalled();

  expect(execMock).toBeCalled();
  // expect right parameters
  expect(execMock.mock.calls[0][0]).toEqual('minikube');
  expect(execMock.mock.calls[0][1]).toEqual(['version']);
});

test('error: expect installBinaryToSystem to fail with a non existing binary', async () => {
  // Mock the platform to be linux
  Object.defineProperty(process, 'platform', {
    value: 'linux',
  });

  vi.spyOn(extensionApi.process, 'exec').mockImplementation(
    () =>
      new Promise<extensionApi.RunResult>((_, reject) => {
        const error: extensionApi.RunError = {
          name: '',
          message: 'Command failed',
          exitCode: 1603,
          command: 'command',
          stdout: 'stdout',
          stderr: 'stderr',
          cancelled: false,
          killed: false,
        };

        reject(error);
      }),
  );

  // Expect await installBinaryToSystem to throw an error
  await expect(installBinaryToSystem('test', 'tmpBinary')).rejects.toThrowError();
});

test('success: installBinaryToSystem on mac with /usr/local/bin already created', async () => {
  // Mock the platform to be darwin
  Object.defineProperty(process, 'platform', {
    value: 'darwin',
  });

  // Mock existsSync to be true since within the function it's doing: !fs.existsSync(localBinDir)
  vi.spyOn(fs, 'existsSync').mockImplementation(() => {
    return true;
  });

  // Run installBinaryToSystem which will trigger the spyOn mock
  await installBinaryToSystem('test', 'tmpBinary');

  // check called with admin being true
  expect(extensionApi.process.exec).toBeCalledWith('chmod', expect.arrayContaining(['+x', 'test']));
  expect(extensionApi.process.exec).toHaveBeenNthCalledWith(
    2,
    'cp',
    ['test', `${path.sep}usr${path.sep}local${path.sep}bin${path.sep}tmpBinary`],
    { isAdmin: true },
  );
});

test('expect: installBinaryToSystem on linux with /usr/local/bin NOT created yet (expect mkdir -p command)', async () => {
  // Mock the platform to be darwin
  Object.defineProperty(process, 'platform', {
    value: 'linux',
  });

  // Mock existsSync to be false since within the function it's doing: !fs.existsSync(localBinDir)
  vi.spyOn(fs, 'existsSync').mockImplementation(() => {
    return false;
  });

  // Run installBinaryToSystem which will trigger the spyOn mock
  await installBinaryToSystem('test', 'tmpBinary');

  expect(extensionApi.process.exec).toBeCalledWith('chmod', expect.arrayContaining(['+x', 'test']));

  // check called with admin being true
  expect(extensionApi.process.exec).toBeCalledWith(
    'mkdir',
    ['-p', '/usr/local/bin'],
    expect.objectContaining({ isAdmin: true }),
  );
  expect(extensionApi.process.exec).toBeCalledWith(
    'cp',
    ['test', `${path.sep}usr${path.sep}local${path.sep}bin${path.sep}tmpBinary`],
    expect.objectContaining({ isAdmin: true }),
  );
});
