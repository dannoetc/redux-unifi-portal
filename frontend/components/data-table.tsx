"use client";

import * as React from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { Table, TableBody, TableCell, TableHead, TableHeader } from "@/components/ui/table";
import { TableRow } from "@/components/ui/TableRow";
import { cn } from "@/lib/utils";

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
};

type ColumnMeta = {
  headerClassName?: string;
  cellClassName?: string;
  hiddenOnMobile?: boolean;
  showOnMobileOnly?: boolean;
};

export function DataTable<TData, TValue>({ columns, data }: DataTableProps<TData, TValue>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <Table className="min-w-full md:min-w-[720px] [&_th]:h-10 [&_th]:text-[11px] [&_th]:tracking-wide">
      <TableHeader>
        {table.getHeaderGroups().map((headerGroup) => (
          <TableRow key={headerGroup.id}>
            {headerGroup.headers.map((header) => (
              <TableHead
                key={header.id}
                data-hidden={(header.column.columnDef.meta as ColumnMeta | undefined)?.hiddenOnMobile}
                className={cn(
                  (header.column.columnDef.meta as ColumnMeta | undefined)?.headerClassName,
                  (header.column.columnDef.meta as ColumnMeta | undefined)?.showOnMobileOnly
                    ? "md:hidden"
                    : undefined
                )}
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows?.length ? (
          table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  data-hidden={(cell.column.columnDef.meta as ColumnMeta | undefined)?.hiddenOnMobile}
                  className={cn(
                    (cell.column.columnDef.meta as ColumnMeta | undefined)?.cellClassName,
                    (cell.column.columnDef.meta as ColumnMeta | undefined)?.showOnMobileOnly
                      ? "md:hidden"
                      : undefined
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
              No results.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
