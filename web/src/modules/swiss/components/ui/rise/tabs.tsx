import { Tabs as RiseTabs, TabsList, TabsTrigger } from "@riseaicloud/ui";

export interface Tab {
  id: string;
  label: string;
  disabled?: boolean;
  hint?: string;
}

// A tab bar, not a tab set: callers render the active panel themselves, so
// there is no TabsContent to pair with these triggers.
export function Tabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: Tab[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <RiseTabs value={active} onValueChange={onSelect}>
      <TabsList className="flex-wrap">
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id} disabled={t.disabled} title={t.hint}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </RiseTabs>
  );
}
