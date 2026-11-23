import { matchPath } from "react-router";
import { routeSpecificity } from "./module";
import type { LucideIcon } from "lucide-react";

export interface ApplicationItem {
  id: string;
  ns: string;
  scope: string;
  label: string;
  icon: LucideIcon;
  to: string;
  paths: string[];
}

export function activeApplication(items: ApplicationItem[], pathname: string): string | undefined {
  return items.flatMap(item => item.paths.filter(path => matchPath({ path, end: false }, pathname))
    .map(path => ({ id: item.id, specificity: routeSpecificity(path) })))
    .sort((left, right) => right.specificity - left.specificity)[0]?.id;
}
