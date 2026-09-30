import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@riseaicloud/ui";

// Guidance that costs no vertical space until it is asked for: the label wears
// a small Info mark, and the text appears beside it.
//
// The provider is local rather than mounted once in the shell: these are the
// only tooltips the module draws, and a hint that works wherever it is dropped
// is worth more here than a shared delay.
export function HoverHint({ text, children }: { text?: string; children: React.ReactNode }) {
  if (!text) return children;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex min-w-0 items-center gap-1">
            {children}
            <Info className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent className="w-64 text-xs leading-snug font-normal">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
