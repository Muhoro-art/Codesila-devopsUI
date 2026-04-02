const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const bindings = await p.projectIntegration.findMany({
    where: { project: { orgId: 'org_default' } },
    include: { integration: { select: { name: true, type: true } }, project: { select: { name: true } } }
  });
  bindings.forEach(b => {
    console.log(b.project.name, '|', b.integration.name, '('+b.integration.type+')', '|', JSON.stringify(b.configJson));
  });
  await p.$disconnect();
}

main();
