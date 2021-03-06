/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { PreConfiguredAction } from '../../actions/server';
import { AlertsClient } from './alerts_client';
import { AlertTypeRegistry, SpaceIdToNamespaceFunction } from './types';
import { KibanaRequest, Logger, SavedObjectsClientContract } from '../../../../src/core/server';
import { InvalidateAPIKeyParams, SecurityPluginSetup } from '../../../plugins/security/server';
import { EncryptedSavedObjectsPluginStart } from '../../../plugins/encrypted_saved_objects/server';
import { TaskManagerStartContract } from '../../../plugins/task_manager/server';

export interface AlertsClientFactoryOpts {
  logger: Logger;
  taskManager: TaskManagerStartContract;
  alertTypeRegistry: AlertTypeRegistry;
  securityPluginSetup?: SecurityPluginSetup;
  getSpaceId: (request: KibanaRequest) => string | undefined;
  spaceIdToNamespace: SpaceIdToNamespaceFunction;
  encryptedSavedObjectsPlugin: EncryptedSavedObjectsPluginStart;
  preconfiguredActions: PreConfiguredAction[];
}

export class AlertsClientFactory {
  private isInitialized = false;
  private logger!: Logger;
  private taskManager!: TaskManagerStartContract;
  private alertTypeRegistry!: AlertTypeRegistry;
  private securityPluginSetup?: SecurityPluginSetup;
  private getSpaceId!: (request: KibanaRequest) => string | undefined;
  private spaceIdToNamespace!: SpaceIdToNamespaceFunction;
  private encryptedSavedObjectsPlugin!: EncryptedSavedObjectsPluginStart;
  private preconfiguredActions!: PreConfiguredAction[];

  public initialize(options: AlertsClientFactoryOpts) {
    if (this.isInitialized) {
      throw new Error('AlertsClientFactory already initialized');
    }
    this.isInitialized = true;
    this.logger = options.logger;
    this.getSpaceId = options.getSpaceId;
    this.taskManager = options.taskManager;
    this.alertTypeRegistry = options.alertTypeRegistry;
    this.securityPluginSetup = options.securityPluginSetup;
    this.spaceIdToNamespace = options.spaceIdToNamespace;
    this.encryptedSavedObjectsPlugin = options.encryptedSavedObjectsPlugin;
    this.preconfiguredActions = options.preconfiguredActions;
  }

  public create(
    request: KibanaRequest,
    savedObjectsClient: SavedObjectsClientContract
  ): AlertsClient {
    const { securityPluginSetup } = this;
    const spaceId = this.getSpaceId(request);
    return new AlertsClient({
      spaceId,
      logger: this.logger,
      taskManager: this.taskManager,
      alertTypeRegistry: this.alertTypeRegistry,
      savedObjectsClient,
      namespace: this.spaceIdToNamespace(spaceId),
      encryptedSavedObjectsPlugin: this.encryptedSavedObjectsPlugin,
      async getUserName() {
        if (!securityPluginSetup) {
          return null;
        }
        const user = await securityPluginSetup.authc.getCurrentUser(request);
        return user ? user.username : null;
      },
      async createAPIKey() {
        if (!securityPluginSetup) {
          return { apiKeysEnabled: false };
        }
        // Create an API key using the new grant API - in this case the Kibana system user is creating the
        // API key for the user, instead of having the user create it themselves, which requires api_key
        // privileges
        const createAPIKeyResult = await securityPluginSetup.authc.grantAPIKeyAsInternalUser(
          request
        );
        if (!createAPIKeyResult) {
          return { apiKeysEnabled: false };
        }
        return {
          apiKeysEnabled: true,
          result: createAPIKeyResult,
        };
      },
      async invalidateAPIKey(params: InvalidateAPIKeyParams) {
        if (!securityPluginSetup) {
          return { apiKeysEnabled: false };
        }
        const invalidateAPIKeyResult = await securityPluginSetup.authc.invalidateAPIKeyAsInternalUser(
          params
        );
        // Null when Elasticsearch security is disabled
        if (!invalidateAPIKeyResult) {
          return { apiKeysEnabled: false };
        }
        return {
          apiKeysEnabled: true,
          result: invalidateAPIKeyResult,
        };
      },
      preconfiguredActions: this.preconfiguredActions,
    });
  }
}
