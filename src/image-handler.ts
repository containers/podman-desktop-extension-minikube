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
import type { MinikubeCluster } from './extension';
import * as extensionApi from '@podman-desktop/api';
import { tmpName } from 'tmp-promise';
import { getMinikubePath, getMinikubeHome } from './util';
import * as fs from 'node:fs';

type ImageInfo = { engineId: string; name?: string; tag?: string };

// Handle the image move command when moving from Podman or Docker to minikube
export class ImageHandler {
  // Move image from Podman or Docker to minikube
  async moveImage(image: ImageInfo, minikubeClusters: MinikubeCluster[], minikubeCli: string): Promise<void> {
    // If there's no image name passed in, we can't do anything
    if (!image.name) {
      throw new Error('Image selection not supported yet');
    }

    // Retrieve all the minikube clusters available.
    const clusters = minikubeClusters.filter(cluster => cluster.status === 'started');
    let selectedCluster: { label: string; engineType: string };

    // Throw an error if there is no clusters,
    // but if there are multiple ones, prompt the user to select one
    if (clusters.length == 0) {
      throw new Error('No minikube clusters to push to');
    } else if (clusters.length == 1) {
      selectedCluster = { label: clusters[0].name, engineType: clusters[0].engineType };
    } else {
      selectedCluster = await extensionApi.window.showQuickPick(
        clusters.map(cluster => {
          return { label: cluster.name, engineType: cluster.engineType };
        }),
        { placeHolder: 'Select a minikube cluster to push to' },
      );
    }

    // Only proceed if a cluster was selected
    if (selectedCluster) {
      let name = image.name;
      let filename: string;
      const env = Object.assign({}, process.env);

      // Create a name:tag string for the image
      if (image.tag) {
        name = name + ':' + image.tag;
      }

      env.PATH = getMinikubePath();
      env.MINIKUBE_HOME = getMinikubeHome();
      try {
        // Create a temporary file to store the image
        filename = await tmpName();

        // Save the image to the temporary file
        await extensionApi.containerEngine.saveImage(image.engineId, name, filename);

        // Run the minikube image load command to push the image to the cluster
        await extensionApi.process.exec(minikubeCli, ['-p', selectedCluster.label, 'image', 'load', filename], {
          env: env,
        });

        // Show a dialog to the user that the image was pushed
        // TODO: Change this to taskbar notification when implemented
        await extensionApi.window.showInformationMessage(
          `Image ${image.name} pushed to minikube cluster: ${selectedCluster.label}`,
        );
      } catch (err) {
        // Show a dialog error to the user that the image was not pushed
        await extensionApi.window.showErrorMessage(
          `Unable to push image ${image.name} to minikube cluster: ${selectedCluster.label}. Error: ${err}`,
        );

        // Throw the errors to the console aswell
        throw new Error(`Unable to push image to minikube cluster: ${err}`);
      } finally {
        // Remove the temporary file if one was created
        if (filename !== undefined) {
          await fs.promises.rm(filename);
        }
      }
    }
  }
}
