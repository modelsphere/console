import { forwardRef } from "react";
import { Puzzle, type LucideIcon, type LucideProps } from "lucide-react";
import { DynamicIcon, dynamicIconImports, type IconName } from "lucide-react/dynamic";

const icons = new Map<string, LucideIcon>();

export function menuIcon(name?: string): LucideIcon {
  if (!name) return Puzzle;
  if (!Object.hasOwn(dynamicIconImports, name)) throw new Error(`Unsupported menu icon "${name}"`);
  const cached = icons.get(name);
  if (cached) return cached;
  const icon = forwardRef<SVGSVGElement, LucideProps>((props, ref) => (
    <DynamicIcon {...props} ref={ref} name={name as IconName} fallback={() => <Puzzle {...props} />} />
  ));
  icon.displayName = `PluginIcon(${name})`;
  icons.set(name, icon);
  return icon;
}
