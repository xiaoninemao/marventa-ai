"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import Image from "next/image";
import { useI18n } from "@/contexts/i18n_context";
import SlidingPanel from "@/components/auth/sliding_panel";
import LanguageSwitcher from "@/components/shared/language_switcher";
import { ENGLISH_ACTIONS, CHINESE_ACTIONS } from "@/i18n/interaction_copy";
import { handlePublicAnchorClick as navigateSection, restorePublicAnchor } from "@/utils/public_anchor_navigation";
import "@/styles/landing.css";

type AuthMode = "login" | "register";
const REPOSITORY_URL = "https://github.com/xiaoninemao/marventa-ai";
const OUTCOME_ILLUSTRATIONS = {
  reference: "/assets/illustrations/value-reference-cited.webp",
  versions: "/assets/illustrations/value-versions-history.webp",
  reuse: "/assets/illustrations/value-reuse-shared.webp",
};

function OutcomeIllustration({ type }: { type: keyof typeof OUTCOME_ILLUSTRATIONS }) {
  return (
    <span
      aria-hidden="true"
      className={`amp-public-outcome-art${type === "versions" ? " amp-public-outcome-art--versions" : ""}`}
    >
      <Image
        src={OUTCOME_ILLUSTRATIONS[type]}
        alt=""
        width={480}
        height={320}
        unoptimized
        loading="eager"
      />
    </span>
  );
}

export default function PublicHomepage() {
  const { t } = useI18n();
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const authTrigger = useRef<HTMLButtonElement | null>(null);
  const registrationTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelScroll = restorePublicAnchor();
    const restore = () => {
      cancelScroll?.();
      cancelScroll = restorePublicAnchor();
    };
    window.addEventListener("hashchange", restore);
    return () => {
      cancelScroll?.();
      window.removeEventListener("hashchange", restore);
    };
  }, []);

  const openAuth = (mode: AuthMode, event: MouseEvent<HTMLButtonElement>) => {
    authTrigger.current = event.currentTarget;
    setAuthMode(mode);
  };

  const closeAuth = () => {
    setAuthMode(null);
    window.requestAnimationFrame(() => {
      const trigger = authTrigger.current;
      if (trigger?.getClientRects().length) trigger.focus();
      else registrationTrigger.current?.focus();
    });
  };

  return (
    <div className="amp-redesign amp-public-page" id="top">
      <SlidingPanel mode={authMode ?? "login"} open={authMode !== null} onClose={closeAuth}
        onSwitch={() => setAuthMode((mode) => mode === "login" ? "register" : "login")} />

      <div inert={authMode !== null}>
        <a className="amp-public-skip-link" href="#public-content"
          onClick={(event) => navigateSection("#public-content", event)}>
          {t("跳到主要内容", "Skip to content")}
        </a>
        <header className="amp-public-header">
          <div className="amp-public-container amp-public-nav">
            <a href="#top" className="amp-public-brand" aria-label={t("Marventa AI 首页", "Marventa AI home")}
              onClick={(event) => navigateSection("#top", event)}>
              <Image src="/assets/brand/marventa-logo.png" alt="" width={48} height={33} priority />
              <span>Marventa AI</span>
            </a>
            <div className="amp-public-nav-actions">
              <LanguageSwitcher variant="minimal" />
              <button type="button" className="amp-public-login-link" onClick={(event) => openAuth("login", event)}>
                {t(CHINESE_ACTIONS.signIn, ENGLISH_ACTIONS.signIn)}
              </button>
              <button ref={registrationTrigger} type="button" className="amp-public-nav-cta" onClick={(event) => openAuth("register", event)}>
                {t(CHINESE_ACTIONS.signUp, ENGLISH_ACTIONS.signUp)}
              </button>
            </div>
          </div>
        </header>

        <main id="public-content" className="amp-public-sections" tabIndex={-1}>
          <section className="amp-public-container amp-public-hero" aria-labelledby="public-hero-title">
            <div className="amp-public-hero-copy">
              <h1 id="public-hero-title">Marventa AI</h1>
              <p className="amp-public-hero-statement">{t("面向营销团队的创作工作台", "A creative workspace for marketing teams")}</p>
              <div className="amp-public-hero-actions">
                <a href={REPOSITORY_URL} className="amp-public-button amp-public-github" target="_blank" rel="noopener noreferrer">
                  <Image className="amp-public-github-icon" src="/assets/brand/github-mark.png" alt="" width={24} height={24} />
                  <span>GitHub</span>
                  <svg className="amp-public-github-arrow" aria-hidden="true" focusable="false" viewBox="0 0 18 10" fill="none">
                    <path d="M1 5h15m-4-4 4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
                <a href="#capabilities" className="amp-public-text-link"
                  onClick={(event) => navigateSection("#capabilities", event)}>
                  {t(CHINESE_ACTIONS.explore, ENGLISH_ACTIONS.explore)}
                </a>
              </div>
            </div>
            <div className="amp-public-hero-visual" aria-hidden="true">
              <Image src="/assets/illustrations/marketing-paper-sculpture.webp" alt="" width={1400} height={1373} priority
                sizes="(max-width: 700px) 100vw, 60vw" />
            </div>
          </section>

          <section id="capabilities" className="amp-public-capabilities" aria-labelledby="public-capabilities-title">
            <div className="amp-public-container">
              <div className="amp-public-value-layout">
                <div className="amp-public-value-copy">
                  <h2 id="public-capabilities-title">{t("内容生产，", "Project work becomes")}<br />{t("沉淀为组织能力。", "shared capability.")}</h2>
                  <p>{t(
                    "市场研究、案例分析与内容版本统一归档于项目，团队方法与成果持续积累。",
                    "Research, case analysis, and content versions remain with the project. Team methods and results accumulate over time.",
                  )}</p>
                  <ul className="amp-public-value-outcomes">
                    <li><OutcomeIllustration type="reference" /><span>{t("研究可引用", "Research to draw on")}</span></li>
                    <li><OutcomeIllustration type="versions" /><span>{t("版本可回溯", "Versions to revisit")}</span></li>
                    <li><OutcomeIllustration type="reuse" /><span>{t("经验可复用", "Knowledge to reuse")}</span></li>
                  </ul>
                </div>
                <div className="amp-public-value-visual">
                  <Image src="/assets/illustrations/brand-knowledge-pages-final.png" alt="" width={1100} height={883}
                    sizes="(max-width: 800px) 100vw, 50vw" />
                </div>
              </div>
            </div>
          </section>

          <section id="workflow" className="amp-public-start" aria-labelledby="public-start-title">
            <div className="amp-public-container">
              <h2 id="public-start-title">
                <button type="button" className="amp-public-start-link"
                  aria-label={t("注册后开始你的第一个项目", "Sign up to start your first project")}
                  onClick={(event) => openAuth("register", event)}>
                  <span>{t(CHINESE_ACTIONS.signUp, ENGLISH_ACTIONS.signUp)}</span>
                  <svg className="amp-public-start-arrow" aria-hidden="true" focusable="false" viewBox="0 0 40 40" fill="none">
                    <path d="M8 32 32 8M9 8h23v23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </h2>
            </div>
          </section>
        </main>

        <footer className="amp-public-footer">
          <div className="amp-public-container amp-public-footer-content">
            <small>© {new Date().getFullYear()} Marventa AI</small>
            <p className="amp-public-footer-note">{t("以持续创作，积累品牌的长期价值。", "Build lasting brand value through creative work.")}</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
