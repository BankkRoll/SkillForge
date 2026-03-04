/**
 * SkillForge Configuration Management
 *
 * Secure configuration storage with encryption for sensitive values.
 * Supports multiple storage backends: file, environment, and system keychain.
 *
 * Priority order for API keys:
 * 1. CLI flag (--api-key)
 * 2. Environment variable (SKILLFORGE_API_KEY)
 * 3. System keychain (via keytar, if available)
 * 4. Config file (~/.skillforge/config.json)
 *
 * @module config
 */

import { readFile, writeFile, mkdir, chmod } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir, hostname } from "os";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  createHash,
} from "crypto";

// ============================================================================
// CONSTANTS
// ============================================================================

export const CONFIG_DIR = join(homedir(), ".skillforge");
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const CREDENTIALS_FILE = join(CONFIG_DIR, "credentials.enc");

/** Service name for keychain storage */
const KEYCHAIN_SERVICE = "skillforge";

/** Encryption algorithm */
const ENCRYPTION_ALGO = "aes-256-gcm";

/** Salt for key derivation (machine-specific) */
const MACHINE_SALT = createHash("sha256")
  .update(`skillforge-${hostname()}-${homedir()}`)
  .digest();

// ============================================================================
// TYPES
// ============================================================================

/**
 * Full configuration schema
 */
export interface SkillForgeConfig {
  /** AI Gateway API key (encrypted in storage) */
  apiKey?: string;
  /** Default AI model (e.g., 'anthropic/claude-sonnet-4') */
  defaultModel?: string;
  /** Default provider */
  defaultProvider?: string;
  /** Default output directory */
  outputDir?: string;
  /** Enable verbose logging */
  verbose?: boolean;
  /** Enable web search by default */
  useWebSearch?: boolean;
  /** Serper API key for web search (encrypted) */
  serperApiKey?: string;
  /** Tavily API key for web search (encrypted) */
  tavilyApiKey?: string;
  /** Maximum search results */
  maxSearchResults?: number;
}

/**
 * Credentials that are stored encrypted
 */
export interface SecureCredentials {
  apiKey?: string;
  serperApiKey?: string;
  tavilyApiKey?: string;
}

/**
 * Non-sensitive configuration
 */
export interface PublicConfig {
  defaultModel?: string;
  defaultProvider?: string;
  outputDir?: string;
  verbose?: boolean;
  useWebSearch?: boolean;
  maxSearchResults?: number;
}

/**
 * Configuration source for debugging
 */
export interface ConfigSource {
  key: string;
  source: "flag" | "env" | "keychain" | "file" | "default";
  value?: string;
}

// ============================================================================
// ENCRYPTION UTILITIES
// ============================================================================

/**
 * Derive encryption key from machine-specific data
 */
function deriveKey(): Buffer {
  return scryptSync(MACHINE_SALT, "skillforge-key", 32);
}

/**
 * Encrypt a string value
 */
function encrypt(value: string): string {
  const key = deriveKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ENCRYPTION_ALGO, key, iv);

  let encrypted = cipher.update(value, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encrypted
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt a string value
 */
function decrypt(encryptedValue: string): string {
  try {
    const [ivHex, authTagHex, encrypted] = encryptedValue.split(":");
    if (!ivHex || !authTagHex || !encrypted) {
      throw new Error("Invalid encrypted format");
    }

    const key = deriveKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const decipher = createDecipheriv(ENCRYPTION_ALGO, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch {
    throw new Error(
      "Failed to decrypt value - config may be corrupted or from different machine",
    );
  }
}

// ============================================================================
// KEYCHAIN INTEGRATION (OPTIONAL)
// ============================================================================

/**
 * Keytar module interface (optional dependency)
 */
interface KeytarModule {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(
    service: string,
    account: string,
    password: string,
  ): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

let keytarModule: KeytarModule | null = null;
let keytarAvailable: boolean | null = null;

/**
 * Check if keytar (system keychain) is available
 */
async function isKeytarAvailable(): Promise<boolean> {
  if (keytarAvailable !== null) return keytarAvailable;

  try {
    // Dynamic import of optional dependency
    // Use Function constructor to avoid TypeScript static analysis
    const dynamicImport = new Function(
      "moduleName",
      "return import(moduleName)",
    );
    keytarModule = (await dynamicImport("keytar")) as KeytarModule;
    keytarAvailable = true;
    return true;
  } catch {
    keytarAvailable = false;
    return false;
  }
}

/**
 * Store a credential in the system keychain
 */
async function setKeychainCredential(
  key: string,
  value: string,
): Promise<boolean> {
  if (!(await isKeytarAvailable()) || !keytarModule) return false;

  try {
    await keytarModule.setPassword(KEYCHAIN_SERVICE, key, value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get a credential from the system keychain
 */
async function getKeychainCredential(key: string): Promise<string | null> {
  if (!(await isKeytarAvailable()) || !keytarModule) return null;

  try {
    return await keytarModule.getPassword(KEYCHAIN_SERVICE, key);
  } catch {
    return null;
  }
}

/**
 * Delete a credential from the system keychain
 */
async function deleteKeychainCredential(key: string): Promise<boolean> {
  if (!(await isKeytarAvailable()) || !keytarModule) return false;

  try {
    return await keytarModule.deletePassword(KEYCHAIN_SERVICE, key);
  } catch {
    return false;
  }
}

// ============================================================================
// FILE STORAGE
// ============================================================================

/**
 * Ensure config directory exists with proper permissions
 */
async function ensureConfigDir(): Promise<void> {
  if (!existsSync(CONFIG_DIR)) {
    await mkdir(CONFIG_DIR, { recursive: true });
    // Set directory permissions to owner only (700)
    try {
      await chmod(CONFIG_DIR, 0o700);
    } catch {
      // Windows doesn't support chmod the same way, ignore
    }
  }
}

/**
 * Load public (non-sensitive) configuration
 */
export async function loadPublicConfig(): Promise<PublicConfig> {
  try {
    if (existsSync(CONFIG_FILE)) {
      const content = await readFile(CONFIG_FILE, "utf-8");
      return JSON.parse(content) as PublicConfig;
    }
  } catch {
    // Ignore errors, return empty
  }
  return {};
}

/**
 * Save public configuration
 */
export async function savePublicConfig(config: PublicConfig): Promise<void> {
  await ensureConfigDir();
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  try {
    await chmod(CONFIG_FILE, 0o600);
  } catch {
    // Windows compatibility
  }
}

/**
 * Load encrypted credentials from file
 */
async function loadCredentialsFile(): Promise<SecureCredentials> {
  try {
    if (existsSync(CREDENTIALS_FILE)) {
      const content = await readFile(CREDENTIALS_FILE, "utf-8");
      const encrypted = JSON.parse(content) as Record<string, string>;

      const credentials: SecureCredentials = {};
      for (const [key, value] of Object.entries(encrypted)) {
        try {
          (credentials as Record<string, string>)[key] = decrypt(value);
        } catch {
          // Skip corrupted values
        }
      }
      return credentials;
    }
  } catch {
    // Ignore errors
  }
  return {};
}

/**
 * Save encrypted credentials to file
 */
async function saveCredentialsFile(
  credentials: SecureCredentials,
): Promise<void> {
  await ensureConfigDir();

  const encrypted: Record<string, string> = {};
  for (const [key, value] of Object.entries(credentials)) {
    if (value) {
      encrypted[key] = encrypt(value);
    }
  }

  await writeFile(
    CREDENTIALS_FILE,
    JSON.stringify(encrypted, null, 2),
    "utf-8",
  );
  try {
    await chmod(CREDENTIALS_FILE, 0o600);
  } catch {
    // Windows compatibility
  }
}

// ============================================================================
// CONFIGURATION MANAGER
// ============================================================================

/**
 * Configuration manager with secure credential handling
 */
export class ConfigManager {
  private publicConfig: PublicConfig = {};
  private credentials: SecureCredentials = {};
  private loaded = false;

  /**
   * Load all configuration
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    this.publicConfig = await loadPublicConfig();
    this.credentials = await loadCredentialsFile();
    this.loaded = true;
  }

  /**
   * Get the full merged configuration
   */
  async getConfig(): Promise<SkillForgeConfig> {
    await this.load();
    return {
      ...this.publicConfig,
      ...this.credentials,
    };
  }

  /**
   * Get API key with priority chain:
   * 1. Explicit value passed in
   * 2. Environment variable SKILLFORGE_API_KEY
   * 3. Legacy env var AI_GATEWAY_API_KEY (for compatibility)
   * 4. System keychain
   * 5. Encrypted config file
   */
  async getApiKey(
    explicit?: string,
  ): Promise<{ key: string | null; source: ConfigSource["source"] }> {
    // 1. Explicit (CLI flag)
    if (explicit) {
      return { key: explicit, source: "flag" };
    }

    // 2. Environment variable (new name)
    const envKey = process.env.SKILLFORGE_API_KEY;
    if (envKey) {
      return { key: envKey, source: "env" };
    }

    // 3. Legacy environment variable
    const legacyEnvKey = process.env.AI_GATEWAY_API_KEY;
    if (legacyEnvKey) {
      return { key: legacyEnvKey, source: "env" };
    }

    // 4. System keychain
    const keychainKey = await getKeychainCredential("apiKey");
    if (keychainKey) {
      return { key: keychainKey, source: "keychain" };
    }

    // 5. Config file
    await this.load();
    if (this.credentials.apiKey) {
      return { key: this.credentials.apiKey, source: "file" };
    }

    return { key: null, source: "default" };
  }

  /**
   * Get Serper API key for web search
   */
  async getSerperApiKey(): Promise<string | null> {
    // Environment first
    const envKey = process.env.SERPER_API_KEY;
    if (envKey) return envKey;

    // Then keychain
    const keychainKey = await getKeychainCredential("serperApiKey");
    if (keychainKey) return keychainKey;

    // Then config file
    await this.load();
    return this.credentials.serperApiKey || null;
  }

  /**
   * Get Tavily API key for web search
   */
  async getTavilyApiKey(): Promise<string | null> {
    // Environment first
    const envKey = process.env.TAVILY_API_KEY;
    if (envKey) return envKey;

    // Then keychain
    const keychainKey = await getKeychainCredential("tavilyApiKey");
    if (keychainKey) return keychainKey;

    // Then config file
    await this.load();
    return this.credentials.tavilyApiKey || null;
  }

  /**
   * Get default model with priority chain
   */
  async getDefaultModel(explicit?: string): Promise<string> {
    if (explicit) return explicit;

    const envModel = process.env.SKILLFORGE_DEFAULT_MODEL;
    if (envModel) return envModel;

    await this.load();
    return this.publicConfig.defaultModel || "anthropic/claude-sonnet-4";
  }

  /**
   * Set a configuration value
   */
  async set(
    key: keyof SkillForgeConfig,
    value: string | boolean | number,
    useKeychain = false,
  ): Promise<void> {
    await this.load();

    const sensitiveKeys: (keyof SecureCredentials)[] = [
      "apiKey",
      "serperApiKey",
      "tavilyApiKey",
    ];

    if (sensitiveKeys.includes(key as keyof SecureCredentials)) {
      // Sensitive value - store securely
      if (useKeychain && (await isKeytarAvailable())) {
        await setKeychainCredential(key, String(value));
      } else {
        (this.credentials as Record<string, unknown>)[key] = value;
        await saveCredentialsFile(this.credentials);
      }
    } else {
      // Public value
      (this.publicConfig as Record<string, unknown>)[key] = value;
      await savePublicConfig(this.publicConfig);
    }
  }

  /**
   * Get a specific configuration value
   */
  async get(key: keyof SkillForgeConfig): Promise<unknown> {
    await this.load();

    const sensitiveKeys: (keyof SecureCredentials)[] = [
      "apiKey",
      "serperApiKey",
      "tavilyApiKey",
    ];

    if (sensitiveKeys.includes(key as keyof SecureCredentials)) {
      // Check keychain first for sensitive values
      const keychainValue = await getKeychainCredential(key);
      if (keychainValue) return keychainValue;
      return this.credentials[key as keyof SecureCredentials];
    }

    return this.publicConfig[key as keyof PublicConfig];
  }

  /**
   * Delete a configuration value
   */
  async delete(key: keyof SkillForgeConfig): Promise<void> {
    await this.load();

    const sensitiveKeys: (keyof SecureCredentials)[] = [
      "apiKey",
      "serperApiKey",
      "tavilyApiKey",
    ];

    if (sensitiveKeys.includes(key as keyof SecureCredentials)) {
      // Delete from keychain
      await deleteKeychainCredential(key);
      // Delete from file
      delete (this.credentials as Record<string, unknown>)[key];
      await saveCredentialsFile(this.credentials);
    } else {
      delete (this.publicConfig as Record<string, unknown>)[key];
      await savePublicConfig(this.publicConfig);
    }
  }

  /**
   * Get all configuration with sources (for debugging)
   */
  async getAllWithSources(): Promise<ConfigSource[]> {
    await this.load();

    const sources: ConfigSource[] = [];

    // API Key
    const apiKeyResult = await this.getApiKey();
    sources.push({
      key: "apiKey",
      source: apiKeyResult.source,
      value: apiKeyResult.key ? maskApiKey(apiKeyResult.key) : undefined,
    });

    // Default model
    const envModel = process.env.SKILLFORGE_DEFAULT_MODEL;
    sources.push({
      key: "defaultModel",
      source: envModel
        ? "env"
        : this.publicConfig.defaultModel
          ? "file"
          : "default",
      value:
        envModel ||
        this.publicConfig.defaultModel ||
        "anthropic/claude-sonnet-4",
    });

    // Other config values
    for (const [key, value] of Object.entries(this.publicConfig)) {
      if (key !== "defaultModel") {
        sources.push({
          key,
          source: "file",
          value: String(value),
        });
      }
    }

    // Serper API key
    const serperKey = await this.getSerperApiKey();
    if (serperKey) {
      sources.push({
        key: "serperApiKey",
        source: process.env.SERPER_API_KEY ? "env" : "file",
        value: maskApiKey(serperKey),
      });
    }

    // Tavily API key
    const tavilyKey = await this.getTavilyApiKey();
    if (tavilyKey) {
      sources.push({
        key: "tavilyApiKey",
        source: process.env.TAVILY_API_KEY ? "env" : "file",
        value: maskApiKey(tavilyKey),
      });
    }

    return sources;
  }

  /**
   * Check if keychain storage is available
   */
  async isKeychainAvailable(): Promise<boolean> {
    return isKeytarAvailable();
  }

  /**
   * Validate that required configuration is present
   */
  async validate(): Promise<{ valid: boolean; missing: string[] }> {
    const missing: string[] = [];

    const apiKeyResult = await this.getApiKey();
    if (!apiKeyResult.key) {
      missing.push("apiKey");
    }

    return {
      valid: missing.length === 0,
      missing,
    };
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Mask an API key for display (show first 4 and last 4 chars)
 */
export function maskApiKey(key: string): string {
  if (key.length <= 12) {
    return "*".repeat(key.length);
  }
  return `${key.slice(0, 4)}${"*".repeat(key.length - 8)}${key.slice(-4)}`;
}

/**
 * Validate API key format (basic check)
 */
export function validateApiKeyFormat(key: string): boolean {
  // Most API keys are at least 20 characters
  return key.length >= 20 && /^[a-zA-Z0-9_-]+$/.test(key);
}

// ============================================================================
// SINGLETON
// ============================================================================

let configManager: ConfigManager | null = null;

/**
 * Get the singleton config manager instance
 */
export function getConfigManager(): ConfigManager {
  if (!configManager) {
    configManager = new ConfigManager();
  }
  return configManager;
}

/**
 * Reset the config manager (for testing)
 */
export function resetConfigManager(): void {
  configManager = null;
}

export default ConfigManager;
