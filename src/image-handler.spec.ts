/**********************************************************************
 * Copyright (C) 2023 Red Hat, Inc.
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

import * as extensionApi from '@podman-desktop/api';
import { beforeEach, expect, test, vi } from 'vitest';

import { ImageHandler } from './image-handler';
import { getMinikubeAdditionalEnvs } from './util';

let imageHandler: ImageHandler;
vi.mock('@podman-desktop/api', async () => {
  return {
    containerEngine: {
      saveImage: vi.fn(),
    },
    process: {
      exec: vi.fn(),
    },
    window: {
      showNotification: vi.fn(),
      showInformationMessage: vi.fn(),
    },
  };
});

vi.mock('./util', async () => {
  return {
    getMinikubeAdditionalEnvs: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  imageHandler = new ImageHandler();
});

test('expect error to be raised if no image is given', async () => {
  await expect(async () => {
    await imageHandler.moveImage({ engineId: 'dummy' }, [], '/tmp/minikube');
  }).rejects.toThrowError('Image selection not supported yet');
});

test('expect error to be raised if no clusters are given', async () => {
  await expect(async () => {
    await imageHandler.moveImage({ engineId: 'dummy', name: 'myimage' }, [], '/tmp/minikube');
  }).rejects.toThrowError('No minikube clusters to push to');
});

test('expect image name to be given', async () => {
  vi.mocked(extensionApi.containerEngine.saveImage).mockImplementation(
    async (_engineId: string, _id: string, filename: string): Promise<void> => {
      await fs.promises.open(filename, 'w');
    },
  );

  await imageHandler.moveImage(
    { engineId: 'dummy', name: 'myimage' },
    [{ name: 'c1', engineType: 'podman', status: 'started', apiPort: 8443 }],
    '/tmp/minikube',
  );
  expect(extensionApi.containerEngine.saveImage).toBeCalledWith('dummy', 'myimage', expect.anything());
});

test('expect getting showInformationMessage when image is pushed', async () => {
  vi.mocked(extensionApi.containerEngine.saveImage).mockImplementation(
    async (_engineId: string, _id: string, filename: string): Promise<void> => {
      await fs.promises.open(filename, 'w');
    },
  );

  await imageHandler.moveImage(
    { engineId: 'dummy', name: 'myimage' },
    [{ name: 'c1', engineType: 'podman', status: 'started', apiPort: 8443 }],
    '/tmp/minikube',
  );
  expect(extensionApi.window.showInformationMessage).toBeCalledWith('Image myimage pushed to minikube cluster: c1');
});

test('expect image name and tag to be given', async () => {
  vi.mocked(extensionApi.containerEngine.saveImage).mockImplementation(
    async (_engineId: string, _id: string, filename: string): Promise<void> => {
      await fs.promises.open(filename, 'w');
    },
  );

  await imageHandler.moveImage(
    { engineId: 'dummy', name: 'myimage', tag: '1.0' },
    [{ name: 'c1', engineType: 'podman', status: 'started', apiPort: 8443 }],
    '/tmp/minikube',
  );
  expect(extensionApi.containerEngine.saveImage).toBeCalledWith('dummy', 'myimage:1.0', expect.anything());
});

test('expect cli is called with right PATH', async () => {
  vi.mocked(extensionApi.containerEngine.saveImage).mockImplementation(
    async (_engineId: string, _id: string, filename: string): Promise<void> => {
      await fs.promises.open(filename, 'w');
    },
  );
  vi.mocked(getMinikubeAdditionalEnvs).mockReturnValue({ PATH: 'my-custom-path' });

  await imageHandler.moveImage(
    { engineId: 'dummy', name: 'myimage' },
    [{ name: 'c1', engineType: 'podman', status: 'started', apiPort: 8443 }],
    '/tmp/minikube',
  );
  expect(getMinikubeAdditionalEnvs).toBeCalled();

  expect(extensionApi.process.exec).toBeCalledTimes(1);
  // grab the env parameter of the first call to process.Exec
  const props = vi.mocked(extensionApi.process.exec).mock.calls[0][2];
  expect(props).to.have.property('env');
  const env = props?.env;
  expect(env).to.have.property('PATH');
  expect(env?.PATH).toBe('my-custom-path');
});
