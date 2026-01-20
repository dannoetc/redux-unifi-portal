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
    <div className="mb-4 px-2">
      <label className="sr-only" htmlFor="tenant-switcher">
        Tenant
      </label>
      <select
        id="tenant-switcher"
        aria-label="Tenant"
        value={value ?? ""}
        onChange={(event) => onChange?.(event.target.value)}
        className="w-full rounded-md border border-input bg-white/90 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-400 focus:ring-offset-2 focus:ring-offset-white"
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
