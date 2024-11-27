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

import * as fs from 'node:fs';
import * as path from 'node:path';

import * as extensionApi from '@podman-desktop/api';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  deleteFile,
  deleteFileAsAdmin,
  getKubeConfig,
  getMinikubeAdditionalEnvs,
  getMinikubeHome,
  getMinikubePath,
  getMinikubeVersion,
  installBinaryToSystem,
  whereBinary,
} from './util';

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
      getConfiguration: vi.fn(),
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
    promises: {
      unlink: vi.fn(),
    },
  };
});

const originalProcessEnv = process.env;
const configGetMock = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  process.env = {};
  vi.mocked(extensionApi.configuration.getConfiguration).mockReturnValue({
    get: configGetMock,
  } as unknown as extensionApi.Configuration);

  vi.mocked(extensionApi.env).isMac = false;
  vi.mocked(extensionApi.env).isWindows = false;
  vi.mocked(extensionApi.env).isLinux = false;
});

afterEach(() => {
  process.env = originalProcessEnv;
});

describe('getMinikubePath', () => {
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
});

describe('getMinikubeHome', () => {
  test('getMinikubeHome with empty configuration property', async () => {
    const existingEnvHome = '/my-existing-minikube-home';
    const existingConfigHome = '';
    process.env.MINIKUBE_HOME = existingEnvHome;

    configGetMock.mockReturnValue(existingConfigHome);

    const computedHome = getMinikubeHome();

    expect(computedHome).toEqual(existingEnvHome);
    expect(computedHome).not.toEqual(existingConfigHome);
  });

  test('getMinikubeHome with empty configuration property', async () => {
    const existingEnvHome = '/my-existing-minikube-home';
    const existingConfigHome = '/my-another-existing-minikube-home';
    process.env.MINIKUBE_HOME = existingEnvHome;

    configGetMock.mockReturnValue(existingConfigHome);

    const computedHome = getMinikubeHome();

    expect(computedHome).not.toEqual(existingEnvHome);
    expect(computedHome).toEqual(existingConfigHome);
  });
});

describe('getKubeConfig', () => {
  test('getKubeConfig with empty configuration property', async () => {
    const existingEnvKubeConfig = '/my-existing-kube-config-file';
    const existingConfigKubeConfig = '';
    process.env.KUBECONFIG = existingEnvKubeConfig;

    configGetMock.mockReturnValue(existingConfigKubeConfig);

    const computedKubeConfig = getKubeConfig();

    expect(computedKubeConfig).toEqual(existingEnvKubeConfig);
    expect(computedKubeConfig).not.toEqual(existingConfigKubeConfig);
  });

  test('getKubeConfig with empty configuration property', async () => {
    const existingEnvKubeConfig = '/my-existing-kube-config-file';
    const existingConfigKubeConfig = '/my-another-existing-kube-config-file';
    process.env.KUBECONFIG = existingEnvKubeConfig;

    configGetMock.mockReturnValue(existingConfigKubeConfig);

    const computedKubeConfig = getKubeConfig();

    expect(computedKubeConfig).not.toEqual(existingEnvKubeConfig);
    expect(computedKubeConfig).toEqual(existingConfigKubeConfig);
  });
});

describe('installBinaryToSystem', () => {
  test('error: expect installBinaryToSystem to fail with a non existing binary', async () => {
    // Mock the platform to be linux
    vi.mocked(extensionApi.env).isLinux = true;

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
    vi.mocked(extensionApi.env).isMac = true;

    // Mock existsSync to be true since within the function it's doing: !fs.existsSync(localBinDir)
    vi.spyOn(fs, 'existsSync').mockImplementation(() => {
      return true;
    });

    const destination = `${path.sep}usr${path.sep}local${path.sep}bin${path.sep}tmpBinary`;

    // Run installBinaryToSystem which will trigger the spyOn mock
    const result = await installBinaryToSystem('test', 'tmpBinary');
    expect(result).toBe(destination);

    // check called with admin being true
    expect(extensionApi.process.exec).toBeCalledWith('chmod', expect.arrayContaining(['+x', 'test']));
    expect(extensionApi.process.exec).toHaveBeenNthCalledWith(2, 'cp', ['test', destination], { isAdmin: true });
  });

  test('expect: installBinaryToSystem on linux with /usr/local/bin NOT created yet (expect mkdir -p command)', async () => {
    // Mock the platform to be darwin
    vi.mocked(extensionApi.env).isLinux = true;

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
});

describe('whereBinary', () => {
  test.each(['isLinux', 'isMac'] as ('isLinux' | 'isMac')[])('%s should use which', async platform => {
    vi.mocked(extensionApi.env)[platform] = true;
    vi.mocked(extensionApi.process.exec).mockResolvedValue({
      stdout: '/usr/bin/minikube',
      stderr: '',
      command: '',
    });

    const result = await whereBinary('minikube');

    expect(extensionApi.process.exec).toHaveBeenCalledOnce();
    expect(extensionApi.process.exec).toHaveBeenCalledWith('which', ['minikube']);
    expect(result).toBe('/usr/bin/minikube');
  });

  test('isWindow should use where.exe', async () => {
    vi.mocked(extensionApi.env).isWindows = true;
    vi.mocked(extensionApi.process.exec).mockResolvedValue({
      stdout: 'C:/dummy/windows/path/minikube.exe',
      stderr: '',
      command: '',
    });

    const result = await whereBinary('minikube');

    expect(extensionApi.process.exec).toHaveBeenCalledOnce();
    expect(extensionApi.process.exec).toHaveBeenCalledWith('where.exe', ['minikube']);
    expect(result).toBe('C:/dummy/windows/path/minikube.exe');
  });

  test('error on linux should propagate', async () => {
    vi.mocked(extensionApi.env).isLinux = true;
    vi.mocked(extensionApi.process.exec).mockRejectedValue(new Error('something wrong'));

    await expect(async () => {
      await whereBinary('minikube');
    }).rejects.toThrowError(`binary minikube not found`);
  });

  test('error on window should propagate', async () => {
    vi.mocked(extensionApi.env).isWindows = true;
    vi.mocked(extensionApi.process.exec).mockRejectedValue(new Error('something wrong'));

    await expect(async () => {
      await whereBinary('minikube');
    }).rejects.toThrowError(`binary minikube not found`);
  });
});

describe('deleteFile', () => {
  test('file that does not exists should do nothing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    await deleteFile('/dummy/minikube');

    expect(fs.promises.unlink).not.toHaveBeenCalled();
  });

  test('file that exist should unlink', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    await deleteFile('/dummy/minikube');

    expect(fs.promises.unlink).toHaveBeenCalledWith('/dummy/minikube');
  });

  test('unknown error on unlink should propagate', async () => {
    vi.mocked(extensionApi.env).isWindows = true;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.unlink).mockRejectedValue(new Error('weird error'));

    await expect(async () => {
      await deleteFile('C:/dummy/minikube.exe');
    }).rejects.toThrowError('weird error');

    expect(fs.promises.unlink).toHaveBeenCalledWith('C:/dummy/minikube.exe');
    expect(extensionApi.process.exec).not.toHaveBeenCalled();
  });

  test('access error on unlink should try to delete with admin privilege', async () => {
    vi.mocked(extensionApi.env).isWindows = true;
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.promises.unlink).mockRejectedValue({ code: 'EACCES' });

    await deleteFile('C:/dummy/minikube.exe');

    expect(fs.promises.unlink).toHaveBeenCalledWith('C:/dummy/minikube.exe');
    expect(extensionApi.process.exec).toHaveBeenCalledOnce();
    expect(extensionApi.process.exec).toHaveBeenCalledWith('del', ['C:/dummy/minikube.exe'], {
      isAdmin: true,
    });
  });
});

describe('deleteFileAsAdmin', () => {
  test('error should propagate', async () => {
    vi.mocked(extensionApi.env).isLinux = true;
    vi.mocked(extensionApi.process.exec).mockRejectedValue(new Error('something wrong'));

    await expect(async () => {
      await deleteFileAsAdmin('/dummy/minikube');
    }).rejects.toThrowError('something wrong');
  });

  test('linux should use rm', async () => {
    vi.mocked(extensionApi.env).isLinux = true;

    await deleteFileAsAdmin('/dummy/minikube');
    expect(extensionApi.process.exec).toHaveBeenCalledOnce();
    expect(extensionApi.process.exec).toHaveBeenCalledWith('rm', ['/dummy/minikube'], {
      isAdmin: true,
    });
  });

  test('window should use rm', async () => {
    vi.mocked(extensionApi.env).isWindows = true;

    await deleteFileAsAdmin('C:/dummy/minikube.exe');
    expect(extensionApi.process.exec).toHaveBeenCalledOnce();
    expect(extensionApi.process.exec).toHaveBeenCalledWith('del', ['C:/dummy/minikube.exe'], {
      isAdmin: true,
    });
  });

  test('mac should use rm', async () => {
    vi.mocked(extensionApi.env).isMac = true;

    await deleteFileAsAdmin('/dummy/minikube');
    expect(extensionApi.process.exec).toHaveBeenCalledOnce();
    expect(extensionApi.process.exec).toHaveBeenCalledWith('rm', ['/dummy/minikube'], {
      isAdmin: true,
    });
  });
});

describe('getMinikubeVersion', () => {
  test('error should propagate', async () => {
    vi.mocked(extensionApi.process.exec).mockRejectedValue(new Error('something wrong'));

    await expect(async () => {
      await getMinikubeVersion('/dummy/minikube');
    }).rejects.toThrowError('something wrong');

    expect(extensionApi.process.exec).toHaveBeenCalledWith(
      '/dummy/minikube',
      ['version', '--short'],
      expect.anything(),
    );
  });

  test('should format the version output', async () => {
    vi.mocked(extensionApi.process.exec).mockResolvedValue({
      stdout: 'v1.5.3',
      stderr: '',
      command: '',
    });

    const result = await getMinikubeVersion('/dummy/minikube');
    expect(result).toBe('1.5.3');
  });

  test('should use the additional envs', async () => {
    const existingEnvHome = '/my-existing-minikube-home';
    const existingConfigHome = '';
    process.env.MINIKUBE_HOME = existingEnvHome;

    configGetMock.mockReturnValue(existingConfigHome);

    vi.mocked(extensionApi.process.exec).mockResolvedValue({
      stdout: 'v1.5.3',
      stderr: '',
      command: '',
    });

    await getMinikubeVersion('/dummy/minikube');
    expect(extensionApi.process.exec).toHaveBeenCalledWith('/dummy/minikube', ['version', '--short'], {
      env: expect.objectContaining({
        MINIKUBE_HOME: existingEnvHome,
      }),
    });
  });
});

describe('getMinikubeAdditionalEnvs', () => {
  test('getMinikubeAdditionalEnvs should use process.env.MINIKUBE_HOME if defined', () => {
    const existingEnvHome = '/my-existing-minikube-home';
    const existingConfigHome = '';
    process.env.MINIKUBE_HOME = existingEnvHome;

    configGetMock.mockReturnValue(existingConfigHome);

    expect(getMinikubeAdditionalEnvs()).toStrictEqual(
      expect.objectContaining({
        MINIKUBE_HOME: existingEnvHome,
      }),
    );
  });

  test('getMinikubeAdditionalEnvs should not have MINIKUBE_HOME if undefined', () => {
    const existingConfigHome = '';
    process.env.MINIKUBE_HOME = undefined;

    configGetMock.mockReturnValue(existingConfigHome);

    expect(getMinikubeAdditionalEnvs()['MINIKUBE_HOME']).toBeUndefined();
  });
});
