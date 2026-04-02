import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import crypto from "crypto";

const prisma = new PrismaClient();

async function main() {
  const orgId = "org_default";
  await prisma.organization.upsert({
    where: { id: orgId },
    update: { name: "Default Org", slug: "default" },
    create: { id: orgId, name: "Default Org", slug: "default" },
  });

  const users = [
    { email: "admin@codesila.local", name: "Admin User", role: "ADMIN" },
    { email: "devops@codesila.local", name: "DevOps Engineer", role: "DEVOPS" },
    { email: "dev@codesila.local", name: "Developer", role: "DEVELOPER" },
    { email: "manager@codesila.local", name: "Project Manager", role: "MANAGER" },
  ] as const;

  const results = [] as Array<{ email: string; password: string }>;

  for (const user of users) {
    const password = crypto.randomBytes(8).toString("base64url");
    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        role: user.role,
        passwordHash,
        isActive: true,
        orgId,
      },
      create: {
        email: user.email,
        name: user.name,
        role: user.role,
        passwordHash,
        isActive: true,
        orgId,
      },
    });

    results.push({ email: user.email, password });
  }

  console.log("✅ Seed complete");
  console.table(results);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
