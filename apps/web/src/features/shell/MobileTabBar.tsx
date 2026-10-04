import { useEffect, useRef, useState } from "react";
import type { NavItem } from "@/lib/app-model";
import type { MainTab } from "@/types/app";

export function MobileTabBar({ navItems, value, onValueChange }: { navItems: NavItem[]; value: MainTab; onValueChange: (value: MainTab) => void }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = useState({ x: 0, width: 0, visible: false });
  const [animKey, setAnimKey] = useState(0);

  const syncIndicator = () => {
    const list = listRef.current;
    const trigger = triggerRefs.current[value];
    if (!list || !trigger) return;

    const listRect = list.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const paddingX = 12;

    setIndicator({
      x: triggerRect.left - listRect.left + paddingX,
      width: triggerRect.width - paddingX * 2,
      visible: true,
    });
  };

  useEffect(() => {
    syncIndicator();
    const handleResize = syncIndicator;
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [value, navItems.length]);

  return (
    <div
      ref={listRef}
      className="fixed inset-x-0 bottom-0 z-40 h-[64px] w-full border-t border-slate-200 bg-white px-3 pb-2 pt-1.5 shadow-none md:hidden"
    >
      <div className="relative grid h-[52px] w-full gap-0" style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = item.value === value;

          return (
            <button
              key={item.value}
              type="button"
              ref={(el) => {
                triggerRefs.current[item.value] = el;
              }}
              onClick={() => {
                onValueChange(item.value);
                setAnimKey((k) => k + 1);
              }}
              aria-current={active ? "page" : undefined}
              className="relative z-10 flex h-[52px] w-full flex-col items-center justify-center gap-1 rounded-none border-0 bg-transparent p-0 text-[12px] font-medium leading-none text-slate-500 transition-colors duration-200 hover:text-slate-700 focus-visible:outline-none focus-visible:text-slate-900 data-active:text-blue-700"
            >
              <Icon className="size-5" strokeWidth={2.1} />
              {item.label}
            </button>
          );
        })}
      </div>

      <span
        aria-hidden
        className={`absolute bottom-0 left-0 h-[3px] rounded-full bg-blue-600 transition-[left,width] duration-500 ease-[cubic-bezier(0.65,0,0.35,1)] ${indicator.visible ? "opacity-100" : "opacity-0"}`}
        style={{
          left: `${indicator.x}px`,
          width: `${indicator.width}px`,
        }}
      >
        <span
          key={animKey}
          aria-hidden
          className="mobile-tabbar-liquid absolute inset-0 rounded-full bg-blue-600"
          style={{ transformOrigin: "center" }}
        />
      </span>
      <style>{`
        @keyframes mobile-tabbar-liquid {
          0% { transform: scaleX(1); opacity: 0.9; }
          20% { transform: scaleX(2.6); opacity: 1; }
          55% { transform: scaleX(0.75); opacity: 0.85; }
          80% { transform: scaleX(1.08); opacity: 0.98; }
          100% { transform: scaleX(1); opacity: 1; }
        }
        .mobile-tabbar-liquid {
          animation: mobile-tabbar-liquid 0.72s cubic-bezier(0.65, 0, 0.35, 1);
        }
      `}</style>
    </div>
  );
}
