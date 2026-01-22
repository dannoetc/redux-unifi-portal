"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";

import { cn } from "@/lib/utils";

type PopoverMenuContextValue = {
  closeMenu: () => void;
};

const PopoverMenuContext = React.createContext<PopoverMenuContextValue | null>(null);

type PopoverMenuProps = {
  trigger: React.ReactElement;
  children: React.ReactNode;
  align?: "start" | "center" | "end";
  sideOffset?: number;
  contentClassName?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

const getMenuItems = (container: HTMLElement | null) => {
  if (!container) {
    return [];
  }
  const items = Array.from(
    container.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
  );
  return items.filter((item) => !item.hasAttribute("disabled"));
};

export function PopoverMenu({
  trigger,
  children,
  align = "end",
  sideOffset = 6,
  contentClassName,
  open,
  onOpenChange,
}: PopoverMenuProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  const isControlled = open !== undefined;
  const resolvedOpen = isControlled ? open : internalOpen;

  const setOpen = React.useCallback(
    (value: boolean) => {
      if (!isControlled) {
        setInternalOpen(value);
      }
      onOpenChange?.(value);
    },
    [isControlled, onOpenChange]
  );

  const triggerElement = React.isValidElement(trigger)
    ? React.cloneElement(
        trigger as React.ReactElement<React.HTMLAttributes<HTMLElement>>,
        {
          "aria-haspopup": "menu",
          "aria-expanded": resolvedOpen,
        } as React.HTMLAttributes<HTMLElement>
      )
    : trigger;

  const handleOpenAutoFocus = React.useCallback((event: Event) => {
    event.preventDefault();
    const [first] = getMenuItems(contentRef.current);
    if (first) {
      first.focus();
    }
  }, []);

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = getMenuItems(contentRef.current);
    if (items.length === 0) {
      return;
    }
    const currentIndex = items.findIndex((item) => item === document.activeElement);
    const focusItem = (index: number) => {
      const item = items[index];
      if (item) {
        item.focus();
      }
    };

    switch (event.key) {
      case "ArrowDown": {
        event.preventDefault();
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % items.length;
        focusItem(nextIndex);
        break;
      }
      case "ArrowUp": {
        event.preventDefault();
        const nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
        focusItem(nextIndex);
        break;
      }
      case "Home": {
        event.preventDefault();
        focusItem(0);
        break;
      }
      case "End": {
        event.preventDefault();
        focusItem(items.length - 1);
        break;
      }
      case "Escape": {
        event.preventDefault();
        setOpen(false);
        break;
      }
      case "Tab": {
        setOpen(false);
        break;
      }
      default:
        break;
    }
  }, [setOpen]);

  return (
    <Popover.Root open={resolvedOpen} onOpenChange={setOpen}>
      <Popover.Trigger asChild>{triggerElement}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={contentRef}
          role="menu"
          align={align}
          sideOffset={sideOffset}
          className={cn(
            "z-50 min-w-[200px] rounded-md border border-border bg-white p-1 shadow-soft outline-none",
            contentClassName
          )}
          onOpenAutoFocus={handleOpenAutoFocus}
          onKeyDown={handleKeyDown}
        >
          <PopoverMenuContext.Provider value={{ closeMenu: () => setOpen(false) }}>
            {children}
          </PopoverMenuContext.Provider>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

type PopoverMenuItemProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const PopoverMenuItem = React.forwardRef<HTMLButtonElement, PopoverMenuItemProps>(
  ({ className, disabled, onClick, ...props }, ref) => {
    const menu = React.useContext(PopoverMenuContext);

    return (
      <button
        ref={ref}
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-disabled={disabled}
        disabled={disabled}
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/40",
          disabled && "cursor-not-allowed text-muted-foreground hover:bg-transparent",
          className
        )}
        onClick={(event) => {
          if (disabled) {
            event.preventDefault();
            return;
          }
          onClick?.(event);
          menu?.closeMenu();
        }}
        {...props}
      />
    );
  }
);
PopoverMenuItem.displayName = "PopoverMenuItem";

export function PopoverMenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cn("my-1 h-px bg-border/70", className)} />;
}
