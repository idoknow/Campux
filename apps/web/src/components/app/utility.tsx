import type { LucideIcon } from "lucide-react";
import { ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function SectionHeader({
  title,
  subtitle,
  action,
  icon: Icon,
  onAction,
}: {
  title: string;
  subtitle: string;
  action?: string;
  icon?: typeof RefreshCwIcon;
  onAction?: () => void | Promise<void>;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold tracking-normal text-slate-950">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action && Icon ? (
        <Button variant="outline" size="sm" onClick={() => void onAction?.()}>
          <Icon data-icon="inline-start" />
          {action}
        </Button>
      ) : null}
    </div>
  );
}

export function ListButton({ title, description, icon: Icon }: { title: string; description: string; icon: LucideIcon }) {
  return (
    <Button variant="outline" className="h-auto justify-start gap-3 rounded-md p-3">
      <Icon data-icon="inline-start" />
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </span>
      <ChevronRightIcon data-icon="inline-end" />
    </Button>
  );
}

export function EmptyCard({ title }: { title: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center px-4 py-6 text-center text-sm font-bold text-slate-500">{title}</div>
  );
}
