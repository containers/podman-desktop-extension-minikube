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

import * as podmanDesktopApi from '@podman-desktop/api';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { MinikubeGithubReleaseArtifactMetadata } from './download';
import { MinikubeDownload } from './download';
import { activate, deactivate, refreshMinikubeClustersOnProviderConnectionUpdate } from './extension';
import { getMinikubeVersion } from './util';

vi.mock('./download', () => ({
  MinikubeDownload: vi.fn(),
}));

vi.mock('./util', () => ({
  deleteFile: vi.fn(),
  getBinarySystemPath: vi.fn(),
  getMinikubeHome: vi.fn(),
  getMinikubePath: vi.fn(),
  getMinikubeVersion: vi.fn(),
}));

vi.mock('@podman-desktop/api', async () => {
  return {
    provider: {
      onDidUpdateContainerConnection: vi.fn(),
      onDidRegisterContainerConnection: vi.fn(),
      onDidUnregisterContainerConnection: vi.fn(),
      onDidUpdateProvider: vi.fn(),
      createProvider: vi.fn(),
    },

    containerEngine: {
      listContainers: vi.fn(),
      onEvent: vi.fn(),
    },
    configuration: {
      getConfiguration: vi.fn(),
    },

    process: {
      exec: vi.fn(),
      env: {},
    },

    env: {
      isMac: false,
      createTelemetryLogger: vi.fn(),
    },
    cli: {
      createCliTool: vi.fn(),
    },
    commands: {
      registerCommand: vi.fn(),
    },
  };
});

const providerMock: podmanDesktopApi.Provider = {
  setKubernetesProviderConnectionFactory: vi.fn(),
  dispose: vi.fn(),
} as unknown as podmanDesktopApi.Provider;

const cliToolMock: podmanDesktopApi.CliTool = {
  onDidUpdateVersion: vi.fn(),
  onDidUninstall: vi.fn(),
  registerInstaller: vi.fn(),
  registerUpdate: vi.fn(),
  dispose: vi.fn(),
} as unknown as podmanDesktopApi.CliTool;

const minikubeDownloadMock: MinikubeDownload = {
  findMinikube: vi.fn(),
  getLatestVersionAsset: vi.fn(),
  install: vi.fn(),
  getMinikubeExtensionPath: vi.fn(),
} as unknown as MinikubeDownload;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetAllMocks();

  vi.mocked(MinikubeDownload).mockReturnValue(minikubeDownloadMock);
  vi.mocked(minikubeDownloadMock.getMinikubeExtensionPath).mockReturnValue('/home/path/minikube');
  vi.mocked(podmanDesktopApi.cli.createCliTool).mockReturnValue(cliToolMock);
  vi.mocked(podmanDesktopApi.provider.createProvider).mockReturnValue(providerMock);
  vi.mocked(podmanDesktopApi.containerEngine.listContainers).mockResolvedValue([]);
  vi.mocked(podmanDesktopApi.commands.registerCommand).mockReturnValue({ dispose: vi.fn() });
});

afterEach(() => {
  deactivate();
});

test('check we received notifications ', async () => {
  const onDidUpdateContainerConnectionMock = vi.fn();
  (podmanDesktopApi.provider as any).onDidUpdateContainerConnection = onDidUpdateContainerConnectionMock;

  let callbackCalled = false;
  onDidUpdateContainerConnectionMock.mockImplementation((callback: any) => {
    callback();
    callbackCalled = true;
  });

  const fakeProvider = {} as unknown as podmanDesktopApi.Provider;
  refreshMinikubeClustersOnProviderConnectionUpdate(fakeProvider);
  expect(callbackCalled).toBeTruthy();
  expect(podmanDesktopApi.containerEngine.listContainers).toBeCalledTimes(1);
});

test('verify that the minikube cli is used to start/stop the minikube container', async () => {
  const onDidUpdateContainerConnectionMock = vi.fn();
  (podmanDesktopApi.provider as any).onDidUpdateContainerConnection = onDidUpdateContainerConnectionMock;

  vi.mocked(podmanDesktopApi.containerEngine.listContainers).mockResolvedValue([
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

  await connections[0].lifecycle?.start?.({} as unknown as podmanDesktopApi.LifecycleContext);

  expect(mockExec).toBeCalledWith(undefined, ['start', '--profile', 'minikube'], expect.any(Object));

  await connections[0].lifecycle?.stop?.({} as unknown as podmanDesktopApi.LifecycleContext);

  expect(mockExec).toBeCalledWith(
    undefined,
    ['stop', '--profile', 'minikube', '--keep-context-active'],
    expect.any(Object),
  );
});

describe('minikube cli tool', () => {
  test('activate should register cli tool', async () => {
    // mock no existing minikube
    vi.mocked(minikubeDownloadMock.findMinikube).mockResolvedValue(undefined);

    // activate
    await activate({ subscriptions: [] } as unknown as podmanDesktopApi.ExtensionContext);

    // 1. should check for existing minikube executable
    expect(minikubeDownloadMock.findMinikube).toHaveBeenCalledOnce();

    // 2. extension should register a cli tool
    expect(podmanDesktopApi.cli.createCliTool).toHaveBeenCalledWith({
      displayName: 'Minikube',
      name: 'minikube',
      version: undefined,
      path: undefined,
      markdownDescription: expect.any(String),
      images: expect.anything(),
    });

    // 3. extension should register install
    expect(cliToolMock.registerInstaller).toHaveBeenCalledWith({
      selectVersion: expect.any(Function),
      doInstall: expect.any(Function),
      doUninstall: expect.any(Function),
    });
  });

  test('findMinikube in external path should specify installationSource', async () => {
    // mock existing minikube
    vi.mocked(minikubeDownloadMock.findMinikube).mockResolvedValue('/external/minikube');
    vi.mocked(getMinikubeVersion).mockResolvedValue('5.66.7');

    // activate
    await activate({ subscriptions: [] } as unknown as podmanDesktopApi.ExtensionContext);

    // 1. should check for existing minikube executable
    expect(minikubeDownloadMock.findMinikube).toHaveBeenCalledOnce();

    // 2. extension should register a cli tool with installationSource external
    expect(podmanDesktopApi.cli.createCliTool).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/external/minikube',
        version: '5.66.7',
        installationSource: 'external',
      }),
    );
  });

  test('existing minikube should cli tool with path and version defined', async () => {
    // mock existing minikube
    vi.mocked(minikubeDownloadMock.findMinikube).mockResolvedValue('/home/path/minikube');
    vi.mocked(getMinikubeVersion).mockResolvedValue('5.66.7');

    // activate
    await activate({ subscriptions: [] } as unknown as podmanDesktopApi.ExtensionContext);

    // extension should register a cli tool
    expect(podmanDesktopApi.cli.createCliTool).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '/home/path/minikube',
        version: '5.66.7',
        installationSource: 'extension',
      }),
    );
  });

  test('onDidUpdateVersion should check for update', async () => {
    // mock existing minikube
    vi.mocked(minikubeDownloadMock.findMinikube).mockResolvedValue('/home/path/minikube');
    vi.mocked(getMinikubeVersion).mockResolvedValue('5.66.7');

    // mock latest version greater than current
    vi.mocked(minikubeDownloadMock.getLatestVersionAsset).mockResolvedValue({
      tag: 'v5.67.0',
    } as unknown as MinikubeGithubReleaseArtifactMetadata);

    // activate
    await activate({ subscriptions: [] } as unknown as podmanDesktopApi.ExtensionContext);

    expect(cliToolMock.onDidUpdateVersion).toHaveBeenCalledOnce();

    // call the on onDidUpdateVersion listener
    await vi.mocked(cliToolMock.onDidUpdateVersion).mock.calls[0][0]('v5.66.8');

    expect(cliToolMock.registerUpdate).toHaveBeenCalledWith({
      doUpdate: expect.any(Function),
      version: '5.67.0',
    });
  });

  test('uninstall event should dispose provider and command', async () => {
    // mock existing minikube
    vi.mocked(minikubeDownloadMock.findMinikube).mockResolvedValue('/home/path/minikube');
    vi.mocked(getMinikubeVersion).mockResolvedValue('5.66.7');
    const disposableMock = vi.fn();
    vi.mocked(podmanDesktopApi.commands.registerCommand).mockReturnValue({
      dispose: disposableMock,
    });

    // activate
    await activate({ subscriptions: [] } as unknown as podmanDesktopApi.ExtensionContext);

    // extension should create provider
    expect(podmanDesktopApi.provider.createProvider).toHaveBeenCalledOnce();
    expect(podmanDesktopApi.commands.registerCommand).toHaveBeenCalledOnce();

    expect(cliToolMock.onDidUninstall).toHaveBeenCalledOnce();

    // ensure the provider is not disposed
    expect(providerMock.dispose).not.toHaveBeenCalled();

    // call the on uninstall listener
    vi.mocked(cliToolMock.onDidUninstall).mock.calls[0][0]();

    expect(providerMock.dispose).toHaveBeenCalled();
    expect(disposableMock).toHaveBeenCalled();
  });

  test('onDidUpdateVersion event should create provider', async () => {
    // mock no existing minikube
    vi.mocked(minikubeDownloadMock.findMinikube).mockResolvedValue(undefined);

    // activate
    await activate({ subscriptions: [] } as unknown as podmanDesktopApi.ExtensionContext);

    // extension should not create provider
    expect(podmanDesktopApi.provider.createProvider).not.toHaveBeenCalled();

    expect(cliToolMock.onDidUpdateVersion).toHaveBeenCalledOnce();

    // call the on onDidUpdateVersion listener
    vi.mocked(cliToolMock.onDidUpdateVersion).mock.calls[0][0]('1.55.6');

    expect(podmanDesktopApi.provider.createProvider).toHaveBeenCalled();
  });
});
