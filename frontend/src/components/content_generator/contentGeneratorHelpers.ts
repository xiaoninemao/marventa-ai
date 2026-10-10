import type { TranslationValues } from "@/i18n/locale";

export type Feedback = string | { zh: string; en: string; values?: TranslationValues };

export const ACTIVE_SESSION_STORAGE_KEY = "amp-content-generator-active-session-v1";
