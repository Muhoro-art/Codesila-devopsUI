import { Router, type Request, type Response } from "express";
import { prisma } from "../infra/db";
import { requirePermission } from "../middlewares/requirePermission";
import { Actions } from "../modules/admin/rbac/permissions";
import { emitChatEvent } from "../modules/chat/chat.events";
import { sanitizeString } from "../shared/utils/sanitize";

const router = Router();

/* ─── helpers ────────────────────────────────────────────── */

/** Roles that have full org-wide project visibility */
const ELEVATED_ROLES = new Set(["ADMIN", "SUPER_ADMIN", "MANAGER", "DEVOPS"]);

function getOrgId(_req: Request, res: Response): string {
  const orgId = res.locals.user?.orgId as string | undefined;
  if (!orgId) throw new Error("Missing orgId in token");
  return orgId;
}

function getActorId(res: Response): string {
  const sub = res.locals.user?.sub as string | undefined;
  if (!sub) throw new Error("Missing sub in token");
  return sub;
}

async function logAuditEvent(input: {
  orgId: string;
  projectId?: string;
  actorId?: string;
  entityType: string;
  entityId?: string;
  action: string;
  previousState?: unknown;
  newState?: unknown;
  metadata?: Record<string, unknown>;
}) {
  const { previousState, newState, metadata, ...rest } = input;
  return prisma.auditEvent.create({
    data: {
      ...rest,
      metadata: {
        ...(metadata ?? {}),
        previousState: previousState as any,
        newState: newState as any,
      } as any,
    },
  });
}

/* ─── project list include (reused) ─────────────────────── */
const projectListInclude = {
  owner: { select: { id: true, name: true, email: true, role: true } },
  memberships: {
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
    },
  },
  _count: {
    select: {
      services: true,
      deployments: true,
      incidents: true,
    },
  },
  chatRoom: { select: { id: true, name: true } },
} as const;

const projectDetailInclude = {
  ...projectListInclude,
  services: { orderBy: { createdAt: "desc" as const } },
  environments: { orderBy: { key: "asc" as const } },
} as const;

/* ═══════════════════════════════════════════════════════════
   GET /projects – list org projects with team + stats
   ═══════════════════════════════════════════════════════════ */
router.get("/", requirePermission(Actions.ProjectRead), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const actorId = getActorId(res);
    const role = res.locals.user?.role as string;
    const status = req.query.status ? String(req.query.status) : undefined;

    // Elevated roles see all projects; lower roles only see their own
    const memberFilter = ELEVATED_ROLES.has(role)
      ? {}
      : { memberships: { some: { userId: actorId } } };

    const projects = await prisma.project.findMany({
      where: { orgId, ...(status ? { status: status as any } : {}), ...memberFilter },
      include: projectListInclude,
      orderBy: { createdAt: "desc" },
    });
    return res.json(projects);
  } catch {
    return res.status(500).json({ error: "Failed to load projects" });
  }
});

/* ═══════════════════════════════════════════════════════════
   POST /projects – create project + envs + default service
   + runbook + owner as ADMIN member + project chat room
   ═══════════════════════════════════════════════════════════ */
router.post("/", requirePermission(Actions.ProjectCreate), async (req, res) => {
  try {
    const { name: rawName, key, description: rawDesc, type, gitRepositoryUrl, defaultBranch, memberIds } = req.body ?? {};
    const orgId = getOrgId(req, res);
    const ownerId = getActorId(res);

    if (!rawName || !key) {
      return res.status(400).json({ error: "name and key are required" });
    }

    // Sanitize user-supplied text fields to prevent stored XSS
    const name = sanitizeString(String(rawName));
    const description = rawDesc ? sanitizeString(String(rawDesc)) : rawDesc;

    // Gather all team members — owner + optional memberIds
    const teamUserIds: string[] = [ownerId];
    if (Array.isArray(memberIds)) {
      for (const id of memberIds) {
        if (typeof id === "string" && !teamUserIds.includes(id)) {
          teamUserIds.push(id);
        }
      }
    }

    // Validate all member IDs belong to the org
    const validUsers = await prisma.user.findMany({
      where: { id: { in: teamUserIds }, orgId, isActive: true },
      select: { id: true, name: true, email: true },
    });
    const validIds = new Set(validUsers.map((u) => u.id));

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create project
      const project = await tx.project.create({
        data: {
          orgId,
          name,
          key: key.toUpperCase().replace(/[^A-Z0-9_-]/g, ""),
          description,
          type: type || "API",
          gitRepositoryUrl,
          defaultBranch: defaultBranch || "main",
          ownerId,
        },
      });

      // 2. Create default environments
      await tx.projectEnvironment.createMany({
        data: [
          { orgId, projectId: project.id, name: "Development", key: "dev", isDefault: true },
          { orgId, projectId: project.id, name: "Staging", key: "staging" },
          { orgId, projectId: project.id, name: "Production", key: "prod" },
        ],
      });

      // 3. Create default service
      const service = await tx.service.create({
        data: {
          orgId,
          projectId: project.id,
          name: "Core Service",
          key: "core",
          description: `Default service for ${name}`,
        },
      });

      // 4. Create default runbook
      await tx.runbook.create({
        data: {
          orgId,
          projectId: project.id,
          serviceId: service.id,
          title: `${name} — Deploy Runbook`,
          content: `# ${name} Deploy Runbook\n\n## Summary\nDescribe the service and its owners.\n\n## Deploy\nSteps to deploy safely.\n\n## Rollback\nSteps to rollback and validate recovery.\n\n## Monitoring\nLinks to dashboards and alerts.`,
          status: "DRAFT",
          createdById: ownerId,
          updatedById: ownerId,
        },
      });

      // 5. Add team members (owner = ADMIN, rest = MEMBER)
      const memberData = teamUserIds
        .filter((id) => validIds.has(id))
        .map((userId) => ({
          projectId: project.id,
          userId,
          role: userId === ownerId ? ("ADMIN" as const) : ("MEMBER" as const),
        }));

      if (memberData.length > 0) {
        await tx.projectMember.createMany({ data: memberData });
      }

      // 6. Create project group chat room + add all members
      const chatRoom = await tx.chatRoom.create({
        data: {
          name: `${name}`,
          type: "group",
          orgId,
          projectId: project.id,
          participants: {
            create: memberData.map((m) => ({ userId: m.userId })),
          },
        },
      });

      return { project, service, chatRoom };
    });

    // Audit
    await logAuditEvent({
      orgId,
      projectId: result.project.id,
      actorId: ownerId,
      entityType: "project",
      entityId: result.project.id,
      action: "project.create",
      newState: result.project,
      metadata: { memberCount: teamUserIds.filter((id) => validIds.has(id)).length },
    });

    // Notify team members about new chat room
    const chatRoomFull = await prisma.chatRoom.findUnique({
      where: { id: result.chatRoom.id },
      include: {
        participants: {
          include: {
            user: { select: { id: true, name: true, email: true, role: true } },
          },
        },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });

    if (chatRoomFull) {
      const ROLE_MAP: Record<string, string> = {
        ADMIN: "admin", SUPER_ADMIN: "admin", DEVOPS: "devops",
        DEVELOPER: "developer", MANAGER: "manager", USER: "developer",
      };
      emitChatEvent({
        type: "room",
        recipients: chatRoomFull.participants.map((p) => p.user.id),
        room: {
          id: chatRoomFull.id,
          name: chatRoomFull.name,
          type: "group" as const,
          participants: chatRoomFull.participants.map((p) => ({
            id: p.user.id,
            name: p.user.name ?? p.user.email,
            role: ROLE_MAP[p.user.role] ?? p.user.role.toLowerCase(),
          })),
          lastMessage: undefined,
          unreadCount: 0,
          project: result.project.id,
        },
      });
    }

    // Return created project with includes
    const full = await prisma.project.findUnique({
      where: { id: result.project.id },
      include: projectDetailInclude,
    });

    return res.status(201).json(full);
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "Project key already exists in this organization" });
    }
    console.error("project.create error", err);
    return res.status(500).json({ error: "Failed to create project" });
  }
});

/* ═══════════════════════════════════════════════════════════
   GET /projects/:projectId – full project detail
   ═══════════════════════════════════════════════════════════ */
router.get("/:projectId", requirePermission(Actions.ProjectRead), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const actorId = getActorId(res);
    const role = res.locals.user?.role as string;
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, orgId },
      include: projectDetailInclude,
    });

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    // Non-elevated roles must be a member to view
    if (!ELEVATED_ROLES.has(role)) {
      const isMember = project.memberships?.some((m: any) => m.userId === actorId);
      if (!isMember) {
        return res.status(403).json({ error: "You are not a member of this project" });
      }
    }

    return res.json(project);
  } catch {
    return res.status(500).json({ error: "Failed to load project" });
  }
});

/* ═══════════════════════════════════════════════════════════
   PATCH /projects/:projectId – update project
   ═══════════════════════════════════════════════════════════ */
router.patch("/:projectId", requirePermission(Actions.ProjectCreate), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const actorId = getActorId(res);
    const { projectId } = req.params;
    const { name, description, type, gitRepositoryUrl, defaultBranch, status } = req.body ?? {};

    if (!name && description === undefined && !type && gitRepositoryUrl === undefined && !defaultBranch && !status) {
      return res.status(400).json({ error: "No changes provided" });
    }

    const existing = await prisma.project.findFirst({ where: { id: projectId, orgId } });
    if (!existing) return res.status(404).json({ error: "Project not found" });

    const project = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(name ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(type ? { type } : {}),
        ...(gitRepositoryUrl !== undefined ? { gitRepositoryUrl } : {}),
        ...(defaultBranch ? { defaultBranch } : {}),
        ...(status ? { status } : {}),
      },
      include: projectDetailInclude,
    });

    // Update chat room name if project name changed
    if (name && name !== existing.name) {
      await prisma.chatRoom.updateMany({
        where: { projectId },
        data: { name },
      });
    }

    await logAuditEvent({
      orgId,
      projectId,
      actorId,
      entityType: "project",
      entityId: projectId,
      action: "project.update",
      previousState: existing,
      newState: project,
    });

    return res.json(project);
  } catch {
    return res.status(500).json({ error: "Failed to update project" });
  }
});

/* ═══════════════════════════════════════════════════════════
   DELETE /projects/:projectId – archive (soft delete)
   ═══════════════════════════════════════════════════════════ */
router.delete("/:projectId", requirePermission(Actions.ProjectAdmin), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const actorId = getActorId(res);
    const { projectId } = req.params;

    const existing = await prisma.project.findFirst({ where: { id: projectId, orgId } });
    if (!existing) return res.status(404).json({ error: "Project not found" });

    const project = await prisma.project.update({
      where: { id: projectId },
      data: { status: "ARCHIVED" },
    });

    await logAuditEvent({
      orgId,
      projectId,
      actorId,
      entityType: "project",
      entityId: projectId,
      action: "project.archive",
      previousState: existing,
      newState: project,
    });

    return res.json({ message: "Project archived", project });
  } catch {
    return res.status(500).json({ error: "Failed to archive project" });
  }
});

/* ═══════════════════════════════════════════════════════════
   GET /projects/:projectId/members – list project members
   ═══════════════════════════════════════════════════════════ */
router.get("/:projectId/members", requirePermission(Actions.ProjectRead), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const { projectId } = req.params;

    const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
    if (!project) return res.status(404).json({ error: "Project not found" });

    const members = await prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return res.json(
      members.map((m) => ({
        id: m.id,
        userId: m.user.id,
        name: m.user.name ?? m.user.email,
        email: m.user.email,
        systemRole: m.user.role,
        projectRole: m.role,
        isActive: m.user.isActive,
        joinedAt: m.createdAt.toISOString(),
      }))
    );
  } catch {
    return res.status(500).json({ error: "Failed to load members" });
  }
});

/* ═══════════════════════════════════════════════════════════
   POST /projects/:projectId/members – add member(s) to
   project + auto-add to project chat room
   ═══════════════════════════════════════════════════════════ */
router.post("/:projectId/members", requirePermission(Actions.ProjectCreate), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const actorId = getActorId(res);
    const { projectId } = req.params;
    const { userIds, role } = req.body ?? {};

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "userIds array is required" });
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, orgId },
      include: { chatRoom: { select: { id: true } } },
    });
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Validate users belong to org
    const validUsers = await prisma.user.findMany({
      where: { id: { in: userIds }, orgId, isActive: true },
      select: { id: true, name: true, email: true, role: true },
    });

    // Filter out already-existing members
    const existing = await prisma.projectMember.findMany({
      where: { projectId, userId: { in: validUsers.map((u) => u.id) } },
      select: { userId: true },
    });
    const existingSet = new Set(existing.map((e) => e.userId));
    const newUsers = validUsers.filter((u) => !existingSet.has(u.id));

    if (newUsers.length === 0) {
      return res.status(400).json({ error: "All specified users are already members" });
    }

    const memberRole = role === "ADMIN" ? "ADMIN" : role === "VIEWER" ? "VIEWER" : "MEMBER";

    await prisma.$transaction(async (tx) => {
      // Add to project members
      await tx.projectMember.createMany({
        data: newUsers.map((u) => ({
          projectId,
          userId: u.id,
          role: memberRole,
        })),
      });

      // Add to project chat room
      if (project.chatRoom) {
        const existingParticipants = await tx.chatParticipant.findMany({
          where: { roomId: project.chatRoom.id, userId: { in: newUsers.map((u) => u.id) } },
          select: { userId: true },
        });
        const alreadyInChat = new Set(existingParticipants.map((p) => p.userId));
        const chatNewUsers = newUsers.filter((u) => !alreadyInChat.has(u.id));

        if (chatNewUsers.length > 0) {
          await tx.chatParticipant.createMany({
            data: chatNewUsers.map((u) => ({
              roomId: project.chatRoom!.id,
              userId: u.id,
            })),
          });
        }
      }
    });

    await logAuditEvent({
      orgId,
      projectId,
      actorId,
      entityType: "project_member",
      entityId: projectId,
      action: "project_member.add",
      metadata: {
        addedUserIds: newUsers.map((u) => u.id),
        role: memberRole,
      },
    });

    // Return updated member list
    const members = await prisma.projectMember.findMany({
      where: { projectId },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return res.status(201).json(
      members.map((m) => ({
        id: m.id,
        userId: m.user.id,
        name: m.user.name ?? m.user.email,
        email: m.user.email,
        systemRole: m.user.role,
        projectRole: m.role,
        isActive: m.user.isActive,
        joinedAt: m.createdAt.toISOString(),
      }))
    );
  } catch {
    return res.status(500).json({ error: "Failed to add members" });
  }
});

/* ═══════════════════════════════════════════════════════════
   PATCH /projects/:projectId/members/:userId – change role
   ═══════════════════════════════════════════════════════════ */
router.patch("/:projectId/members/:userId", requirePermission(Actions.ProjectCreate), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const actorId = getActorId(res);
    const { projectId, userId } = req.params;
    const { role } = req.body ?? {};

    if (!role || !["ADMIN", "MEMBER", "VIEWER"].includes(role)) {
      return res.status(400).json({ error: "role must be ADMIN, MEMBER, or VIEWER" });
    }

    const project = await prisma.project.findFirst({ where: { id: projectId, orgId }, select: { id: true } });
    if (!project) return res.status(404).json({ error: "Project not found" });

    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) return res.status(404).json({ error: "Member not found" });

    const updated = await prisma.projectMember.update({
      where: { id: member.id },
      data: { role },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });

    await logAuditEvent({
      orgId,
      projectId,
      actorId,
      entityType: "project_member",
      entityId: userId,
      action: "project_member.role_change",
      metadata: { previousRole: member.role, newRole: role },
    });

    return res.json({
      id: updated.id,
      userId: updated.user.id,
      name: updated.user.name ?? updated.user.email,
      email: updated.user.email,
      systemRole: updated.user.role,
      projectRole: updated.role,
    });
  } catch {
    return res.status(500).json({ error: "Failed to update member role" });
  }
});

/* ═══════════════════════════════════════════════════════════
   DELETE /projects/:projectId/members/:userId – remove
   member from project + chat room
   ═══════════════════════════════════════════════════════════ */
router.delete("/:projectId/members/:userId", requirePermission(Actions.ProjectCreate), async (req, res) => {
  try {
    const orgId = getOrgId(req, res);
    const actorId = getActorId(res);
    const { projectId, userId } = req.params;

    const project = await prisma.project.findFirst({
      where: { id: projectId, orgId },
      include: { chatRoom: { select: { id: true } } },
    });
    if (!project) return res.status(404).json({ error: "Project not found" });

    // Can't remove the project owner
    if (project.ownerId === userId) {
      return res.status(400).json({ error: "Cannot remove the project owner. Transfer ownership first." });
    }

    const member = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) return res.status(404).json({ error: "Member not found" });

    await prisma.$transaction(async (tx) => {
      // Remove from project
      await tx.projectMember.delete({ where: { id: member.id } });

      // Remove from project chat room
      if (project.chatRoom) {
        await tx.chatParticipant.deleteMany({
          where: { roomId: project.chatRoom.id, userId },
        });
      }
    });

    await logAuditEvent({
      orgId,
      projectId,
      actorId,
      entityType: "project_member",
      entityId: userId,
      action: "project_member.remove",
    });

    return res.json({ message: "Member removed" });
  } catch {
    return res.status(500).json({ error: "Failed to remove member" });
  }
});

export default router;
