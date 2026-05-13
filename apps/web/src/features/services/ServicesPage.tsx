import { BookOpenIcon, ChevronRightIcon, ExternalLinkIcon, KeyRoundIcon, SparklesIcon, WandSparklesIcon } from "lucide-react";
import { defaultMetadata } from "@/lib/app-model";
import type { TenantMetadata } from "@/types/app";
import { SectionHeader } from "@/components/app/utility";

const servicePalettes = [
  {
    shell: "border-[#bceaff] bg-[#effaff]",
    icon: "bg-[#42a5f5] text-white",
  },
  {
    shell: "border-[#d2efb9] bg-[#f4ffe9]",
    icon: "bg-[#8bc34a] text-white",
  },
  {
    shell: "border-[#ffd596] bg-[#fff8e8]",
    icon: "bg-[#f8b94c] text-white",
  },
  {
    shell: "border-[#ffc9d6] bg-[#fff0f4]",
    icon: "bg-[#ff7d9a] text-white",
  },
];
const defaultServicePalette = {
  shell: "border-[#bceaff] bg-[#effaff]",
  icon: "bg-[#42a5f5] text-white",
};

export function ServicesPage({ services }: { services: TenantMetadata["services"] }) {
  const entries = services.length > 0 ? services : defaultMetadata.services;
  return (
    <div className="px-4 pb-4">
      <SectionHeader title="服务" subtitle="校园墙常用入口" />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {entries.map((service, index) => (
          <ServiceTile key={service.title} service={service} index={index} />
        ))}
      </div>
    </div>
  );
}

function ServiceTile({ service, index }: { service: TenantMetadata["services"][number]; index: number }) {
  const palette = servicePalettes[index % servicePalettes.length] ?? defaultServicePalette;
  const Icon = pickServiceIcon(service.title);
  const content = (
    <>
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-[10px] ${palette.icon}`}>
        <Icon className="size-6" strokeWidth={2.4} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-black text-slate-950">{service.title}</span>
        <span className="mt-0.5 block text-sm leading-5 text-slate-600">{service.description ?? "校园服务"}</span>
      </span>
      {service.url ? <ExternalLinkIcon className="size-5 shrink-0 text-slate-400" /> : <ChevronRightIcon className="size-5 shrink-0 text-slate-400" />}
    </>
  );
  const className = `flex min-h-24 items-center gap-3 rounded-md border p-3 text-left shadow-none transition hover:-translate-y-0.5 hover:shadow-sm ${palette.shell}`;

  if (service.url) {
    return (
      <a href={service.url} target="_blank" rel="noreferrer" className={className}>
        {content}
      </a>
    );
  }

  return <div className={className}>{content}</div>;
}

function pickServiceIcon(title: string) {
  if (title.includes("密码") || title.includes("账号")) {
    return KeyRoundIcon;
  }
  if (title.includes("规则") || title.includes("指南") || title.includes("文档")) {
    return BookOpenIcon;
  }
  if (title.includes("推荐") || title.includes("活动")) {
    return WandSparklesIcon;
  }
  return SparklesIcon;
}
