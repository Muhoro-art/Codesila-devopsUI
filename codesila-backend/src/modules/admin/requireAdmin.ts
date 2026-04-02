import { Request, Response, NextFunction } from "express";

const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"];

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const user = res.locals.user;

  if (!user || !ADMIN_ROLES.includes(user.role)) {
    return res.status(403).json({
      error: "Admin access required",
    });
  }

  next();
}
