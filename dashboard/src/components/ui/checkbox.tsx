import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <div className="relative flex items-center justify-center">
    <input
      type="checkbox"
      className={cn(
        "peer size-4 shrink-0 appearance-none rounded-[4px] border border-primary ring-offset-background transition-colors checked:bg-primary checked:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
    <Check
      strokeWidth={3}
      className="pointer-events-none absolute size-3 text-primary-foreground opacity-0 peer-checked:opacity-100"
    />
  </div>
));
Checkbox.displayName = "Checkbox";

export { Checkbox };
