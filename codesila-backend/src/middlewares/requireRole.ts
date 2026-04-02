import { Request, Response, NextFunction } from "express";

export function requireRole(...allowedRoles: string[]) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user;

    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
}
