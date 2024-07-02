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

/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, expect, test, vi } from 'vitest';
import * as podmanDesktopApi from '@podman-desktop/api';
import { refreshMinikubeClustersOnProviderConnectionUpdate } from './extension';

vi.mock('@podman-desktop/api', async () => {
  return {
    provider: {
      onDidUpdateContainerConnection: vi.fn(),
    },

    containerEngine: {
      listContainers: vi.fn(),
    },

    process: {
      exec: vi.fn(),
      env: {},
    },

    env: {
      isMac: false,
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

test('check we received notifications ', async () => {
  const onDidUpdateContainerConnectionMock = vi.fn();
  (podmanDesktopApi.provider as any).onDidUpdateContainerConnection = onDidUpdateContainerConnectionMock;

  const listContainersMock = vi.fn();
  (podmanDesktopApi.containerEngine as any).listContainers = listContainersMock;
  listContainersMock.mockResolvedValue([]);

  let callbackCalled = false;
  onDidUpdateContainerConnectionMock.mockImplementation((callback: any) => {
    callback();
    callbackCalled = true;
  });

  const fakeProvider = {} as unknown as podmanDesktopApi.Provider;
  refreshMinikubeClustersOnProviderConnectionUpdate(fakeProvider);
  expect(callbackCalled).toBeTruthy();
  expect(listContainersMock).toBeCalledTimes(1);
});

test('verify that the minikube cli is used to start/stop the minikube container', async () => {
  const onDidUpdateContainerConnectionMock = vi.fn();
  (podmanDesktopApi.provider as any).onDidUpdateContainerConnection = onDidUpdateContainerConnectionMock;

  const listContainersMock = vi.fn();
  (podmanDesktopApi.containerEngine as any).listContainers = listContainersMock;
  listContainersMock.mockResolvedValue([
    {
      Labels: {
        'name.minikube.sigs.k8s.io': 'minikube',
      },
      State: 'stopped',
      Ports: [],
      engineType: 'podman',
      engineId: 'engine',
      Id: '1',
    } as unknown as podmanDesktopApi.ContainerInfo,
  ]);

  onDidUpdateContainerConnectionMock.mockImplementation((callback: any) => {
    callback();
  });

  const connections: podmanDesktopApi.KubernetesProviderConnection[] = [];
  const fakeProvider = {
    registerKubernetesProviderConnection: vi
      .fn()
      .mockImplementation((connection: podmanDesktopApi.KubernetesProviderConnection) => {
        connections.push(connection);
      }),
  } as unknown as podmanDesktopApi.Provider;
  const mockExec = vi.spyOn(podmanDesktopApi.process, 'exec');
  refreshMinikubeClustersOnProviderConnectionUpdate(fakeProvider);

  await vi.waitUntil(() => connections.length > 0, { timeout: 5000 });

  await connections[0].lifecycle.start?.({} as unknown as podmanDesktopApi.LifecycleContext);

  expect(mockExec).toBeCalledWith(undefined, ['start', '--profile', 'minikube'], expect.any(Object));

  await connections[0].lifecycle.stop?.({} as unknown as podmanDesktopApi.LifecycleContext);

  expect(mockExec).toBeCalledWith(
    undefined,
    ['stop', '--profile', 'minikube', '--keep-context-active'],
    expect.any(Object),
  );
});
