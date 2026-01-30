import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Plugin Storage Service (Real File System)
 * PART 12 - Plugin Platform: "Marketplace + Install/Upgrade/Rollback + Permissions Matrix + Signing Enforcement + WASM Sandbox Hardening + Event Pipelines + Rate Limits + Logs + Analytics Attribution"
 *
 * Features:
 * - Real file system storage for WASM bundles
 * - SHA-256 hashing (bundle + canonical manifest)
 * - Path management
 * - MIME validation
 * - Size limits
 * - Directory management
 */

@Injectable()
export class PluginStorageService {
  private readonly logger = new Logger(PluginStorageService.name);
  private readonly storageDir: string;
  private readonly maxBundleSize: number;
  private readonly maxManifestSize: number;

  constructor() {
    // Get storage directory from env
    this.storageDir = process.env.PLUGIN_STORAGE_DIR || 'backend/storage/plugins';
    this.maxBundleSize = parseInt(process.env.PLUGIN_MAX_BUNDLE_SIZE || '10485760'); // 10MB
    this.maxManifestSize = parseInt(process.env.PLUGIN_MAX_MANIFEST_SIZE || '1048576'); // 1MB
  }

  /**
   * Ensure storage directory exists
   */
  async ensureStorageDir(): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      this.logger.debug(`Storage directory ensured: ${this.storageDir}`);
    } catch (error: any) {
      throw new InternalServerErrorException(`Failed to create storage directory: ${error.message}`);
    }
  }

  /**
   * Store WASM bundle (real file system)
   */
  async storeWasmBundle(pluginKey: string, version: string, bundle: Buffer | string): Promise<{
    bundlePath: string;
    bundleSha256: string;
    size: number;
  }> {
    this.logger.log(`Storing WASM bundle for plugin ${pluginKey} version ${version}`);

    // 1. Ensure storage dir exists
    await this.ensureStorageDir();

    // 2. Validate bundle buffer
    const bundleBuffer = Buffer.isBuffer(bundle) ? bundle : Buffer.from(bundle);
    const size = bundleBuffer.length;

    if (size > this.maxBundleSize) {
      throw new InternalServerErrorException(
        `Bundle size ${size} exceeds max ${this.maxBundleSize} bytes`,
      );
    }

    // 3. Create version directory
    const versionDir = path.join(this.storageDir, pluginKey, version);
    await fs.mkdir(versionDir, { recursive: true });

    // 4. Store bundle
    const bundlePath = path.join(versionDir, 'bundle.wasm');
    await fs.writeFile(bundlePath, bundleBuffer);

    // 5. Compute SHA-256
    const bundleSha256 = this.computeSha256(bundleBuffer);

    this.logger.log(`WASM bundle stored: ${bundlePath} (${size} bytes, sha256: ${bundleSha256})`);

    return {
      bundlePath,
      bundleSha256,
      size,
    };
  }

  /**
   * Store manifest JSON (canonicalized)
   */
  async storeManifest(pluginKey: string, version: string, manifest: any): Promise<{
    manifestPath: string;
    manifestSha256: string;
    size: number;
  }> {
    this.logger.log(`Storing manifest for plugin ${pluginKey} version ${version}`);

    // 1. Ensure storage dir exists
    await this.ensureStorageDir();

    // 2. Canonicalize manifest (sort keys, remove whitespace)
    const canonicalized = this.canonicalizeManifest(manifest);
    const manifestJson = JSON.stringify(canonicalized, null, 2);

    // 3. Validate manifest size
    const size = Buffer.byteLength(manifestJson);

    if (size > this.maxManifestSize) {
      throw new InternalServerErrorException(
        `Manifest size ${size} exceeds max ${this.maxManifestSize} bytes`,
      );
    }

    // 4. Create version directory
    const versionDir = path.join(this.storageDir, pluginKey, version);
    await fs.mkdir(versionDir, { recursive: true });

    // 5. Store manifest
    const manifestPath = path.join(versionDir, 'manifest.json');
    await fs.writeFile(manifestPath, manifestJson);

    // 6. Compute SHA-256
    const manifestSha256 = this.computeSha256(manifestJson);

    this.logger.log(`Manifest stored: ${manifestPath} (${size} bytes, sha256: ${manifestSha256})`);

    return {
      manifestPath,
      manifestSha256,
      size,
    };
  }

  /**
   * Get WASM bundle
   */
  async getWasmBundle(pluginKey: string, version: string): Promise<Buffer> {
    const bundlePath = path.join(this.storageDir, pluginKey, version, 'bundle.wasm');

    try {
      const buffer = await fs.readFile(bundlePath);
      this.logger.debug(`WASM bundle read: ${bundlePath} (${buffer.length} bytes)`);
      return buffer;
    } catch (error: any) {
      throw new InternalServerErrorException(`Failed to read WASM bundle: ${error.message}`);
    }
  }

  /**
   * Get manifest JSON
   */
  async getManifest(pluginKey: string, version: string): Promise<any> {
    const manifestPath = path.join(this.storageDir, pluginKey, version, 'manifest.json');

    try {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      this.logger.debug(`Manifest read: ${manifestPath}`);
      return manifest;
    } catch (error: any) {
      throw new InternalServerErrorException(`Failed to read manifest: ${error.message}`);
    }
  }

  /**
   * Delete plugin version (bundle + manifest)
   */
  async deletePluginVersion(pluginKey: string, version: string): Promise<void> {
    this.logger.log(`Deleting plugin version ${pluginKey}/${version}`);

    const versionDir = path.join(this.storageDir, pluginKey, version);

    try {
      await fs.rm(versionDir, { recursive: true, force: true });
      this.logger.log(`Plugin version deleted: ${versionDir}`);
    } catch (error: any) {
      throw new InternalServerErrorException(`Failed to delete plugin version: ${error.message}`);
    }
  }

  /**
   * Delete plugin (all versions)
   */
  async deletePlugin(pluginKey: string): Promise<void> {
    this.logger.log(`Deleting plugin: ${pluginKey}`);

    const pluginDir = path.join(this.storageDir, pluginKey);

    try {
      await fs.rm(pluginDir, { recursive: true, force: true });
      this.logger.log(`Plugin deleted: ${pluginDir}`);
    } catch (error: any) {
      throw new InternalServerErrorException(`Failed to delete plugin: ${error.message}`);
    }
  }

  /**
   * Get plugin directory info
   */
  async getPluginInfo(pluginKey: string): Promise<{
    versions: string[];
    totalSize: number;
  }> {
    const pluginDir = path.join(this.storageDir, pluginKey);

    try {
      const entries = await fs.readdir(pluginDir, { withFileTypes: true });
      const versions: string[] = [];
      let totalSize = 0;

      for (const entry of entries) {
        if (entry.isDirectory()) {
          versions.push(entry.name);

          // Calculate total size
          const versionPath = path.join(pluginDir, entry.name);
          const versionEntries = await fs.readdir(versionPath, { withFileTypes: true });

          for (const versionEntry of versionEntries) {
            if (versionEntry.isFile()) {
              const versionEntryPath = path.join(versionPath, versionEntry.name);
              const stats = await fs.stat(versionEntryPath);
              totalSize += stats.size;
            }
          }
        }
      }

      return { versions, totalSize };
    } catch (error: any) {
      throw new InternalServerErrorException(`Failed to get plugin info: ${error.message}`);
    }
  }

  /**
   * Validate MIME type
   */
  async validateMimeType(file: Buffer | string, expectedMimeType: string): Promise<boolean> {
    const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file);

    // Simple MIME detection from file signature
    if (expectedMimeType === 'application/wasm' && buffer.length >= 4) {
      // WASM magic number: 0x00 0x61 0x73 0x6d
      if (buffer[0] === 0x00 && buffer[1] === 0x61 && buffer[2] === 0x73 && buffer[3] === 0x6d) {
        return true;
      }
    }

    if (expectedMimeType === 'application/json') {
      // JSON file (check for opening brace)
      const firstByte = buffer[0];
      if (firstByte === 0x7B) { // '{'
        return true;
      }
    }

    return false;
  }

  /**
   * Compute SHA-256 hash
   */
  private computeSha256(buffer: Buffer): string {
    const hash = createHash('sha256');
    hash.update(buffer);
    return hash.digest('hex');
  }

  /**
   * Canonicalize manifest JSON (sort keys, remove whitespace)
   */
  private canonicalizeManifest(manifest: any): any {
    // Recursively sort object keys
    if (typeof manifest !== 'object' || manifest === null) {
      return manifest;
    }

    if (Array.isArray(manifest)) {
      return manifest.map(item => this.canonicalizeManifest(item));
    }

    const canonicalized: any = {};
    const sortedKeys = Object.keys(manifest).sort();

    for (const key of sortedKeys) {
      canonicalized[key] = this.canonicalizeManifest(manifest[key]);
    }

    return canonicalized;
  }

  /**
   * Get storage stats
   */
  async getStorageStats(): Promise<{
    totalPlugins: number;
    totalVersions: number;
    totalSize: number;
  }> {
    this.logger.log('Getting storage stats');

    const pluginEntries = await fs.readdir(this.storageDir, { withFileTypes: true });
    let totalPlugins = 0;
    let totalVersions = 0;
    let totalSize = 0;

    for (const entry of pluginEntries) {
      if (entry.isDirectory()) {
        totalPlugins++;

        const pluginDir = path.join(this.storageDir, entry.name);
        const versionEntries = await fs.readdir(pluginDir, { withFileTypes: true });

        for (const versionEntry of versionEntries) {
          if (versionEntry.isDirectory()) {
            totalVersions++;

            const versionPath = path.join(pluginDir, versionEntry.name);
            const versionFileEntries = await fs.readdir(versionPath, { withFileTypes: true });

            for (const fileEntry of versionFileEntries) {
              if (fileEntry.isFile()) {
                const filePath = path.join(versionPath, fileEntry.name);
                const stats = await fs.stat(filePath);
                totalSize += stats.size;
              }
            }
          }
        }
      }
    }

    return { totalPlugins, totalVersions, totalSize };
  }
}
