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
import { activate } from './extension';

vi.mock('@podman-desktop/api', async () => {
  return {
    commands: {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      registerCommand: vi.fn().mockImplementation(() => {}),
    },
    window: {
      createStatusBarItem: vi.fn().mockImplementation(() => {
        return {
          text: '',
          command: '',
        };
      }),
    },
    StatusBarAlignLeft: vi.fn(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
});

test('check activate', async () => {
  const extensionContext = {
    subscriptions: [],
  } as unknown as podmanDesktopApi.ExtensionContext;
  await activate(extensionContext);

  expect(podmanDesktopApi.window.createStatusBarItem).toHaveBeenCalledWith(podmanDesktopApi.StatusBarAlignLeft);
  expect(extensionContext.subscriptions).toHaveLength(1);
});
