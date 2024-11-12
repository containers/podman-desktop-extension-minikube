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

import type { TelemetryLogger } from '@podman-desktop/api';
import * as extensionApi from '@podman-desktop/api';
import { beforeEach, expect, test, vi } from 'vitest';

import { createCluster } from './create-cluster';

vi.mock('@podman-desktop/api', async () => {
  return {
    Logger: {},
    kubernetes: {
      createResources: vi.fn(),
    },
    process: {
      exec: vi.fn(),
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
});

const telemetryLogUsageMock = vi.fn();
const telemetryLogErrorMock = vi.fn();
const telemetryLoggerMock = {
  logUsage: telemetryLogUsageMock,
  logError: telemetryLogErrorMock,
} as unknown as TelemetryLogger;

test('expect error is cli returns non zero exit code', async () => {
  vi.mocked(extensionApi.process.exec).mockRejectedValue(new Error('error'));
  await expect(async () => {
    await createCluster({}, undefined, '', telemetryLoggerMock);
  }).rejects.toThrowError('Failed to create minikube cluster.');

  expect(telemetryLogErrorMock).toBeCalledWith('createCluster', expect.objectContaining({ stdErr: 'error' }));
});

test('expect cluster to be created', async () => {
  vi.mocked(extensionApi.process.exec).mockResolvedValue({ stderr: '', stdout: '', command: '' });
  await createCluster({}, undefined, '', telemetryLoggerMock);
  expect(telemetryLogUsageMock).toHaveBeenNthCalledWith(
    1,
    'createCluster',
    expect.objectContaining({ driver: 'docker' }),
  );
  expect(telemetryLogErrorMock).not.toBeCalled();
  expect(extensionApi.kubernetes.createResources).not.toBeCalled();
});

test('expect cluster to be created with custom base image', async () => {
  vi.mocked(extensionApi.process.exec).mockResolvedValue({ stderr: '', stdout: '', command: '' });

  await createCluster({ 'minikube.cluster.creation.base-image': 'myCustomImage' }, undefined, '', telemetryLoggerMock);
  expect(telemetryLogUsageMock).toHaveBeenNthCalledWith(
    1,
    'createCluster',
    expect.objectContaining({ driver: 'docker' }),
  );
  expect(telemetryLogErrorMock).not.toBeCalled();
  expect(extensionApi.kubernetes.createResources).not.toBeCalled();
  expect(extensionApi.process.exec).toBeCalledWith(
    '',
    [
      'start',
      '--profile',
      'minikube',
      '--driver',
      'docker',
      '--container-runtime',
      'docker',
      '--base-image',
      'myCustomImage',
    ],
    expect.anything(),
  );
});

test('expect cluster to be created with custom mount', async () => {
  vi.mocked(extensionApi.process.exec).mockResolvedValue({ stderr: '', stdout: '', command: '' });

  await createCluster({ 'minikube.cluster.creation.mount-string': '/foo:/bar' }, undefined, '', telemetryLoggerMock);
  expect(telemetryLogUsageMock).toHaveBeenNthCalledWith(
    1,
    'createCluster',
    expect.objectContaining({ driver: 'docker' }),
  );
  expect(telemetryLogErrorMock).not.toBeCalled();
  expect(extensionApi.kubernetes.createResources).not.toBeCalled();
  expect(extensionApi.process.exec).toBeCalledWith(
    '',
    [
      'start',
      '--profile',
      'minikube',
      '--driver',
      'docker',
      '--container-runtime',
      'docker',
      '--mount',
      '--mount-string',
      '/foo:/bar',
    ],
    expect.anything(),
  );
});
