import React from "react";

type TenantOption = {
  label: string;
  value: string;
};

export default function TenantSwitcher({
  value,
  options,
  onChange,
}: {
  value?: string;
  options: TenantOption[];
  onChange?: (value: string) => void;
}) {
  return (
    <div className="mb-4">
      <label className="mb-2 block text-[11px] uppercase tracking-wide text-muted-foreground" htmlFor="tenant-switcher">
        Tenant
      </label>
      <select
        id="tenant-switcher"
        aria-label="Tenant"
        value={value ?? ""}
        onChange={(event) => onChange?.(event.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {options.length === 0 ? <option value="">No tenants</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
