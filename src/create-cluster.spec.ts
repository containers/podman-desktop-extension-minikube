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
import type { Mock } from 'vitest';
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
  try {
    (extensionApi.process.exec as Mock).mockReturnValue({ exitCode: -1, error: 'error' });
    await createCluster({}, undefined, '', telemetryLoggerMock);
  } catch (err) {
    expect(err).to.be.a('Error');
    expect(err.message).equal('Failed to create minikube cluster. error');
    expect(telemetryLogErrorMock).toBeCalledWith('createCluster', expect.objectContaining({ error: 'error' }));
  }
});

test('expect cluster to be created', async () => {
  (extensionApi.process.exec as Mock).mockReturnValue({ exitCode: 0 });
  await createCluster({}, undefined, '', telemetryLoggerMock);
  expect(telemetryLogUsageMock).toHaveBeenNthCalledWith(
    1,
    'createCluster',
    expect.objectContaining({ driver: 'docker' }),
  );
  expect(telemetryLogErrorMock).not.toBeCalled();
  expect(extensionApi.kubernetes.createResources).not.toBeCalled();
});

test('expect error if Kubernetes reports error', async () => {
  try {
    (extensionApi.process.exec as Mock).mockReturnValue({ exitCode: 0 });
    const logger = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };
    (extensionApi.kubernetes.createResources as Mock).mockRejectedValue(new Error('Kubernetes error'));
    await createCluster({}, logger, '', telemetryLoggerMock);
  } catch (err) {
    expect(extensionApi.kubernetes.createResources).toBeCalled();
    expect(err).to.be.a('Error');
    expect(err.message).equal('Failed to create minikube cluster. Kubernetes error');
    expect(telemetryLogErrorMock).toBeCalledWith(
      'createCluster',
      expect.objectContaining({ error: 'Kubernetes error' }),
    );
  }
});

test('expect cluster to be created with custom base image', async () => {
  (extensionApi.process.exec as Mock).mockReturnValue({ exitCode: 0 });
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
  (extensionApi.process.exec as Mock).mockReturnValue({ exitCode: 0 });
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
