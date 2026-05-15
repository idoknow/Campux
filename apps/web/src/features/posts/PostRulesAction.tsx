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
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";

function RuleButton() {
  return (
    <button className="mt-2 block w-fit rounded-md border px-3 py-2 text-left text-sm font-medium product-accent-amber hover:bg-amber-100/60">
      <span>
        请务必遵守 <strong className="inline font-bold">投稿规则</strong>
      </span>
    </button>
  );
}

function RuleList({ rules }: { rules: string[] }) {
  return (
    <div className="flex flex-col gap-2 px-4 md:px-5">
      {rules.map((rule, index) => (
        <Alert key={rule} className="rounded-md">
          <CheckIcon />
          <AlertTitle>规则 {index + 1}</AlertTitle>
          <AlertDescription>{rule}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

export function PostRulesAction({ rules }: { rules: string[] }) {
  return (
    <>
      <div className="md:hidden">
        <Drawer>
          <DrawerTrigger asChild>
            <RuleButton />
          </DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>投稿规则</DrawerTitle>
              <DrawerDescription>发布前请确认内容符合当前校园墙规范。</DrawerDescription>
            </DrawerHeader>
            <RuleList rules={rules} />
            <DrawerFooter>
              <DrawerClose asChild>
                <Button>好的</Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      </div>

      <div className="hidden md:block">
        <Dialog>
          <DialogTrigger asChild>
            <RuleButton />
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>投稿规则</DialogTitle>
              <DialogDescription>发布前请确认内容符合当前校园墙规范。</DialogDescription>
            </DialogHeader>
            <RuleList rules={rules} />
            <DialogFooter>
              <DialogClose asChild>
                <Button>好的</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
