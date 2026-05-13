import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const passwordHash = await Bun.password.hash("campux123");

const tenants = [
  {
    id: "tenant-canton",
    slug: "canton-wall",
    name: "广府校园墙",
    themeColor: "#e0574f",
    banner: "今晚 22:30 后投稿会顺延到明早审核，请勿重复提交同一内容。",
  },
  {
    id: "tenant-riverside",
    slug: "riverside",
    name: "江岸同学墙",
    themeColor: "#2f8f7b",
    banner: "江岸同学墙试运行中，欢迎提交校园服务建议。",
  },
];

const postRules = [
  "不发布隐私信息、辱骂、人身攻击和未经确认的指控。",
  "寻物招领请写清地点、时间和联系方式。",
  "图片最多 9 张，审核通过后会同步到本校启用的 QQ 墙号。",
];

const services = [
  { title: "修改密码", description: "账号服务" },
  { title: "投稿规则", description: "查看本墙规范" },
  { title: "校园服务", description: "推荐入口" },
];

async function seedTenant(tenant: (typeof tenants)[number]) {
  await prisma.tenant.upsert({
    where: { id: tenant.id },
    update: {
      slug: tenant.slug,
      name: tenant.name,
      status: "active",
      themeColor: tenant.themeColor,
    },
    create: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: "active",
      themeColor: tenant.themeColor,
    },
  });

  for (const entry of [
    { key: "brand", value: tenant.name },
    { key: "banner", value: tenant.banner },
    { key: "post_rules", value: postRules },
    { key: "services", value: services },
  ]) {
    await prisma.tenantMetadata.upsert({
      where: {
        tenantId_key: {
          tenantId: tenant.id,
          key: entry.key,
        },
      },
      update: {
        value: entry.value,
      },
      create: {
        tenantId: tenant.id,
        key: entry.key,
        value: entry.value,
      },
    });
  }

  const botAccount = await prisma.botAccount.upsert({
    where: {
      tenantId_qqUin: {
        tenantId: tenant.id,
        qqUin: BigInt(tenant.id === "tenant-canton" ? "2854199010" : "2854199020"),
      },
    },
    update: {
      displayName: `${tenant.name} 1 号墙`,
      enabled: true,
      reviewGroupId: tenant.id === "tenant-canton" ? "91000001" : "91000002",
    },
    create: {
      tenantId: tenant.id,
      qqUin: BigInt(tenant.id === "tenant-canton" ? "2854199010" : "2854199020"),
      displayName: `${tenant.name} 1 号墙`,
      enabled: true,
      reviewGroupId: tenant.id === "tenant-canton" ? "91000001" : "91000002",
    },
  });

  await prisma.publishTarget.upsert({
    where: {
      id: `${tenant.id}-qzone-primary`,
    },
    update: {
      botAccountId: botAccount.id,
      displayName: "主墙号",
      enabled: true,
      required: true,
    },
    create: {
      id: `${tenant.id}-qzone-primary`,
      tenantId: tenant.id,
      botAccountId: botAccount.id,
      displayName: "主墙号",
      enabled: true,
      required: true,
    },
  });
}

async function seedUser({
  qqUin,
  displayName,
  systemRole,
  memberships,
  isTestAccount = true,
}: {
  qqUin: string;
  displayName: string;
  systemRole?: "system_operator";
  memberships: Array<{ tenantId: string; role: "submitter" | "reviewer" | "admin" }>;
  isTestAccount?: boolean;
}) {
  const user = await prisma.user.upsert({
    where: { qqUin: BigInt(qqUin) },
    update: {
      displayName,
      passwordHash,
      isTestAccount,
      systemRole: systemRole ?? null,
    },
    create: {
      qqUin: BigInt(qqUin),
      displayName,
      passwordHash,
      isTestAccount,
      systemRole: systemRole ?? null,
    },
  });

  for (const membership of memberships) {
    await prisma.tenantMembership.upsert({
      where: {
        tenantId_userId: {
          tenantId: membership.tenantId,
          userId: user.id,
        },
      },
      update: {
        role: membership.role,
      },
      create: {
        tenantId: membership.tenantId,
        userId: user.id,
        role: membership.role,
      },
    });
  }
}

for (const tenant of tenants) {
  await seedTenant(tenant);
}

await seedUser({
  qqUin: "10000",
  displayName: "投稿测试号",
  memberships: [{ tenantId: "tenant-canton", role: "submitter" }],
});

await seedUser({
  qqUin: "20000",
  displayName: "审核测试号",
  memberships: [{ tenantId: "tenant-canton", role: "reviewer" }],
});

await seedUser({
  qqUin: "30000",
  displayName: "多墙管理员",
  memberships: [
    { tenantId: "tenant-canton", role: "admin" },
    { tenantId: "tenant-riverside", role: "admin" },
  ],
});

await seedUser({
  qqUin: "40000",
  displayName: "系统运维",
  systemRole: "system_operator",
  memberships: [{ tenantId: "tenant-canton", role: "admin" }],
});

console.log("Seeded CampuxNext demo tenants and accounts. Password for all accounts: campux123");

await prisma.$disconnect();
