import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PopoverMenu, PopoverMenuItem, PopoverMenuLink, PopoverMenuSeparator } from "@/components/ui/PopoverMenu";

describe("PopoverMenu", () => {
  it("renders trigger with correct ARIA attributes", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <PopoverMenu trigger={<button type="button">Actions</button>}>
        <PopoverMenuItem>First</PopoverMenuItem>
      </PopoverMenu>
    );

    const trigger = screen.getAllByRole("button", { name: "Actions" })[0];
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it("opens and closes with click", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <PopoverMenu trigger={<button type="button">Actions</button>}>
        <PopoverMenuItem>First</PopoverMenuItem>
      </PopoverMenu>
    );

    const trigger = screen.getAllByRole("button", { name: "Actions" })[0];
    await user.click(trigger);

    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();

    await user.click(trigger);
    await waitForElementToBeRemoved(() => screen.queryByRole("menu"));
  });

  it("supports arrow key navigation", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <PopoverMenu trigger={<button type="button">Actions</button>}>
        <PopoverMenuItem>First</PopoverMenuItem>
        <PopoverMenuSeparator />
        <PopoverMenuItem>Second</PopoverMenuItem>
      </PopoverMenu>
    );

    const trigger = screen.getAllByRole("button", { name: "Actions" })[0];
    await user.click(trigger);

    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(items[0]).toHaveFocus();

    await user.keyboard("{End}");
    expect(items[1]).toHaveFocus();

    await user.keyboard("{Home}");
    expect(items[0]).toHaveFocus();
  });

  it("closes on Escape key", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <PopoverMenu trigger={<button type="button">Actions</button>}>
        <PopoverMenuItem>First</PopoverMenuItem>
      </PopoverMenu>
    );

    const trigger = screen.getAllByRole("button", { name: "Actions" })[0];
    await user.click(trigger);

    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitForElementToBeRemoved(() => screen.queryByRole("menu"));
  });

  it("closes when menu item is clicked", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onClick = vi.fn();

    render(
      <PopoverMenu trigger={<button type="button">Actions</button>}>
        <PopoverMenuItem onClick={onClick}>First</PopoverMenuItem>
      </PopoverMenu>
    );

    const trigger = screen.getAllByRole("button", { name: "Actions" })[0];
    await user.click(trigger);

    const menu = await screen.findByRole("menu");
    const item = screen.getByRole("menuitem", { name: "First" });

    await user.click(item);
    expect(onClick).toHaveBeenCalled();
    await waitForElementToBeRemoved(() => screen.queryByRole("menu"));
  });

  it("renders PopoverMenuLink with correct role and closes on click", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <PopoverMenu trigger={<button type="button">Actions</button>}>
        <PopoverMenuLink href="/test">Go to test</PopoverMenuLink>
      </PopoverMenu>
    );

    const trigger = screen.getAllByRole("button", { name: "Actions" })[0];
    await user.click(trigger);

    const link = screen.getByRole("menuitem", { name: "Go to test" });
    expect(link).toHaveAttribute("href", "/test");

    const menu = await screen.findByRole("menu");
    await user.click(link);
    await waitForElementToBeRemoved(() => screen.queryByRole("menu"));
  });

  it("supports disabled menu items", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onClick = vi.fn();

    render(
      <PopoverMenu trigger={<button type="button">Actions</button>}>
        <PopoverMenuItem disabled onClick={onClick}>
          Disabled
        </PopoverMenuItem>
        <PopoverMenuItem>Enabled</PopoverMenuItem>
      </PopoverMenu>
    );

    const trigger = screen.getAllByRole("button", { name: "Actions" })[0];
    await user.click(trigger);

    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveAttribute("aria-disabled", "true");

    await user.click(items[0]);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders separator with correct role", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <PopoverMenu trigger={<button type="button">Actions</button>}>
        <PopoverMenuItem>First</PopoverMenuItem>
        <PopoverMenuSeparator />
        <PopoverMenuItem>Second</PopoverMenuItem>
      </PopoverMenu>
    );

    const trigger = screen.getAllByRole("button", { name: "Actions" })[0];
    await user.click(trigger);

    const separator = screen.getByRole("separator");
    expect(separator).toBeInTheDocument();
  });

  it("closes on Tab key", async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <PopoverMenu trigger={<button type="button">Actions</button>}>
        <PopoverMenuItem>First</PopoverMenuItem>
      </PopoverMenu>
    );

    const trigger = screen.getAllByRole("button", { name: "Actions" })[0];
    await user.click(trigger);

    const menu = await screen.findByRole("menu");
    expect(menu).toBeInTheDocument();

    await user.keyboard("{Tab}");
    await waitForElementToBeRemoved(() => screen.queryByRole("menu"));
  });
});
