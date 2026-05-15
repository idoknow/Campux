import type { NavItem } from "@/lib/app-model";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

export function MobileTabBar({ navItems }: { navItems: NavItem[] }) {
  return (
    <TabsList
      className="fixed inset-x-0 bottom-0 z-40 grid !h-[64px] w-full max-w-none rounded-none border-x-0 border-b-0 border-t border-slate-200 bg-white px-3 py-1.5 shadow-none md:hidden"
      style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
    >
      {navItems.map((item) => {
        const Icon = item.icon;

        return (
          <TabsTrigger
            key={item.value}
            value={item.value}
            className="h-[52px] flex-col gap-1 rounded-md text-[12px] font-medium leading-none text-slate-500 shadow-none data-active:bg-blue-50 data-active:text-blue-700 data-active:shadow-none"
          >
            <Icon className="size-5" strokeWidth={2.1} />
            {item.label}
          </TabsTrigger>
        );
      })}
    </TabsList>
  );
}
