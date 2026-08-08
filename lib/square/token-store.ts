import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { TenantId } from "@/lib/tenants";

export type SquareToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  merchantId: string;
  scopes?: string[];
  obtainedAt: string;
};

const LEGACY_TOKEN_FILENAME = "square-token.json";
const ALGO = "aes-256-gcm";

function getDataDir(): string {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), ".data");
}

function getStoragePath(tenant: TenantId): string {
  return path.join(getDataDir(), `square-token-${tenant}.json`);
}

function getKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required to encrypt the Square token.");
  }
  return createHash("sha256").update(secret).digest();
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString(
    "base64",
  )}`;
}

function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Corrupt encrypted token payload.");
  }
  const decipher = createDecipheriv(
    ALGO,
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

const cache = new Map<TenantId, SquareToken>();

/**
 * One-time migration: the pre-multi-tenant deployment stored Margate's
 * token at `square-token.json`. Adopt it on first read.
 */
async function migrateLegacyToken(tenant: TenantId): Promise<void> {
  if (tenant !== "margate") return;
  const legacyPath = path.join(getDataDir(), LEGACY_TOKEN_FILENAME);
  try {
    const raw = await fs.readFile(legacyPath, "utf8");
    await fs.mkdir(getDataDir(), { recursive: true });
    await fs.writeFile(getStoragePath(tenant), raw, { mode: 0o600 });
    await fs.unlink(legacyPath);
    console.log("[token-store] migrated legacy square-token.json → margate");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export async function readToken(tenant: TenantId): Promise<SquareToken | null> {
  const cached = cache.get(tenant);
  if (cached) return cached;
  try {
    const raw = await fs.readFile(getStoragePath(tenant), "utf8");
    const decrypted = decrypt(raw);
    const parsed = JSON.parse(decrypted) as SquareToken;
    cache.set(tenant, parsed);
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      await migrateLegacyToken(tenant);
      try {
        const raw = await fs.readFile(getStoragePath(tenant), "utf8");
        const decrypted = decrypt(raw);
        const parsed = JSON.parse(decrypted) as SquareToken;
        cache.set(tenant, parsed);
        return parsed;
      } catch (retryErr) {
        if ((retryErr as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw retryErr;
      }
    }
    throw err;
  }
}

export async function writeToken(
  tenant: TenantId,
  token: SquareToken,
): Promise<void> {
  const filePath = getStoragePath(tenant);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = encrypt(JSON.stringify(token));
  await fs.writeFile(filePath, payload, { mode: 0o600 });
  cache.set(tenant, token);
}

export async function clearToken(tenant: TenantId): Promise<void> {
  cache.delete(tenant);
  try {
    await fs.unlink(getStoragePath(tenant));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export function isTokenFresh(token: SquareToken, bufferSeconds = 300): boolean {
  const expiresAt = new Date(token.expiresAt).getTime();
  return Date.now() + bufferSeconds * 1000 < expiresAt;
}
