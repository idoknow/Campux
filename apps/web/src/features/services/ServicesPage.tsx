import { KeyRoundIcon, SparklesIcon } from "lucide-react";
import { defaultMetadata } from "@/lib/app-model";
import type { TenantMetadata } from "@/types/app";
import { ListButton, SectionHeader } from "@/components/app/utility";

export function ServicesPage({ services }: { services: TenantMetadata["services"] }) {
  const entries = services.length > 0 ? services : defaultMetadata.services;
  return (
    <div className="px-4">
      <SectionHeader title="服务" subtitle="账号服务与推荐网站" />
      <div className="mt-3 flex flex-col gap-2">
        {entries.map((service) => (
          <ListButton key={service.title} title={service.title} description={service.description ?? "校园服务"} icon={service.title.includes("密码") ? KeyRoundIcon : SparklesIcon} />
        ))}
      </div>
    </div>
  );
}
