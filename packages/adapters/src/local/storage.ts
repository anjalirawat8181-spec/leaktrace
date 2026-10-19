import { createHmac, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Storage } from '../interfaces';

export interface FileToken {
  key: string;
  method: 'GET' | 'PUT';
  exp: number;
  contentType?: string;
}

export class LocalStorage implements Storage {
  constructor(
    private readonly dataDir: string,
    private readonly secret: string,
    private readonly urlPrefix = '/api/local-files',
  ) {}

  private resolve(key: string): string {
    const full = path.resolve(this.dataDir, key);
    if (!full.startsWith(path.resolve(this.dataDir) + path.sep)) {
      throw new Error('Invalid storage key');
    }
    return full;
  }

  async put(key: string, body: Buffer | Uint8Array | string, _contentType?: string): Promise<void> {
    const file = this.resolve(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }

  async get(key: string): Promise<Buffer> {
    return this.read(key);
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  createToken(token: FileToken): string {
    const payload = Buffer.from(JSON.stringify(token)).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  verifyToken(raw: string, now = Date.now()): FileToken | null {
    const [payload, signature] = raw.split('.');
    if (!payload || !signature) return null;
    const expected = Buffer.from(this.sign(payload));
    const actual = Buffer.from(signature);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    try {
      const token = JSON.parse(Buffer.from(payload, 'base64url').toString()) as FileToken;
      return token.exp * 1000 >= now ? token : null;
    } catch {
      return null;
    }
  }

  async signedDownloadUrl(key: string, ttlSec: number): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    return `${this.urlPrefix}/${this.createToken({ key, method: 'GET', exp })}`;
  }

  async signedUploadUrl(key: string, contentType: string, ttlSec: number): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    return `${this.urlPrefix}/${this.createToken({ key, method: 'PUT', exp, contentType })}`;
  }
}
