"use client";

import { useI18n } from "@/contexts/i18n_context";
import EnterpriseSelect from "./EnterpriseSelect";
import { GuardedButton } from "./GuardedControls";
import InlineIcon from "./InlineIcon";
import { paginationPageNumbers } from "@/utils/pagination";

export default function Pagination({
  page,
  pageSize,
  pageSizeOptions,
  totalItems,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  totalItems: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const { t } = useI18n();
  if (totalItems === 0) return null;
  const firstPage = page <= 1;
  const lastPage = page >= totalPages;

  return (
    <nav className="amp-pagination" aria-label={t("分页", "Pagination")}>
      <p>{t("共 {count} 条", "{count} total", { count: totalItems })}</p>
      <div className="amp-pagination-pages">
        <GuardedButton type="button" className="amp-pagination-arrow"
          aria-label={t("上一页", "Previous page")}
          disabled={firstPage}
          blockedReason={t("已经是第一页。", "This is the first page.")}
          onClick={() => onPageChange(page - 1)}>
          <InlineIcon name="arrowLeft" />
        </GuardedButton>
        {paginationPageNumbers(page, totalPages, 3).map((number) => (
          <button key={number} type="button"
            className="amp-pagination-number"
            aria-current={number === page ? "page" : undefined}
            onClick={() => onPageChange(number)}>
            {number}
          </button>
        ))}
        <GuardedButton type="button" className="amp-pagination-arrow"
          aria-label={t("下一页", "Next page")}
          disabled={lastPage}
          blockedReason={t("已经是最后一页。", "This is the last page.")}
          onClick={() => onPageChange(page + 1)}>
          <InlineIcon name="chevronRight" />
        </GuardedButton>
      </div>
      <EnterpriseSelect
        value={String(pageSize)}
        options={pageSizeOptions.map((size) => ({
          value: String(size),
          label: t("每页 {count} 条", "{count} per page", { count: size }),
        }))}
        onChange={(value) => onPageSizeChange(Number(value))}
        ariaLabel={t("每页条数", "Items per page")}
        className="amp-pagination-size"
        variant="inline"
      />
    </nav>
  );
}
