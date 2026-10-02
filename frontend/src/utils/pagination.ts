import { useEffect, useMemo, useState } from "react";

export const DEFAULT_PAGE_SIZE_OPTIONS = [6, 12, 24] as const;

export function paginationTotalPages(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, totalItems) / Math.max(1, pageSize)));
}

export function clampPaginationPage(page: number, totalItems: number, pageSize: number): number {
  return Math.min(Math.max(1, Math.trunc(page) || 1), paginationTotalPages(totalItems, pageSize));
}

export function paginateItems<T>(items: readonly T[], page: number, pageSize: number): T[] {
  const safeSize = Math.max(1, Math.trunc(pageSize) || 1);
  const safePage = clampPaginationPage(page, items.length, safeSize);
  const start = (safePage - 1) * safeSize;
  return items.slice(start, start + safeSize);
}

export function paginationPageNumbers(page: number, totalPages: number, windowSize = 5): number[] {
  const count = Math.min(Math.max(1, windowSize), Math.max(1, totalPages));
  const current = Math.min(Math.max(1, page), Math.max(1, totalPages));
  let start = Math.max(1, current - Math.floor(count / 2));
  start = Math.min(start, Math.max(1, totalPages - count + 1));
  return Array.from({ length: count }, (_, index) => start + index);
}

export function usePagination<T>(
  items: readonly T[],
  resetKey: string,
  initialPageSize = 12,
) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const totalPages = paginationTotalPages(items.length, pageSize);

  useEffect(() => setPage(1), [resetKey]);
  useEffect(() => {
    setPage((current) => clampPaginationPage(current, items.length, pageSize));
  }, [items.length, pageSize]);

  const pageItems = useMemo(
    () => paginateItems(items, page, pageSize),
    [items, page, pageSize],
  );

  return {
    page: clampPaginationPage(page, items.length, pageSize),
    pageItems,
    pageSize,
    setPage,
    setPageSize: (size: number) => {
      setPageSize(Math.max(1, Math.trunc(size) || initialPageSize));
      setPage(1);
    },
    totalItems: items.length,
    totalPages,
  };
}
