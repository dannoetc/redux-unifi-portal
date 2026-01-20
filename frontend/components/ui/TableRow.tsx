import * as React from "react";

import { cn } from "@/lib/utils";
import { TableRow as BaseRow } from "@/components/ui/table";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <BaseRow ref={ref} className={cn("last:border-b-0 [&>td]:py-2 [&>td]:px-4", className)} {...props} />
  )
);
TableRow.displayName = "TableRow";

export { TableRow };
