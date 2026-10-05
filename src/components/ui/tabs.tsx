import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "cn";

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      className={cn("flex flex-col", className)}
      data-slot="tabs"
      {...props}
    />
  );
}

function TabsList({ className, children, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      className={cn(
        "bg-foreground/5 relative isolate inline-flex w-fit items-center rounded-full p-1",
        className
      )}
      data-slot="tabs-list"
      {...props}
    >
      {children}
      <TabsPrimitive.Indicator className="bg-card shadow-surface absolute top-0 left-0 -z-10 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) translate-y-(--active-tab-top) rounded-full transition-[translate,width] duration-200 ease-out" />
    </TabsPrimitive.List>
  );
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        "text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 data-active:text-foreground inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none select-none focus-visible:ring-3",
        className
      )}
      data-slot="tabs-trigger"
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      className={cn("flex-1 outline-none", className)}
      data-slot="tabs-content"
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
