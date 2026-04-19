import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export type SquareToken = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  merchantId: string;
  scopes?: string[];
  obtainedAt: string;
};

const TOKEN_FILENAME = "square-token.json";
const ALGO = "aes-256-gcm";

function getStoragePath(): string {
  const dataDir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), ".data");
  return path.join(dataDir, TOKEN_FILENAME);
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

let cache: SquareToken | null = null;

export async function readToken(): Promise<SquareToken | null> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(getStoragePath(), "utf8");
    const decrypted = decrypt(raw);
    const parsed = JSON.parse(decrypted) as SquareToken;
    cache = parsed;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeToken(token: SquareToken): Promise<void> {
  const filePath = getStoragePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = encrypt(JSON.stringify(token));
  await fs.writeFile(filePath, payload, { mode: 0o600 });
  cache = token;
}

export async function clearToken(): Promise<void> {
  cache = null;
  try {
    await fs.unlink(getStoragePath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export function isTokenFresh(token: SquareToken, bufferSeconds = 300): boolean {
  const expiresAt = new Date(token.expiresAt).getTime();
  return Date.now() + bufferSeconds * 1000 < expiresAt;
}
