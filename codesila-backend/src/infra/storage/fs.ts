// src/infra/storage/fs.ts — Local filesystem storage adapter

import fs from "node:fs";
import path from "node:path";

const STORAGE_ROOT = process.env.STORAGE_PATH || "./storage";

/**
 * Write data to local filesystem storage.
 */
export async function writeFile(relativePath: string, data: Buffer | string): Promise<string> {
  const fullPath = path.resolve(STORAGE_ROOT, relativePath);
  const dir = path.dirname(fullPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, data);
  return fullPath;
}

/**
 * Read data from local filesystem storage.
 */
export async function readFile(relativePath: string): Promise<Buffer> {
  const fullPath = path.resolve(STORAGE_ROOT, relativePath);
  return fs.readFileSync(fullPath);
}

/**
 * Check if a file exists.
 */
export function fileExists(relativePath: string): boolean {
  const fullPath = path.resolve(STORAGE_ROOT, relativePath);
  return fs.existsSync(fullPath);
}

/**
 * Delete a file.
 */
export async function deleteFile(relativePath: string): Promise<void> {
  const fullPath = path.resolve(STORAGE_ROOT, relativePath);
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }
}
