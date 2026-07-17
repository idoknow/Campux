import type { TenantMetadata } from "@/types/app";

type ServiceEntry = TenantMetadata["services"][number];

export type ServiceEntryDraft = {
  title: string;
  description: string;
  url: string;
};

export type BuiltInServiceEntryAction = "profile" | "password" | "rules";

const builtInServiceActions: Readonly<Record<string, BuiltInServiceEntryAction>> = {
  修改名称: "profile",
  修改密码: "password",
  投稿规则: "rules",
};

export function getBuiltInServiceEntryAction(service: Pick<ServiceEntry, "title">): BuiltInServiceEntryAction | null {
  return builtInServiceActions[service.title.trim()] ?? null;
}

export function isBuiltInServiceEntry(service: Pick<ServiceEntry, "title">) {
  return getBuiltInServiceEntryAction(service) !== null;
}

export function isSafeServiceEntryUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function toCustomServiceEntryDrafts(services: TenantMetadata["services"]): ServiceEntryDraft[] {
  return services
    .filter((service) => !isBuiltInServiceEntry(service))
    .map((service) => ({
      title: service.title,
      description: service.description ?? "",
      url: service.url ?? "",
    }));
}

export function createEmptyServiceEntryDraft(): ServiceEntryDraft {
  return { title: "", description: "", url: "" };
}

export function moveServiceEntryDraft(entries: ServiceEntryDraft[], fromIndex: number, toIndex: number) {
  if (
    fromIndex < 0
    || fromIndex >= entries.length
    || toIndex < 0
    || toIndex >= entries.length
    || fromIndex === toIndex
  ) {
    return entries;
  }

  const next = [...entries];
  const [moved] = next.splice(fromIndex, 1);
  if (!moved) return entries;
  next.splice(toIndex, 0, moved);
  return next;
}

export function prepareServiceEntriesForSave(entries: ServiceEntryDraft[]): TenantMetadata["services"] {
  return entries.map((entry, index) => {
    const title = entry.title.trim();
    const description = entry.description.trim();
    const url = entry.url.trim();

    if (!title) {
      throw new Error(`第 ${index + 1} 个服务入口缺少名称。`);
    }
    if (isBuiltInServiceEntry({ title })) {
      throw new Error(`第 ${index + 1} 个服务入口使用了固定账户入口名称，请更换名称。`);
    }
    if (url && !isSafeServiceEntryUrl(url)) {
      throw new Error(`第 ${index + 1} 个服务入口的跳转链接必须使用 http 或 https`);
    }
    return {
      title,
      ...(description ? { description } : {}),
      ...(url ? { url } : {}),
    };
  });
}
