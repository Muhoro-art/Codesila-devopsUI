import { Request, Response } from "express";
import { prisma } from "../../../infra/db";

export async function listUsersHandler(_req: Request, res: Response) {
  try {
    const orgId = res.locals.user?.orgId;
    if (!orgId) {
      return res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
    }

    const users = await prisma.user.findMany({
      where: { orgId },
      select: {
        id: true,
        email: true,
        role: true,
        orgId: true,
        twoFactorEnabled: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ success: true, data: users, meta: { total: users.length, page: 1 } });
  } catch (err) {
    console.error("LIST USERS ERROR:", err);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  }
}
