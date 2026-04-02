import { Router, Request, Response } from "express";
import * as notifications from "./notifications.service";

const router = Router();

// GET /saas/notifications — list user notifications
router.get("/", async (req: Request, res: Response) => {
  try {
    const { sub: userId } = res.locals.user;
    const unreadOnly = req.query.unread === "true";
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const [items, unreadCount] = await Promise.all([
      notifications.listNotifications(userId, { unreadOnly, limit, offset }),
      notifications.getUnreadCount(userId),
    ]);

    res.json({ notifications: items, unreadCount });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /saas/notifications/unread-count — quick badge count
router.get("/unread-count", async (_req: Request, res: Response) => {
  try {
    const { sub: userId } = res.locals.user;
    const count = await notifications.getUnreadCount(userId);
    res.json({ count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /saas/notifications/:id/read — mark single as read
router.put("/:id/read", async (req: Request, res: Response) => {
  try {
    const { sub: userId } = res.locals.user;
    await notifications.markAsRead(req.params.id, userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /saas/notifications/read-all — mark all as read
router.put("/read-all", async (_req: Request, res: Response) => {
  try {
    const { sub: userId } = res.locals.user;
    await notifications.markAllAsRead(userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /saas/notifications/:id — delete notification
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const { sub: userId } = res.locals.user;
    await notifications.deleteNotification(req.params.id, userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
