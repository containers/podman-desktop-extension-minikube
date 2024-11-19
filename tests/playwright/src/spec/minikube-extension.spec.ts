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

import { 
    ensureCliInstalled,
    expect as playExpect, 
    ExtensionsPage,  
    isLinux,
    ResourcesPage,  
    test,
} from '@podman-desktop/tests-playwright';

const EXTENSION_IMAGE: string = 'ghcr.io/podman-desktop/podman-desktop-extension-minikube:nightly';
const EXTENSION_NAME: string = 'minikube';
const EXTENSION_LABEL: string = 'podman-desktop.minikube';

let extensionsPage: ExtensionsPage; 

const skipExtensionInstallation = process.env.SKIP_EXTENSION_INSTALL === 'true';

test.beforeAll(async ({ runner, page, welcomePage }) => {
    runner.setVideoAndTraceName('minikube-extension-e2e');
    await welcomePage.handleWelcomePage(true);
    extensionsPage = new ExtensionsPage(page); 
});

test.afterAll(async ({ runner }) => {
    await runner.close();   
});

test.describe.serial('Podman Desktop Minikube Extension Tests', () => {

    test('Install Minikube extension from OCI image', async ({ navigationBar }) => {
        test.skip(!!skipExtensionInstallation, 'Skipping extension installation');
        
        await navigationBar.openExtensions();
        await playExpect(extensionsPage.header).toBeVisible();
        await playExpect.poll(async () => extensionsPage.extensionIsInstalled(EXTENSION_LABEL)).toBeFalsy();
        await extensionsPage.openCatalogTab();
        await extensionsPage.installExtensionFromOCIImage(EXTENSION_IMAGE);
    });

    test('Verify Minikube extension is installed and active', async ({ navigationBar }) => {
        await navigationBar.openExtensions();
        await playExpect(extensionsPage.header).toBeVisible();
        await playExpect.poll(async () => extensionsPage.extensionIsInstalled(EXTENSION_LABEL)).toBeTruthy();
        const minikubeExtension = await extensionsPage.getInstalledExtension(EXTENSION_NAME, EXTENSION_LABEL);
        await playExpect(minikubeExtension.status).toHaveText('ACTIVE');
    });

    test('Ensure Minikube extension details page is correctly displayed', async () => {
        const minikubeExtension = await extensionsPage.getInstalledExtension(EXTENSION_NAME, EXTENSION_LABEL);
        const minikubeDetails = await minikubeExtension.openExtensionDetails('Minikube extension');
        await playExpect(minikubeDetails.heading).toBeVisible();
        await playExpect(minikubeDetails.status).toHaveText('ACTIVE');
        await playExpect(minikubeDetails.tabContent).toBeVisible();
    });

    test('Install Minikube CLI', async ({ navigationBar, page }) => {
        test.skip(isLinux && !!process.env.GITHUB_ACTIONS);
        const settingsBar = await navigationBar.openSettings();
        await settingsBar.cliToolsTab.click();
        await ensureCliInstalled(page, 'Minikube');
    });

    test('Ensure Minikube extension can be disabled and enabled', async ({ navigationBar, page }) => {
        await navigationBar.openExtensions();
        await playExpect(extensionsPage.header).toBeVisible();

        const minikubeExtension = await extensionsPage.getInstalledExtension(EXTENSION_NAME, EXTENSION_LABEL);
        await minikubeExtension.disableExtension();
        await playExpect(minikubeExtension.enableButton).toBeEnabled();
        await navigationBar.openSettings();
        const resourcesPage = new ResourcesPage(page);
        await playExpect.poll(async () => resourcesPage.resourceCardIsVisible(EXTENSION_NAME)).toBeFalsy();

        await navigationBar.openExtensions();
        await navigationBar.openSettings();
        await minikubeExtension.enableExtension();
        await playExpect(minikubeExtension.disableButton).toBeEnabled();
        await navigationBar.openSettings();
        await playExpect.poll(async () => resourcesPage.resourceCardIsVisible(EXTENSION_NAME)).toBeTruthy();
    });

    test('Uninstall Minikube extension', async ({ navigationBar }) => {
        await navigationBar.openExtensions();
        await playExpect(extensionsPage.header).toBeVisible();
        const minikubeExtension = await extensionsPage.getInstalledExtension(EXTENSION_NAME, EXTENSION_LABEL);
        await minikubeExtension.removeExtension();
    });
});
