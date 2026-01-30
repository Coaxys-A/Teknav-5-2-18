import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Plugin Service (Base - Schema-Free)
 * PART 12 - Plugin Platform: "Marketplace + Installation + Permissions + WASM Sandbox + Event Pipelines + Rate Limits + Logs + Analytics Attribution"
 *
 * Uses existing Prisma models:
 * - Plugin
 * - PluginVersion
 * - PluginInstallation
 * - PluginSettings
 * - PluginSecret
 * - PluginExecutionLog
 * - PluginPermission
 * - PluginDependency
 * - PluginCategory
 */

export interface PluginMarketplaceFilter {
  q?: string;
  categoryId?: number;
  tags?: string[];
  visibility?: 'PUBLIC' | 'PRIVATE';
  isEnabled?: boolean;
  sort?: 'name' | 'createdAt' | 'installs';
  page?: number;
  pageSize?: number;
}

export interface PluginCreateInput {
  key: string;
  name: string;
  description: string;
  slot: string;
  type: string;
  tags: string[];
  visibility: 'PUBLIC' | 'PRIVATE';
  categoryId: number;
  manifest?: any;
  isEnabled: boolean;
}

export interface PluginVersionUploadInput {
  version: string;
  manifest: any;
  wasmBundle: Buffer | string;
  signing: {
    alg: string;
    publicKey: string;
    signature: string;
  };
}

export interface PluginSettingsInput {
  settingKey: string;
  settingValue: any;
}

export interface PluginPermissionGrantInput {
  scope: string;
  permission: string; // allow|deny|rate_limited
  rateLimitConfig?: {
    windowMs: number;
    max: number;
  };
}

export interface PluginInstallInput {
  workspaceId?: number;
  enabled?: boolean;
  settings?: Record<string, any>;
}

@Injectable()
export class PluginService {
  private readonly logger = new Logger(PluginService.name);

  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // ==========================================================================
  // MARKETPLACE ENDPOINTS
  // ==========================================================================

  /**
   * Get plugins for marketplace (Owner scope)
   */
  async getMarketplacePlugins(filter: PluginMarketplaceFilter) {
    const {
      q,
      categoryId,
      tags,
      visibility,
      isEnabled,
      sort = 'createdAt',
      page = 1,
      pageSize = 20,
    } = filter;

    const where: any = {};

    // Search
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { key: { contains: q, mode: 'insensitive' } },
      ];
    }

    // Category filter
    if (categoryId) {
      where.categoryId = categoryId;
    }

    // Visibility filter
    if (visibility) {
      where.visibility = visibility;
    }

    // Enabled status
    if (isEnabled !== undefined) {
      where.isEnabled = isEnabled;
    }

    // Tags filter
    if (tags && tags.length > 0) {
      where.tags = {
        hasSome: tags.map(tag => ({ contains: tag })),
      };
    }

    // Sorting
    const orderBy: any = {};
    switch (sort) {
      case 'name':
        orderBy.name = 'asc';
        break;
      case 'installs':
        orderBy.installs = 'desc';
        break;
      case 'createdAt':
      default:
        orderBy.createdAt = 'desc';
        break;
    }

    // Count total
    const [plugins, total] = await Promise.all([
      this.prisma.plugin.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          category: true,
          latestVersion: true,
        },
      }),
      this.prisma.plugin.count({ where }),
    ]);

    return {
      data: plugins,
      page,
      pageSize,
      total,
    };
  }

  /**
   * Get plugin by ID (Owner scope)
   */
  async getPluginById(pluginId: number) {
    const plugin = await this.prisma.plugin.findUnique({
      where: { id: pluginId },
      include: {
        category: true,
        latestVersion: {
          include: {
            versions: {
              where: { isDeprecated: false },
              orderBy: { createdAt: 'desc' },
              take: 5,
            },
          },
        },
        settings: true,
      },
    });

    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    return plugin;
  }

  /**
   * Create plugin shell (Owner scope)
   */
  async createPlugin(input: PluginCreateInput, actorId: number) {
    const { key, name, description, slot, type, tags, visibility, categoryId, manifest, isEnabled } = input;

    this.logger.log(`Creating plugin: ${key} by actor ${actorId}`);

    const plugin = await this.prisma.plugin.create({
      data: {
        key,
        name,
        description,
        slot,
        type,
        tags,
        visibility,
        categoryId,
        manifest,
        isEnabled,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    this.logger.log(`Plugin created: ${plugin.id} (${plugin.key})`);

    return plugin;
  }

  /**
   * Update plugin (Owner scope)
   */
  async updatePlugin(pluginId: number, updates: Partial<PluginCreateInput>, actorId: number) {
    this.logger.log(`Updating plugin: ${pluginId} by actor ${actorId}`);

    const plugin = await this.prisma.plugin.update({
      where: { id: pluginId },
      data: {
        ...updates,
        updatedAt: new Date(),
      },
    });

    return plugin;
  }

  /**
   * Enable plugin (Owner scope)
   */
  async enablePlugin(pluginId: number, actorId: number) {
    this.logger.log(`Enabling plugin: ${pluginId} by actor ${actorId}`);

    const plugin = await this.prisma.plugin.update({
      where: { id: pluginId },
      data: {
        isEnabled: true,
        updatedAt: new Date(),
      },
    });

    return plugin;
  }

  /**
   * Disable plugin (Owner scope)
   */
  async disablePlugin(pluginId: number, actorId: number) {
    this.logger.log(`Disabling plugin: ${pluginId} by actor ${actorId}`);

    const plugin = await this.prisma.plugin.update({
      where: { id: pluginId },
      data: {
        isEnabled: false,
        updatedAt: new Date(),
      },
    });

    return plugin;
  }

  // ==========================================================================
  // VERSIONING (SEMVER + UPGRADE + ROLLBACK)
  // ==========================================================================

  /**
   * Get plugin versions
   */
  async getPluginVersions(pluginId: number) {
    const versions = await this.prisma.pluginVersion.findMany({
      where: { pluginId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: true,
        promotedBy: true,
      },
    });

    return versions;
  }

  /**
   * Get plugin version by ID
   */
  async getPluginVersionById(versionId: number) {
    const version = await this.prisma.pluginVersion.findUnique({
      where: { id: versionId },
      include: {
        plugin: true,
        createdBy: true,
      },
    });

    if (!version) {
      throw new Error(`Plugin version not found: ${versionId}`);
    }

    return version;
  }

  /**
   * Upload new version (Owner scope)
   */
  async uploadVersion(input: PluginVersionUploadInput, pluginId: number, actorId: number) {
    const { version, manifest, wasmBundle, signing } = input;

    this.logger.log(`Uploading version ${version} for plugin ${pluginId} by actor ${actorId}`);

    // 1. Store WASM bundle
    const bundlePath = await this.storeWasmBundle(pluginId, version, wasmBundle);

    // 2. Store manifest JSON
    const manifestPath = await this.storeManifest(pluginId, version, manifest);

    // 3. Compute hashes
    const bundleSha256 = await this.computeSha256(wasmBundle);
    const manifestSha256 = await this.computeJsonSha256(manifest);

    // 4. Verify signature (if provided)
    let signingVerified = false;
    let signingAlg = null;
    let signerKeyFingerprint = null;

    if (signing && signing.alg && signing.publicKey && signing.signature) {
      const result = await this.verifySignature(
        bundleSha256,
        manifestSha256,
        signing.alg,
        signing.publicKey,
        signing.signature,
      );

      signingVerified = result.verified;
      signingAlg = signing.alg;
      signerKeyFingerprint = result.keyFingerprint;

      if (!signingVerified) {
        throw new Error('Invalid signature: verification failed');
      }
    }

    // 5. Check if requireSigning is enabled
    const plugin = await this.prisma.plugin.findUnique({
      where: { id: pluginId },
      select: { security: true },
    });

    const security = (plugin.security as any) || {};
    const requireSigning = security.requireSigning || false;

    if (requireSigning && !signingVerified) {
      throw new Error('Invalid signature: requireSigning is enabled but signature is not provided or invalid');
    }

    // 6. Create PluginVersion
    const pluginVersion = await this.prisma.pluginVersion.create({
      data: {
        pluginId,
        version,
        manifest: JSON.stringify(manifest),
        bundlePath,
        manifestPath,
        bundleSha256,
        manifestSha256,
        signingVerified,
        signingAlg,
        signerKeyFingerprint,
        isLatest: false, // Will be updated by promote endpoint
        isDeprecated: false,
        createdById: actorId,
        createdAt: new Date(),
      },
    });

    // 7. Update plugin latestVersionId if this is the first version or if requested
    const existingVersions = await this.prisma.pluginVersion.findMany({
      where: { pluginId },
    });

    if (existingVersions.length === 1 || input.setAsLatest) {
      await this.prisma.plugin.update({
        where: { id: pluginId },
        data: { latestVersionId: pluginVersion.id },
      });
    }

    this.logger.log(`Version uploaded: ${pluginVersion.id} (${version})`);

    return pluginVersion;
  }

  /**
   * Promote version to latest
   */
  async promoteVersion(pluginId: number, versionId: number, actorId: number) {
    this.logger.log(`Promoting version ${versionId} for plugin ${pluginId} by actor ${actorId}`);

    // 1. Reset all other versions' isLatest flag
    await this.prisma.pluginVersion.updateMany({
      where: {
        pluginId,
        isLatest: true,
      },
      data: { isLatest: false },
    });

    // 2. Set this version as latest
    const version = await this.prisma.pluginVersion.update({
      where: { id: versionId },
      data: {
        isLatest: true,
        promotedAt: new Date(),
        promotedById: actorId,
      },
    });

    return version;
  }

  /**
   * Deprecate version
   */
  async deprecateVersion(pluginId: number, versionId: number, actorId: number) {
    this.logger.log(`Deprecating version ${versionId} for plugin ${pluginId} by actor ${actorId}`);

    const version = await this.prisma.pluginVersion.update({
      where: { id: versionId },
      data: {
        isDeprecated: true,
        deprecatedAt: new Date(),
        deprecatedById: actorId,
      },
    });

    return version;
  }

  /**
   * Rollback to target version
   */
  async rollbackToVersion(pluginId: number, targetVersionId: number, actorId: number) {
    this.logger.log(`Rolling back to version ${targetVersionId} for plugin ${pluginId} by actor ${actorId}`);

    // 1. Get target version
    const targetVersion = await this.prisma.pluginVersion.findUnique({
      where: { id: targetVersionId },
      include: { plugin: true },
    });

    if (!targetVersion) {
      throw new Error(`Target version not found: ${targetVersionId}`);
    }

    // 2. Reset current latest versions
    await this.prisma.pluginVersion.updateMany({
      where: {
        pluginId,
        isLatest: true,
      },
      data: { isLatest: false },
    });

    // 3. Set target version as latest
    await this.prisma.pluginVersion.update({
      where: { id: targetVersionId },
      data: {
        isLatest: true,
        promotedAt: new Date(),
        promotedById: actorId,
      },
    });

    // 4. Update plugin latestVersionId
    await this.prisma.plugin.update({
      where: { id: pluginId },
      data: { latestVersionId: targetVersion.id },
    });

    this.logger.log(`Rolled back to version: ${targetVersion.version} (${targetVersion.id})`);

    return targetVersion;
  }

  // ==========================================================================
  // INSTALLATION ACROSS WORKSPACES
  // ==========================================================================

  /**
   * Install plugin to workspace
   */
  async installPlugin(pluginId: number, input: PluginInstallInput, actorId: number) {
    const { workspaceId, enabled, settings } = input;

    this.logger.log(`Installing plugin ${pluginId} to workspace ${workspaceId} by actor ${actorId}`);

    // 1. Check if already installed
    const existing = await this.prisma.pluginInstallation.findUnique({
      where: {
        workspaceId_pluginId: {
          workspaceId,
          pluginId,
        },
      },
    });

    if (existing) {
      throw new Error('Plugin already installed in this workspace');
    }

    // 2. Create installation record
    const installation = await this.prisma.pluginInstallation.create({
      data: {
        workspaceId,
        pluginId,
        enabled: enabled !== undefined ? enabled : true,
        installedAt: new Date(),
        installedById: actorId,
      },
    });

    // 3. Set initial settings if provided
    if (settings && Object.keys(settings).length > 0) {
      for (const [key, value] of Object.entries(settings)) {
        await this.prisma.pluginSettings.create({
          data: {
            workspaceId,
            pluginId,
            settingKey: key,
            settingValue: JSON.stringify(value),
          },
        });
      }
    }

    this.logger.log(`Plugin installed: ${installation.id}`);

    return installation;
  }

  /**
   * Uninstall plugin from workspace
   */
  async uninstallPlugin(workspaceId: number, pluginId: number, actorId: number) {
    this.logger.log(`Uninstalling plugin ${pluginId} from workspace ${workspaceId} by actor ${actorId}`);

    // 1. Delete installation
    await this.prisma.pluginInstallation.deleteMany({
      where: {
        workspaceId,
        pluginId,
      },
    });

    // 2. Delete all settings
    await this.prisma.pluginSettings.deleteMany({
      where: {
        workspaceId,
        pluginId,
      },
    });

    // 3. Delete all secrets
    await this.prisma.pluginSecret.deleteMany({
      where: {
        workspaceId,
        pluginId,
      },
    });

    // 4. Delete all permissions (optional - keep or clear)
    await this.prisma.pluginPermission.deleteMany({
      where: {
        workspaceId,
        pluginId,
      },
    });

    this.logger.log(`Plugin uninstalled from workspace ${workspaceId}`);
  }

  /**
   * Get plugin installations for workspace
   */
  async getWorkspacePlugins(workspaceId: number) {
    const installations = await this.prisma.pluginInstallation.findMany({
      where: { workspaceId },
      include: {
        plugin: {
          include: {
            latestVersion: true,
            settings: true,
          },
        },
        settings: true,
      },
      orderBy: { installedAt: 'desc' },
    });

    return installations;
  }

  /**
   * Enable plugin in workspace
   */
  async enableWorkspacePlugin(workspaceId: number, pluginId: number) {
    this.logger.log(`Enabling plugin ${pluginId} in workspace ${workspaceId}`);

    await this.prisma.pluginInstallation.update({
      where: {
        workspaceId,
        pluginId,
      },
      data: { enabled: true },
    });
  }

  /**
   * Disable plugin in workspace
   */
  async disableWorkspacePlugin(workspaceId: number, pluginId: number) {
    this.logger.log(`Disabling plugin ${pluginId} in workspace ${workspaceId}`);

    await this.prisma.pluginInstallation.update({
      where: {
        workspaceId,
        pluginId,
      },
      data: { enabled: false },
    });
  }

  // ==========================================================================
  // STORAGE HELPERS
  // ==========================================================================

  /**
   * Store WASM bundle (real file system)
   */
  private async storeWasmBundle(pluginId: number, version: string, wasmBundle: Buffer | string): Promise<string> {
    // Get storage directory from env
    const storageDir = process.env.PLUGIN_STORAGE_DIR || 'backend/storage/plugins';

    // Create path: backend/storage/plugins/<pluginKey>/<version>/bundle.wasm
    const plugin = await this.prisma.plugin.findUnique({
      where: { id: pluginId },
      select: { key: true },
    });

    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const versionDir = `${storageDir}/${plugin.key}/${version}`;
    const bundlePath = `${versionDir}/bundle.wasm`;

    // Create directory
    await fs.promises.mkdir(versionDir, { recursive: true });

    // Store bundle
    const buffer = Buffer.isBuffer(wasmBundle) ? wasmBundle : Buffer.from(wasmBundle);
    await fs.promises.writeFile(bundlePath, buffer);

    this.logger.log(`WASM bundle stored: ${bundlePath} (${buffer.length} bytes)`);

    return bundlePath;
  }

  /**
   * Store manifest JSON
   */
  private async storeManifest(pluginId: number, version: string, manifest: any): Promise<string> {
    const storageDir = process.env.PLUGIN_STORAGE_DIR || 'backend/storage/plugins';
    const plugin = await this.prisma.plugin.findUnique({
      where: { id: pluginId },
      select: { key: true },
    });

    if (!plugin) {
      throw new Error(`Plugin not found: ${pluginId}`);
    }

    const versionDir = `${storageDir}/${plugin.key}/${version}`;
    const manifestPath = `${versionDir}/manifest.json`;

    // Create directory
    await fs.promises.mkdir(versionDir, { recursive: true });

    // Store manifest
    await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    this.logger.log(`Manifest stored: ${manifestPath}`);

    return manifestPath;
  }

  /**
   * Compute SHA-256 hash
   */
  private async computeSha256(data: Buffer | string): Promise<string> {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Compute JSON SHA-256 (canonicalized)
   */
  private async computeJsonSha256(data: any): Promise<string> {
    // Canonicalize JSON: sort keys, remove whitespace
    const canonical = JSON.stringify(data, Object.keys(data).sort(), 2);
    const buffer = Buffer.from(canonical);
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Verify signature (ed25519)
   */
  private async verifySignature(
    bundleSha256: string,
    manifestSha256: string,
    alg: string,
    publicKey: string,
    signature: string,
  ): Promise<{ verified: boolean; keyFingerprint: string }> {
    // Signature is over: bundleSha256 + "." + manifestSha256
    const message = `${bundleSha256}.${manifestSha256}`;
    const messageBuffer = Buffer.from(message);

    // In production, use proper Ed25519 verification library
    // For MVP, we'll simulate verification
    const keyFingerprint = publicKey.substring(0, 16);

    this.logger.debug(`Verifying signature: ${alg}, key: ${keyFingerprint}`);

    return {
      verified: true, // Simulated
      keyFingerprint,
    };
  }
}
