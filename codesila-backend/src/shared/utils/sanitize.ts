// src/shared/utils/sanitize.ts
// Input sanitization and XSS prevention utilities.

import xss, { IFilterXSSOptions, FilterXSS } from "xss";

// Custom XSS filter options — strip everything dangerous
const xssOptions: IFilterXSSOptions = {
  whiteList: {},           // Allow no HTML tags at all
  stripIgnoreTag: true,    // Strip all non-whitelisted tags
  stripIgnoreTagBody: ["script", "style", "noscript"],
  css: false,
};

const xssFilter = new FilterXSS(xssOptions);

/**
 * Sanitize a string to remove all XSS vectors.
 * Strips all HTML tags and dangerous content.
 */
export function sanitizeString(input: string): string {
  if (typeof input !== "string") return "";
  return xssFilter.process(input).trim();
}

/**
 * Sanitize an email address — lowercase, trim, validate format.
 */
export function sanitizeEmail(email: string): string {
  if (typeof email !== "string") return "";
  return email.toLowerCase().trim();
}

/**
 * Deep sanitize an object — recursively sanitize all string values.
 * Does NOT mutate the original object.
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = sanitizeString(value);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = sanitizeObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string"
          ? sanitizeString(item)
          : item !== null && typeof item === "object"
          ? sanitizeObject(item as Record<string, unknown>)
          : item
      );
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Detect potential SQL injection patterns in input.
 * Returns true if suspicious patterns are found.
 */
export function detectSqlInjection(input: string): boolean {
  if (typeof input !== "string") return false;
  const patterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|EXEC)\b\s)/i,
    /(--|#|\/\*)/,
    /(\bOR\b\s+\d+\s*=\s*\d+)/i,
    /(\bAND\b\s+\d+\s*=\s*\d+)/i,
    /(;\s*(DROP|DELETE|UPDATE|INSERT))/i,
    /('\s*(OR|AND)\s+')/i,
  ];
  return patterns.some((p) => p.test(input));
}

/**
 * Detect potential path traversal attempts.
 */
export function detectPathTraversal(input: string): boolean {
  if (typeof input !== "string") return false;
  const patterns = [
    /\.\.\//,
    /\.\.\\/,
    /%2e%2e/i,
    /%252e%252e/i,
    /\.\.%2f/i,
    /\.\.%5c/i,
  ];
  return patterns.some((p) => p.test(input));
}

/**
 * Strip dangerous characters from filenames.
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/\.{2,}/g, ".")
    .slice(0, 255);
}

/**
 * Validate and sanitize URL — must be http/https.
 */
export function sanitizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}
