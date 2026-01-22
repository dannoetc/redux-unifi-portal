import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { PopoverMenu, PopoverMenuItem, PopoverMenuSeparator } from "@/components/ui/PopoverMenu";

describe("PopoverMenu", () => {
  it("opens and supports keyboard navigation", async () => {
    const user = userEvent.setup();
    render(
      <PopoverMenu trigger={<button type="button">Actions</button>}>
        <PopoverMenuItem>First</PopoverMenuItem>
        <PopoverMenuSeparator />
        <PopoverMenuItem>Second</PopoverMenuItem>
      </PopoverMenu>
    );

    const trigger = screen.getByRole("button", { name: "Actions" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");

    await user.click(trigger);

    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();

    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(items[0]).toHaveFocus();
  });
});
