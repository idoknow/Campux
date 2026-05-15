import { useState } from "react";
import { BookOpenIcon, CheckIcon, ChevronRightIcon, ExternalLinkIcon, KeyRoundIcon, SparklesIcon, WandSparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { defaultMetadata } from "@/lib/app-model";
import type { TenantMetadata } from "@/types/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ServiceAction = "password" | "rules" | "";

const servicePalettes = [
  {
    shell: "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/35",
    icon: "product-accent-blue",
  },
  {
    shell: "border-slate-200 bg-white hover:border-green-200 hover:bg-green-50/35",
    icon: "product-accent-green",
  },
  {
    shell: "border-slate-200 bg-white hover:border-amber-200 hover:bg-amber-50/35",
    icon: "product-accent-amber",
  },
  {
    shell: "border-slate-200 bg-white hover:border-rose-200 hover:bg-rose-50/35",
    icon: "product-accent-rose",
  },
];
const defaultServicePalette = {
  shell: "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/35",
  icon: "product-accent-blue",
};

export function ServicesPage({ metadata }: { metadata: TenantMetadata }) {
  const entries = metadata.services.length > 0 ? metadata.services : defaultMetadata.services;
  const rules = metadata.postRules.length > 0 ? metadata.postRules : defaultMetadata.postRules;
  const [activeAction, setActiveAction] = useState<ServiceAction>("");

  function openService(service: TenantMetadata["services"][number]) {
    if (service.url) {
      window.open(service.url, "_blank", "noopener,noreferrer");
      return;
    }
    if (service.title.includes("密码") || service.title.includes("账号")) {
      setActiveAction("password");
      return;
    }
    if (service.title.includes("规则") || service.title.includes("指南")) {
      setActiveAction("rules");
      return;
    }

    toast.info(`${service.title} 还没有配置跳转链接。`);
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-4 pt-4">
      <div className="min-h-0 flex-1 overflow-y-auto pb-24 pr-1 md:pb-6">
        <div className="product-surface p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {entries.map((service, index) => (
              <ServiceTile key={service.title} service={service} index={index} onOpen={() => openService(service)} />
            ))}
          </div>
        </div>

        {activeAction === "password" ? <PasswordPanel onDone={(message) => toast.success(message)} /> : null}
        {activeAction === "rules" ? <RulesPanel rules={rules} /> : null}
      </div>
    </div>
  );
}

function ServiceTile({ service, index, onOpen }: { service: TenantMetadata["services"][number]; index: number; onOpen: () => void }) {
  const palette = servicePalettes[index % servicePalettes.length] ?? defaultServicePalette;
  const Icon = pickServiceIcon(service.title);

  return (
    <button className={`flex min-h-20 items-center gap-3 rounded-md border p-3 text-left shadow-none transition ${palette.shell}`} onClick={onOpen}>
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md border ${palette.icon}`}>
        <Icon className="size-5" strokeWidth={2.1} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-950">{service.title}</span>
        <span className="mt-0.5 block text-sm leading-5 text-slate-600">{service.description ?? "校园服务"}</span>
      </span>
      {service.url ? <ExternalLinkIcon className="size-5 shrink-0 text-slate-400" /> : <ChevronRightIcon className="size-5 shrink-0 text-slate-400" />}
    </button>
  );
}

function PasswordPanel({ onDone }: { onDone: (message: string) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      onDone("密码已更新。");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "修改失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="product-surface mt-4 p-4">
      <div className="flex items-center gap-2">
        <KeyRoundIcon className="size-5 text-slate-500" />
        <p className="text-base font-semibold">修改密码</p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Input type="password" placeholder="当前密码" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        <Input type="password" placeholder="新密码，至少 6 位" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
      </div>
      <Button className="mt-3 font-medium" disabled={busy || currentPassword.length === 0 || newPassword.length < 6} onClick={() => void submit()}>
        <CheckIcon data-icon="inline-start" />
        保存新密码
      </Button>
    </section>
  );
}

function RulesPanel({ rules }: { rules: string[] }) {
  return (
    <section className="product-surface mt-4 p-4">
      <div className="flex items-center gap-2">
        <BookOpenIcon className="size-5 text-slate-500" />
        <p className="text-base font-semibold">投稿规则</p>
      </div>
      <div className="mt-3 grid gap-2">
        {rules.map((rule, index) => (
          <p key={rule} className="rounded-md border border-slate-100 bg-white px-3 py-2 text-sm text-slate-700">
            {index + 1}. {rule}
          </p>
        ))}
      </div>
    </section>
  );
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
