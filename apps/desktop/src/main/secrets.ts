import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';

/**
 * API keys entered in the desktop app, encrypted with the operating system's
 * keychain (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux).
 * Keys are never written in plain text. Without a secure keychain, storing
 * is refused and users are asked to use environment variables instead.
 */
export class SecretStore {
  private readonly file: string;

  constructor(configDir: string) {
    this.file = path.join(configDir, 'secrets.json');
  }

  available(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux') {
      const backend = safeStorage.getSelectedStorageBackend?.();
      if (backend === 'basic_text' || backend === 'unknown') return false;
    }
    return true;
  }

  private read(): Record<string, string> {
    if (!existsSync(this.file)) return {};
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  }

  get(name: string): string | undefined {
    const encrypted = this.read()[name];
    if (!encrypted || !this.available()) return undefined;
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      return undefined;
    }
  }

  set(name: string, value: string | null): void {
    const data = this.read();
    if (value === null || value === '') delete data[name];
    else {
      if (!this.available()) throw new Error('No secure OS keychain available.');
      data[name] = safeStorage.encryptString(value).toString('base64');
    }
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });
  }
}
