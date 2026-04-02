export const ALLOWED_ROLES = [
  "USER",
  "DEVELOPER",
  "DEVOPS",
  "ADMIN",
  "SUPER_ADMIN",
] as const;

export type AllowedRole = typeof ALLOWED_ROLES[number];

export {}; // 👈 forces TS to treat this as a module
