import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPaginationPage, paginateItems, paginationPageNumbers, paginationTotalPages,
} from "./pagination.ts";

test("pagination uses stable one-based pages and never returns an invalid total", () => {
  assert.equal(paginationTotalPages(0, 12), 1);
  assert.equal(paginationTotalPages(1, 12), 1);
  assert.equal(paginationTotalPages(13, 12), 2);
  assert.equal(clampPaginationPage(0, 30, 12), 1);
  assert.equal(clampPaginationPage(99, 30, 12), 3);
});

test("pagination preserves item order and clamps after deletions", () => {
  const items = Array.from({ length: 14 }, (_, index) => index + 1);
  assert.deepEqual(paginateItems(items, 1, 6), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(paginateItems(items, 3, 6), [13, 14]);
  assert.deepEqual(paginateItems(items.slice(0, 5), 3, 6), [1, 2, 3, 4, 5]);
});

test("page-number windows stay bounded around the current page", () => {
  assert.deepEqual(paginationPageNumbers(1, 2), [1, 2]);
  assert.deepEqual(paginationPageNumbers(1, 10), [1, 2, 3, 4, 5]);
  assert.deepEqual(paginationPageNumbers(6, 10), [4, 5, 6, 7, 8]);
  assert.deepEqual(paginationPageNumbers(10, 10), [6, 7, 8, 9, 10]);
});
