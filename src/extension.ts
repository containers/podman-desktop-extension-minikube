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

import { Octokit } from '@octokit/rest';
import type { CancellationToken, CliToolInstallationSource, Logger } from '@podman-desktop/api';
import * as extensionApi from '@podman-desktop/api';

import { createCluster } from './create-cluster';
import type { MinikubeGithubReleaseArtifactMetadata } from './download';
import { MinikubeDownload } from './download';
import { ImageHandler } from './image-handler';
import { deleteFile, getBinarySystemPath, getMinikubeHome, getMinikubePath, getMinikubeVersion } from './util';

const API_MINIKUBE_INTERNAL_API_PORT = 8443;

const MINIKUBE_MOVE_IMAGE_COMMAND = 'minikube.image.move';

export interface MinikubeCluster {
  name: string;
  status: extensionApi.ProviderConnectionStatus;
  apiPort: number;
  engineType: 'podman' | 'docker';
}

let minikubeClusters: MinikubeCluster[] = [];
const registeredKubernetesConnections: {
  connection: extensionApi.KubernetesProviderConnection;
  disposable: extensionApi.Disposable;
}[] = [];

let minikubeCli: string | undefined;
let minikubeCliTool: extensionApi.CliTool | undefined;
let provider: extensionApi.Provider | undefined;
let commandDisposable: extensionApi.Disposable | undefined;

const minikubeCliName = 'minikube';
const minikubeDisplayName = 'Minikube';
const minikubeDescription = `
  minikube quickly sets up a local Kubernetes cluster on macOS, Linux, and Windows. We proudly focus on helping application developers and new Kubernetes users.\n\nMore information: [minikube.sigs.k8s.io](https://minikube.sigs.k8s.io/)`;
const imageLocation = './icon.png';

const imageHandler = new ImageHandler();

async function registerProvider(
  extensionContext: extensionApi.ExtensionContext,
  provider: extensionApi.Provider,
  telemetryLogger: extensionApi.TelemetryLogger,
): Promise<void> {
  const disposable = provider.setKubernetesProviderConnectionFactory({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: (params: { [key: string]: any }, logger?: Logger, token?: CancellationToken) =>
      createCluster(params, logger, minikubeCli, telemetryLogger, token),
    creationDisplayName: 'Minikube cluster',
  });
  extensionContext.subscriptions.push(disposable);

  // search
  await searchMinikubeClusters(provider);
  console.log('minikube extension is active');
}

// search for clusters
async function updateClusters(provider: extensionApi.Provider, containers: extensionApi.ContainerInfo[]): void {
  const minikubeContainers = containers.map(container => {
    const clusterName = container.Labels['name.minikube.sigs.k8s.io'];
    const clusterStatus = container.State;

    // search the port where the cluster is listening
    const listeningPort = container.Ports.find(
      port => port.PrivatePort === API_MINIKUBE_INTERNAL_API_PORT && port.Type === 'tcp',
    );
    let status: extensionApi.ProviderConnectionStatus;
    if (clusterStatus === 'running') {
      status = 'started';
    } else {
      status = 'stopped';
    }

    return {
      name: clusterName,
      status,
      apiPort: listeningPort?.PublicPort ?? 0,
      engineType: container.engineType,
      engineId: container.engineId,
      id: container.Id,
    };
  });
  minikubeClusters = minikubeContainers.map(container => {
    return {
      name: container.name,
      status: container.status,
      apiPort: container.apiPort,
      engineType: container.engineType,
    };
  });

  minikubeContainers.forEach(cluster => {
    const item = registeredKubernetesConnections.find(item => item.connection.name === cluster.name);
    const status = (): string => {
      return cluster.status;
    };
    if (!item) {
      const lifecycle: extensionApi.ProviderConnectionLifecycle = {
        start: async (): Promise<void> => {
          try {
            const env = { ...process.env };
            env.PATH = getMinikubePath();
            await extensionApi.process.exec(minikubeCli, ['start', '--profile', cluster.name], { env });
          } catch (err) {
            console.error(err);
            // propagate the error
            throw err;
          }
        },
        stop: async (): Promise<void> => {
          const env = { ...process.env };
          env.PATH = getMinikubePath();
          await extensionApi.process.exec(minikubeCli, ['stop', '--profile', cluster.name, '--keep-context-active'], {
            env,
          });
        },
        delete: async (logger): Promise<void> => {
          const env = { ...process.env };
          env.PATH = getMinikubePath();
          env.MINIKUBE_HOME = getMinikubeHome();
          await extensionApi.process.exec(minikubeCli, ['delete', '--profile', cluster.name], { env, logger });
        },
      };
      // create a new connection
      const connection: extensionApi.KubernetesProviderConnection = {
        name: cluster.name,
        status,
        endpoint: {
          apiURL: `https://localhost:${cluster.apiPort}`,
        },
        lifecycle,
      };
      const disposable = provider.registerKubernetesProviderConnection(connection);

      registeredKubernetesConnections.push({ connection, disposable });
    } else {
      item.connection.status = status;
      item.connection.endpoint.apiURL = `https://localhost:${cluster.apiPort}`;
    }
  });

  // do we have registeredKubernetesConnections that are not in minikubeClusters?
  registeredKubernetesConnections.forEach(item => {
    const cluster = minikubeClusters.find(cluster => cluster.name === item.connection.name);
    if (!cluster) {
      // remove the connection
      item.disposable.dispose();

      // remove the item frm the list
      const index = registeredKubernetesConnections.indexOf(item);
      if (index > -1) {
        registeredKubernetesConnections.splice(index, 1);
      }
    }
  });
}

async function searchMinikubeClusters(provider: extensionApi.Provider): Promise<void> {
  const allContainers = await extensionApi.containerEngine.listContainers();

  // search all containers with name.minikube.sigs.k8s.io labels
  const minikubeContainers = allContainers.filter(container => {
    return container.Labels?.['name.minikube.sigs.k8s.io'];
  });
  return updateClusters(provider, minikubeContainers);
}

export function refreshMinikubeClustersOnProviderConnectionUpdate(provider: extensionApi.Provider): void {
  // when a provider is changing, update the status
  extensionApi.provider.onDidUpdateContainerConnection(async () => {
    // needs to search for minikube clusters
    await searchMinikubeClusters(provider);
  });
}

async function createProvider(
  extensionContext: extensionApi.ExtensionContext,
  telemetryLogger: extensionApi.TelemetryLogger,
): Promise<extensionApi.Provider> {
  const providerOptions: extensionApi.ProviderOptions = {
    name: minikubeDisplayName,
    id: 'minikube',
    status: 'unknown',
    images: {
      icon: imageLocation,
      logo: {
        dark: './logo-dark.png',
        light: './logo-light.png',
      },
    },
  };

  // Empty connection descriptive message
  providerOptions.emptyConnectionMarkdownDescription = minikubeDescription;

  const provider = extensionApi.provider.createProvider(providerOptions);

  extensionContext.subscriptions.push(provider);
  await registerProvider(extensionContext, provider, telemetryLogger);
  if (!commandDisposable) {
    commandDisposable = extensionApi.commands.registerCommand(MINIKUBE_MOVE_IMAGE_COMMAND, async image => {
      telemetryLogger.logUsage('moveImage');
      await imageHandler.moveImage(image, minikubeClusters, minikubeCli);
    });
  }

  // when containers are refreshed, update
  extensionApi.containerEngine.onEvent(async event => {
    if (event.Type === 'container') {
      // needs to search for minikube clusters
      await searchMinikubeClusters(provider);
    }
  });

  // when a container provider connection is changing, search for minikube clusters
  refreshMinikubeClustersOnProviderConnectionUpdate(provider);

  // search when a new container is updated or removed
  extensionApi.provider.onDidRegisterContainerConnection(async () => {
    await searchMinikubeClusters(provider);
  });
  extensionApi.provider.onDidUnregisterContainerConnection(async () => {
    await searchMinikubeClusters(provider);
  });
  extensionApi.provider.onDidUpdateProvider(async () => registerProvider(extensionContext, provider, telemetryLogger));
  // search for minikube clusters on boot
  await searchMinikubeClusters(provider);

  return provider;
}

export async function activate(extensionContext: extensionApi.ExtensionContext): Promise<void> {
  const telemetryLogger = extensionApi.env.createTelemetryLogger();

  const octokit = new Octokit();
  const minikubeDownload = new MinikubeDownload(extensionContext, octokit);

  minikubeCli = await minikubeDownload.findMinikube();
  let version: string | undefined;

  if (minikubeCli) {
    version = await getMinikubeVersion(minikubeCli);
  }

  // create provider is minikube executable is available
  if (minikubeCli) {
    provider = await createProvider(extensionContext, telemetryLogger);
  }

  // check if the minikube is installed by the extension or external
  let installationSource: CliToolInstallationSource | undefined;
  if (minikubeCli) {
    installationSource = [getBinarySystemPath('minikube'), minikubeDownload.getMinikubeExtensionPath()].includes(
      minikubeCli,
    )
      ? 'extension'
      : 'external';
  }

  // Register the CLI tool so it appears in the preferences page
  minikubeCliTool = extensionApi.cli.createCliTool({
    name: minikubeCliName,
    displayName: minikubeDisplayName,
    markdownDescription: minikubeDescription,
    images: {
      icon: imageLocation,
    },
    version: version,
    path: minikubeCli,
    installationSource: installationSource,
  });

  // add the cli tool to subscriptions
  extensionContext.subscriptions.push(minikubeCliTool);

  // subscribe to update events
  minikubeCliTool.onDidUpdateVersion(async () => {
    if (provider) return;

    provider = await createProvider(extensionContext, telemetryLogger);

    // check for update
    checkUpdate(minikubeDownload).catch((error: unknown) => {
      console.error('Error checking for minikube update', error);
    });
  });

  // subscribe to uninstall events
  minikubeCliTool.onDidUninstall(() => {
    provider?.dispose();
    commandDisposable?.dispose();
    provider = undefined;
    commandDisposable = undefined;
    minikubeCli = undefined;
  });

  // register the minikube installer
  let artifact: MinikubeGithubReleaseArtifactMetadata | undefined;
  minikubeCliTool.registerInstaller({
    selectVersion: () =>
      minikubeDownload.selectVersion(minikubeCliTool).then(release => {
        artifact = release;
        return release.tag.replace('v', '').trim();
      }),
    doInstall: async (): Promise<void> => {
      if (!artifact) throw new Error('not selected');
      const installPath = await minikubeDownload.install(artifact);
      minikubeCliTool?.updateVersion({
        version: artifact.tag.replace('v', '').trim(),
        path: installPath,
      });
      minikubeCli = installPath;
    },
    doUninstall: async (logger: extensionApi.Logger): Promise<void> => {
      if (!minikubeCli) throw new Error('no version installed');
      const systemPath = getBinarySystemPath('minikube');
      const extensionPath = minikubeDownload.getMinikubeExtensionPath();
      // cleanup minikube executable if installed by the extension.
      if (minikubeCli === systemPath) {
        logger.log('Deleting system-wide minikube executable');
        await deleteFile(minikubeCli);
      }
      // cleanup extension folder
      if (fs.existsSync(extensionPath)) {
        logger.log('Deleting minikube executable in extension storage');
        await deleteFile(extensionPath);
      }
    },
  });

  // Push the CLI tool as well (but it will do it postActivation so it does not block the activate() function)
  // Post activation
  setTimeout(() => {
    checkUpdate(minikubeDownload).catch((error: unknown) => {
      console.error('Error checking for minikube update', error);
    });
  }, 0);
}

// check for update, and register it
async function checkUpdate(minikubeDownload: MinikubeDownload): Promise<void> {
  // if the tool is not register nor available - no need to check for update
  if (!minikubeCliTool || !minikubeCli) return;

  let binaryVersion = '';

  // Retrieve the version of the binary by running exec with --short
  try {
    binaryVersion = await getMinikubeVersion(minikubeCli);
  } catch (err: unknown) {
    console.error('Something went wrong while trying to get minikube version', err);
    return; // if we are not able to check for version, abort
  }

  // check if there is a new version to be installed and register the updater
  const lastReleaseMetadata = await minikubeDownload.getLatestVersionAsset();
  const lastReleaseVersion = lastReleaseMetadata.tag.replace('v', '').trim();
  if (lastReleaseVersion !== binaryVersion) {
    const minikubeCliToolUpdaterDisposable = minikubeCliTool.registerUpdate({
      version: lastReleaseVersion,
      doUpdate: async () => {
        const destFile = await minikubeDownload.install(lastReleaseMetadata);
        minikubeCliTool?.updateVersion({
          version: lastReleaseVersion,
          path: destFile,
        });
        minikubeCliToolUpdaterDisposable?.dispose();
      },
    });
  }
}

export function deactivate(): void {
  minikubeCliTool?.dispose();
  minikubeCli = undefined;
  provider?.dispose();
  provider = undefined;
  commandDisposable?.dispose();
  commandDisposable = undefined;
  minikubeClusters = [];
  registeredKubernetesConnections.splice(0);
}
