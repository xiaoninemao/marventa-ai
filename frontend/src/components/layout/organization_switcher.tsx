"use client";

import { GuardedButton } from "@/components/redesign/GuardedControls";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { useDropdownMenu } from "@/hooks/use_dropdown_menu";
import { localizeErrorMessage } from "@/i18n/errors";
import { organizationName } from "@/utils/organizations";
import InlineIcon from "@/components/redesign/InlineIcon";
import OrganizationAvatar from "@/components/layout/organization_avatar";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_PROGRESS, CHINESE_ACTIONS } from "@/i18n/interaction_copy";

export default function OrganizationSwitcher() {
  const { user, organizations, organizationsLoading, organizationsError, organizationBusy, reloadOrganizations, switchOrganization } = useAuth();
  const { t, locale } = useI18n();
  const { showError, showWarning } = useToast();
  const current = user?.current_organization ?? user?.default_organization;
  const name = current ? organizationName(current, t) : t("组织", "Organization");
  const count = organizationsLoading ? 0 : organizationsError ? 1 : organizations.length;
  const { open, position, triggerRef, menuRef, menuId, toggleMenu, closeMenu, handleTriggerKeyDown, handleMenuKeyDown } = useDropdownMenu(count, "start");

  useEffect(() => {
    if (organizationsError) showError(localizeErrorMessage(organizationsError, locale));
  }, [organizationsError, locale, showError]);

  const selectOrganization = async (id: string) => {
    if (organizationBusy) { showWarning(t("正在处理中，请稍候。", "Please wait for the current operation to finish.")); return; }
    try {
      await switchOrganization(id);
      closeMenu();
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not switch organization", locale));
      if (triggerRef.current) {
        if (!menuRef.current) toggleMenu();
        menuRef.current?.focus();
      }
    }
  };

  return (
    <div className="amp-organization-switcher">
      <button type="button" ref={triggerRef} className="amp-app-brand amp-organization-trigger"
        title={name} aria-label={t("切换组织，当前为 {name}", "Switch organization, current: {name}", { name })}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => toggleMenu(Math.max(0, organizations.findIndex((item) => item.id === current?.id)))}
        onKeyDown={handleTriggerKeyDown}>
        {current && <OrganizationAvatar organization={current} className="amp-organization-avatar h-9 w-9 text-sm" />}
        <span className="amp-app-brand-text">{name}</span>
        <svg className="amp-organization-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true">
          <path d="m5 8 5 5 5-5" />
        </svg>
      </button>
      {open && createPortal(
        <div ref={menuRef} id={menuId} className="amp-redesign amp-language-menu amp-organization-menu"
          role="menu" tabIndex={-1} aria-label={t("切换组织", "Switch organization")} style={position} onKeyDown={handleMenuKeyDown}>
          {organizationsLoading ? <p className="amp-organization-menu-message" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</p>
            : organizationsError ? (
              <div className="amp-organization-menu-message">
                <button type="button" role="menuitem" tabIndex={-1} className="amp-language-option" onClick={reloadOrganizations}>{t(CHINESE_ACTIONS.retry, ENGLISH_ACTIONS.retry)}</button>
              </div>
            ) : organizations.map((item) => (
              <GuardedButton key={item.id} type="button" role="menuitemradio" tabIndex={-1}
                aria-checked={current?.id === item.id} disabled={organizationBusy} blockedReason={t("正在处理中，请稍候。", "Please wait for the current operation to finish.")}
                className="amp-language-option amp-organization-option" title={organizationName(item, t)}
                onClick={() => { if (current?.id === item.id) closeMenu(); else void selectOrganization(item.id); }}>
                <OrganizationAvatar organization={item} className="h-10 w-10 text-sm" />
                <span className="amp-organization-option-copy"><strong>{organizationName(item, t)}</strong></span>
                {current?.id === item.id && <InlineIcon name="check" />}
              </GuardedButton>
              ))}
            {organizationBusy && <p className="amp-organization-menu-message" role="status">{t(CHINESE_PROGRESS.processing, ENGLISH_PROGRESS.processing)}</p>}
        </div>, document.body,
      )}
    </div>
  );
}
