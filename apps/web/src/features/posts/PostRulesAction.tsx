import { forwardRef } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { CheckIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const ruleButtonClassName =
  "mt-2 block w-fit rounded-md border px-3 py-2 text-left text-sm font-medium product-accent-amber hover:bg-amber-100/60";

const RuleButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(function RuleButton({ className = "", ...props }, ref) {
  return (
    <button ref={ref} type="button" className={`${ruleButtonClassName} ${className}`} {...props}>
      <span>
        请务必遵守 <strong className="inline font-bold">投稿规则</strong>
      </span>
    </button>
  );
});

function RuleList({ rules }: { rules: string[] }) {
  // 不用 flex-1：在 Drawer/Dialog 的 flex 列里会把中间区域撑满，底部出现大片空白。
  // 本列表是唯一滚动层：overscroll-contain + touch-pan-y，避免链式滚到外层后卡死。
  return (
    <div className="max-h-[min(50dvh,calc(85dvh-11rem))] touch-pan-y overflow-y-auto overscroll-contain px-4 md:px-5">
      <div className="flex flex-col gap-2 pb-1">
        {rules.map((rule, index) => (
          <Alert key={rule} className="rounded-md">
            <CheckIcon />
            <AlertTitle>规则 {index + 1}</AlertTitle>
            <AlertDescription>{rule}</AlertDescription>
          </Alert>
        ))}
      </div>
    </div>
  );
}

export function PostRulesAction({ rules }: { rules: string[] }) {
  // 手机端原先用底部 Drawer，提示贴在屏幕下沿不好读；全端改用居中 Dialog。
  return (
    <Dialog>
      <DialogTrigger asChild>
        <RuleButton />
      </DialogTrigger>
      <DialogContent className="max-h-[min(720px,calc(100dvh-48px))]">
        <DialogHeader className="shrink-0">
          <DialogTitle>投稿规则</DialogTitle>
          <DialogDescription>发布前请确认内容符合当前校园墙规范。</DialogDescription>
        </DialogHeader>
        <RuleList rules={rules} />
        <DialogFooter className="shrink-0">
          <DialogClose asChild>
            <Button className="w-full font-medium sm:w-auto">好的</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
