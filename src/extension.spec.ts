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

import type {
  CancellationToken,
  CliTool,
  ContainerInfo,
  ExtensionContext,
  KubernetesProviderConnection,
  LifecycleContext,
  Progress,
  Provider,
  StatusBarItem,
  TelemetryLogger,
} from '@podman-desktop/api';
import { cli, commands, containerEngine, process as processCore, provider, window } from '@podman-desktop/api';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { MinikubeGithubReleaseArtifactMetadata } from './download';
import { MinikubeDownload } from './download';
import {
  activate,
  deactivate,
  refreshMinikubeClustersOnProviderConnectionUpdate,
  registerCommandInstall,
} from './extension';
import { findMinikube, installBinaryToSystem } from './util';

vi.mock('./util', () => ({
  findMinikube: vi.fn(),
  getMinikubeHome: vi.fn(),
  getMinikubePath: vi.fn(),
  installBinaryToSystem: vi.fn(),
}));

vi.mock('./download', () => ({
  MinikubeDownload: vi.fn(),
}));

vi.mock('@podman-desktop/api', async () => ({
  provider: {
    onDidUpdateContainerConnection: vi.fn(),
    onDidRegisterContainerConnection: vi.fn(),
    onDidUnregisterContainerConnection: vi.fn(),
    onDidUpdateProvider: vi.fn(),
    createProvider: vi.fn(),
  },
  commands: {
    registerCommand: vi.fn(),
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
  window: {
    createStatusBarItem: vi.fn(),
    showInformationMessage: vi.fn(),
    withProgress: vi.fn(),
  },
  env: {
    isMac: false,
    createTelemetryLogger: vi.fn(),
  },
  cli: {
    createCliTool: vi.fn(),
  },
  ProgressLocation: {
    TASK_WIDGET: 2,
  },
}));

const minikubeDownload: MinikubeDownload = {
  getLatestVersionAsset: vi.fn(),
  download: vi.fn(),
} as unknown as MinikubeDownload;

const extensionContext: ExtensionContext = {
  subscriptions: [],
} as unknown as ExtensionContext;

const telemetryLogger: TelemetryLogger = {} as unknown as TelemetryLogger;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.createStatusBarItem).mockReturnValue({
    alignment: 'LEFT',
    enabled: false,
    priority: 0,
    dispose: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
  });

  vi.mocked(provider.createProvider).mockReturnValue({
    setKubernetesProviderConnectionFactory: vi.fn(),
    registerKubernetesProviderConnection: () => ({
      dispose: vi.fn(),
    }),
  } as unknown as Provider);

  vi.mocked(MinikubeDownload).mockReturnValue(minikubeDownload);

  vi.mocked(containerEngine.listContainers).mockResolvedValue([]);

  vi.mocked(installBinaryToSystem).mockResolvedValue('/system-wide/path/minikube');

  vi.mocked(minikubeDownload.getLatestVersionAsset).mockResolvedValue({
    tag: 'v1.56.0',
  } as unknown as MinikubeGithubReleaseArtifactMetadata);
});

afterEach(() => {
  deactivate();
});

test('check we received notifications ', async () => {
  let callbackCalled = false;
  vi.mocked(provider.onDidUpdateContainerConnection).mockImplementation((callback: any) => {
    callback();
    callbackCalled = true;
  });

  const fakeProvider = {} as unknown as Provider;
  refreshMinikubeClustersOnProviderConnectionUpdate(fakeProvider);
  expect(callbackCalled).toBeTruthy();
  expect(containerEngine.listContainers).toBeCalledTimes(1);
});

test('verify that the minikube cli is used to start/stop the minikube container', async () => {
  vi.mocked(containerEngine.listContainers).mockResolvedValue([
    {
      Labels: {
        'name.minikube.sigs.k8s.io': 'minikube',
      },
      State: 'stopped',
      Ports: [],
      engineType: 'podman',
      engineId: 'engine',
      Id: '1',
    } as unknown as ContainerInfo,
  ]);

  vi.mocked(provider.onDidUpdateContainerConnection).mockImplementation((callback: any) => {
    callback();
  });

  const connections: KubernetesProviderConnection[] = [];
  const fakeProvider = {
    registerKubernetesProviderConnection: vi.fn().mockImplementation((connection: KubernetesProviderConnection) => {
      connections.push(connection);
    }),
  } as unknown as Provider;
  refreshMinikubeClustersOnProviderConnectionUpdate(fakeProvider);

  await vi.waitUntil(() => connections.length > 0, { timeout: 5000 });

  await connections[0].lifecycle.start?.({} as unknown as LifecycleContext);

  expect(processCore.exec).toBeCalledWith(undefined, ['start', '--profile', 'minikube'], expect.any(Object));

  await connections[0].lifecycle.stop?.({} as unknown as LifecycleContext);

  expect(processCore.exec).toBeCalledWith(
    undefined,
    ['stop', '--profile', 'minikube', '--keep-context-active'],
    expect.any(Object),
  );
});

describe('registerCommandInstall', () => {
  test('should register the commands in the api', async () => {
    registerCommandInstall(extensionContext, telemetryLogger, minikubeDownload, {} as unknown as StatusBarItem);

    expect(commands.registerCommand).toHaveBeenCalledWith('minikube.install', expect.any(Function));
  });

  test('command execution should ask user confirmation', async () => {
    let listener: (() => Promise<void>) | undefined;
    vi.mocked(commands.registerCommand).mockImplementation((_command, mListener) => {
      listener = mListener;
      return {
        dispose: vi.fn(),
      };
    });
    registerCommandInstall(extensionContext, telemetryLogger, minikubeDownload, {} as unknown as StatusBarItem);
    expect(listener).toBeDefined();
    vi.mocked(window.showInformationMessage).mockResolvedValue('Cancel');

    await listener?.();

    expect(window.showInformationMessage).toHaveBeenCalledWith(
      'The minikube binary is required for local Kubernetes development, would you like to download it?',
      'Yes',
      'Cancel',
    );
  });

  test('command execution should create task', async () => {
    let listener: (() => Promise<void>) | undefined;
    vi.mocked(commands.registerCommand).mockImplementation((_command, mListener) => {
      listener = mListener;
      return {
        dispose: vi.fn(),
      };
    });
    registerCommandInstall(extensionContext, telemetryLogger, minikubeDownload, {} as unknown as StatusBarItem);
    expect(listener).toBeDefined();
    vi.mocked(window.showInformationMessage).mockResolvedValue('Yes');

    await listener?.();

    expect(window.withProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Installing minikube',
      }),
      expect.any(Function),
    );
  });

  test('command task should report progress', async () => {
    let cmdListener: (() => Promise<void>) | undefined;
    vi.mocked(commands.registerCommand).mockImplementation((_command, mListener) => {
      cmdListener = mListener;
      return {
        dispose: vi.fn(),
      };
    });
    const statusBarItemDipose = vi.fn();
    registerCommandInstall(extensionContext, telemetryLogger, minikubeDownload, {
      dispose: statusBarItemDipose,
    } as unknown as StatusBarItem);
    expect(cmdListener).toBeDefined();
    // only confirm download in extension folder not system-wide install
    vi.mocked(window.showInformationMessage).mockResolvedValue('Yes');

    const progressMock: Progress<{ message?: string; increment?: number }> = {
      report: vi.fn(),
    };
    vi.mocked(window.withProgress).mockImplementation((_options, task) => {
      return task(progressMock, {} as unknown as CancellationToken);
    });

    await cmdListener?.();

    await vi.waitFor(() => {
      expect(minikubeDownload.getLatestVersionAsset).toHaveBeenCalled();
      expect(minikubeDownload.download).toHaveBeenCalled();
    });

    expect(progressMock.report).toHaveBeenCalledWith({ message: `Downloading minikube 1.56.0` });
    // the status bar should be disposed on success
    expect(statusBarItemDipose).toHaveBeenCalled();
  });

  test('status bar item should not be disposed if download fails', async () => {
    vi.mocked(minikubeDownload.download).mockRejectedValue(new Error('random download error'));

    let cmdListener: (() => Promise<void>) | undefined;
    vi.mocked(commands.registerCommand).mockImplementation((_command, mListener) => {
      cmdListener = mListener;
      return {
        dispose: vi.fn(),
      };
    });
    const statusBarItemDipose = vi.fn();
    registerCommandInstall(extensionContext, telemetryLogger, minikubeDownload, {
      dispose: statusBarItemDipose,
    } as unknown as StatusBarItem);
    expect(cmdListener).toBeDefined();
    // only confirm download in extension folder not system-wide install
    vi.mocked(window.showInformationMessage).mockResolvedValue('Yes');

    vi.mocked(window.withProgress).mockImplementation((_options, task) => {
      return task({ report: vi.fn() }, {} as unknown as CancellationToken);
    });

    await expect(async () => {
      await cmdListener?.();
    }).rejects.toThrowError('random download error');

    // the status bar should be disposed on success
    expect(statusBarItemDipose).not.toHaveBeenCalled();
  });

  test('updateVersion should contain the system wide path and version', async () => {
    const updateVersionMock = vi.fn();
    vi.mocked(cli.createCliTool).mockReturnValue({
      registerUpdate: vi.fn(),
      updateVersion: updateVersionMock,
      dispose: vi.fn(),
    } as unknown as CliTool);

    let cmdListener: (() => Promise<void>) | undefined;
    vi.mocked(commands.registerCommand).mockImplementation((_command, mListener) => {
      cmdListener = mListener;
      return {
        dispose: vi.fn(),
      };
    });
    vi.mocked(window.showInformationMessage).mockResolvedValue('Yes');

    vi.mocked(window.withProgress).mockImplementation((_options, task) => {
      return task({ report: vi.fn() }, {} as unknown as CancellationToken);
    });

    await activate({ subscriptions: [] } as unknown as ExtensionContext);

    await vi.waitFor(() => {
      expect(cli.createCliTool).toHaveBeenCalled();
    });

    await cmdListener?.();

    expect(updateVersionMock).toHaveBeenCalledWith({
      version: '1.56.0',
      path: '/system-wide/path/minikube',
    });
  });

  test('updateVersion should contain the extension folder path if installBinaryToSystem rejects', async () => {
    vi.mocked(installBinaryToSystem).mockRejectedValue(new Error('dummy error'));
    const updateVersionMock = vi.fn();
    vi.mocked(cli.createCliTool).mockReturnValue({
      registerUpdate: vi.fn(),
      updateVersion: updateVersionMock,
      dispose: vi.fn(),
    } as unknown as CliTool);

    vi.mocked(minikubeDownload.download).mockResolvedValue('/extension-folder/minikube');

    let cmdListener: (() => Promise<void>) | undefined;
    vi.mocked(commands.registerCommand).mockImplementation((_command, mListener) => {
      cmdListener = mListener;
      return {
        dispose: vi.fn(),
      };
    });

    vi.mocked(window.showInformationMessage).mockResolvedValue('Yes');

    vi.mocked(window.withProgress).mockImplementation((_options, task) => {
      return task({ report: vi.fn() }, {} as unknown as CancellationToken);
    });

    await activate({ subscriptions: [] } as unknown as ExtensionContext);

    await vi.waitFor(() => {
      expect(cli.createCliTool).toHaveBeenCalled();
    });

    await cmdListener?.();

    expect(updateVersionMock).toHaveBeenCalledWith({
      version: '1.56.0',
      path: '/extension-folder/minikube',
    });
  });

  test('command installation complete should register provider', async () => {
    let cmdListener: (() => Promise<void>) | undefined;
    vi.mocked(commands.registerCommand).mockImplementation((_command, mListener) => {
      cmdListener = mListener;
      return {
        dispose: vi.fn(),
      };
    });

    vi.mocked(window.showInformationMessage).mockResolvedValueOnce('Yes');
    vi.mocked(window.withProgress).mockImplementation((_options, task) => {
      return task({ report: vi.fn() }, {} as unknown as CancellationToken);
    });

    registerCommandInstall(extensionContext, telemetryLogger, minikubeDownload, {
      dispose: vi.fn(),
    } as unknown as StatusBarItem);
    expect(cmdListener).toBeDefined();
    await cmdListener?.();

    expect(provider.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'minikube',
      }),
    );
  });
});

describe('activate - status bar item', () => {
  test('activate should register status bar when minikube not available', async () => {
    vi.mocked(findMinikube).mockResolvedValue(undefined);

    await activate({ subscriptions: [] } as unknown as ExtensionContext);

    expect(findMinikube).toHaveBeenCalled();
    expect(window.createStatusBarItem).toHaveBeenCalled();
  });

  test('activate should register a command bar when minikube not available', async () => {
    vi.mocked(findMinikube).mockResolvedValue(undefined);

    await activate({ subscriptions: [] } as unknown as ExtensionContext);

    expect(commands.registerCommand).toHaveBeenCalledWith('minikube.install', expect.any(Function));
  });

  test('activate should not register a status bar bar when minikube is available', async () => {
    vi.mocked(findMinikube).mockResolvedValue('/dummy/path/minikube');

    await activate({ subscriptions: [] } as unknown as ExtensionContext);

    expect(findMinikube).toHaveBeenCalled();
    expect(window.createStatusBarItem).not.toHaveBeenCalled();
  });
});

describe('activate - cli tool', () => {
  test('should register cli tool without version when minikube not available', async () => {
    vi.mocked(findMinikube).mockResolvedValue(undefined);

    await activate({ subscriptions: [] } as unknown as ExtensionContext);

    await vi.waitFor(() => {
      expect(cli.createCliTool).toHaveBeenCalledWith({
        name: 'minikube',
        displayName: 'Minikube',
        markdownDescription: expect.any(String),
        images: {
          icon: expect.any(String),
        },
        version: undefined,
        path: undefined,
      });
    });
  });

  test('should register cli tool with version when minikube is available', async () => {
    vi.mocked(findMinikube).mockResolvedValue('/hello/minikube');
    vi.mocked(processCore.exec).mockResolvedValue({
      stdout: 'v1.55.99',
      stderr: '',
      command: '',
    });

    await activate({ subscriptions: [] } as unknown as ExtensionContext);

    await vi.waitFor(() => {
      expect(processCore.exec).toHaveBeenCalledWith('/hello/minikube', ['version', '--short']);
      expect(cli.createCliTool).toHaveBeenCalledWith(
        expect.objectContaining({
          version: '1.55.99',
          path: '/hello/minikube',
        }),
      );
    });
  });

  test('should register an update to the cli tool when new version available', async () => {
    vi.mocked(findMinikube).mockResolvedValue('/hello/minikube');
    vi.mocked(processCore.exec).mockResolvedValue({
      stdout: 'v1.55.99',
      stderr: '',
      command: '',
    });

    const registerUpdateMock = vi.fn();
    vi.mocked(cli.createCliTool).mockReturnValue({
      registerUpdate: registerUpdateMock,
      dispose: vi.fn(),
    } as unknown as CliTool);

    await activate({ subscriptions: [] } as unknown as ExtensionContext);

    await vi.waitFor(() => {
      expect(registerUpdateMock).toHaveBeenCalledWith({
        version: '1.56.0',
        doUpdate: expect.any(Function),
      });
    });
  });
});
