"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

export function useDropdownMenu(itemCount: number, align: "start" | "end" = "end") {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const initialFocus = useRef(0);
  const menuId = useId();

  const menuItems = useCallback(() => Array.from(
    menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="option"]') ?? [],
  ).filter((item) => !item.matches(":disabled")
    && (!item.matches('[aria-disabled="true"]') || item.dataset.blockedAction === "true")), []);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = menuRef.current?.offsetWidth ?? 180;
      const height = menuRef.current?.offsetHeight ?? 104;
      setPosition({
        left: Math.max(8, Math.min(
          align === "start" ? rect.left : rect.right - width,
          window.innerWidth - width - 8,
        )),
        top: window.innerHeight - rect.bottom >= height + 8
          ? rect.bottom + 8
          : Math.max(8, rect.top - height - 8),
      });
    };
    updatePosition();
    const items = menuItems();
    items[Math.min(initialFocus.current, items.length - 1)]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, itemCount, menuItems, align]);

  const closeMenu = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const toggleMenu = (index = 0) => {
    initialFocus.current = index;
    setOpen((value) => !value);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      initialFocus.current = event.key === "ArrowDown" ? 0 : Math.max(itemCount - 1, 0);
      setOpen(true);
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    } else if (event.key === "Tab") {
      closeMenu();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = menuItems();
      if (!items.length) return;
      const index = items.findIndex((item) => item === document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (index + 1) % items.length : (index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length);
      items[next]?.focus();
    }
  };

  return { open, position, triggerRef, menuRef, menuId, toggleMenu, closeMenu, handleTriggerKeyDown, handleMenuKeyDown };
}
