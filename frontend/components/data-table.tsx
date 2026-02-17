"use client";

import * as React from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  PaginationState,
  useReactTable,
} from "@tanstack/react-table";

import { Table, TableBody, TableCell, TableHead, TableHeader } from "@/components/ui/table";
import { TableRow } from "@/components/ui/TableRow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  enablePagination?: boolean;
  stickyHeader?: boolean;
  defaultPageSize?: number;
  pageSizeOptions?: number[];
};

type ColumnMeta = {
  headerClassName?: string;
  cellClassName?: string;
  hiddenOnMobile?: boolean;
  showOnMobileOnly?: boolean;
};

export function DataTable<TData, TValue>({
  columns,
  data,
  enablePagination = true,
  stickyHeader = true,
  defaultPageSize = 10,
  pageSizeOptions = [10, 25, 50],
}: DataTableProps<TData, TValue>) {
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });

  React.useEffect(() => {
    if (!enablePagination) {
      return;
    }
    const pageCount = Math.max(1, Math.ceil(data.length / pagination.pageSize));
    if (pagination.pageIndex >= pageCount) {
      setPagination((current) => ({ ...current, pageIndex: pageCount - 1 }));
    }
  }, [data.length, enablePagination, pagination.pageIndex, pagination.pageSize]);

  const table = useReactTable({
    data,
    columns,
    state: enablePagination ? { pagination } : undefined,
    onPaginationChange: enablePagination ? setPagination : undefined,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: enablePagination ? getPaginationRowModel() : undefined,
  });

  return (
    <div className="space-y-3">
      <Table className="min-w-full md:min-w-[720px] [&_th]:h-10 [&_th]:text-[11px] [&_th]:tracking-wide">
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  data-hidden={(header.column.columnDef.meta as ColumnMeta | undefined)?.hiddenOnMobile}
                  className={cn(
                    stickyHeader ? "sticky top-0 z-10 bg-card/95 backdrop-blur" : undefined,
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
      {enablePagination && data.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
          <div className="text-xs text-muted-foreground">
            Showing{" "}
            {Math.min(pagination.pageIndex * pagination.pageSize + 1, data.length)}-
            {Math.min((pagination.pageIndex + 1) * pagination.pageSize, data.length)} of {data.length}
          </div>
          <div className="flex items-center gap-2">
            <select
              aria-label="Rows per page"
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={pagination.pageSize}
              onChange={(event) => {
                const nextSize = Number(event.target.value);
                setPagination({ pageIndex: 0, pageSize: nextSize });
              }}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option} / page
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <div className="min-w-20 text-center text-xs text-muted-foreground">
              Page {table.getState().pagination.pageIndex + 1} of {Math.max(table.getPageCount(), 1)}
            </div>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
