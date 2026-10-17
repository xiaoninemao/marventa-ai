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
              <Image src="/assets/brand/marventa-mark.png" alt="" width={35} height={20} sizes="36px" priority />
              <span>Marventa AI</span>
            </a>
            <div className="amp-public-nav-actions">
              <LanguageSwitcher variant="minimal" />
              <button type="button" className="amp-public-login-link amp-text-action" onClick={(event) => openAuth("login", event)}>
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
              <h1 id="public-hero-title">
                {t("让 Agent 带着", "Agents that work with ")}
                <span className="amp-public-hero-phrase">{t("团队的知识工作。", "your team's knowledge.")}</span>
              </h1>
              <p className="amp-public-hero-statement">{t("面向营销团队的 Agent 协作工作区", "An agent workspace for marketing teams.")}</p>
              <p className="amp-public-hero-description">{t(
                "把产品资料、品牌规范、洞察与素材组织在项目里，和 Agent 一起规划、创作与交付。让团队的每一次工作，都留下可以继续使用的积累。",
                "Bring product knowledge, brand guidance, research, and assets into each project. Plan, create, and deliver with agents, keeping the work ready for the next brief.",
              )}</p>
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

          <section id="capabilities" className="amp-public-collaboration" aria-labelledby="public-capabilities-title">
            <div className="amp-public-container">
              <div className="amp-public-collaboration-intro">
                <h2 id="public-capabilities-title">{t("从共同理解，到共同交付。", "Shared context. Work you build together.")}</h2>
                <p>{t(
                  "产品知识、品牌准则与创作经验，构成团队共享的工作语境。Agent 在此基础上推进创作，团队在持续迭代中把握方向与品质。",
                  "Product knowledge, brand guidance, and creative references give your team a shared foundation. Agents move the work forward; your team shapes its direction and quality.",
                )}</p>
              </div>
              <ol className="amp-public-collaboration-steps">
                <li>
                  <h3>{t("共享项目背景", "Start with shared context")}</h3>
                  <p>{t(
                    "产品定位、品牌规范、洞察与参考资料放在一起。团队成员和 Agent 可以引用同一批资料，减少重复介绍背景。",
                    "Keep positioning, brand guidance, research, and references together. Teammates and agents can draw on the same sources without rebuilding the brief.",
                  )}</p>
                </li>
                <li>
                  <h3>{t("和 Agent 一起推进", "Move the work forward with agents")}</h3>
                  <p>{t(
                    "通过对话探索方向、制定计划，再调用资料与工具组合作品。讨论和产出一起保留，方便继续修改与完善。",
                    "Explore a direction, develop a plan, then use references and tools to assemble the work. Keep the conversation alongside the output for the next revision.",
                  )}</p>
                </li>
                <li>
                  <h3>{t("由团队审阅与交付", "Keep the team in control")}</h3>
                  <p>{t(
                    "按项目角色协作，审阅媒体和文案，回看历史版本。把认可的成果保存到作品集，再安排发布。",
                    "Collaborate through project roles, review the media and copy, and revisit earlier versions. Save the work to Portfolio before arranging publication.",
                  )}</p>
                </li>
              </ol>
            </div>
          </section>

          <section className="amp-public-capabilities" aria-labelledby="public-knowledge-title">
            <div className="amp-public-container">
              <div className="amp-public-value-layout">
                <div className="amp-public-value-copy">
                  <h2 id="public-knowledge-title">{t("作品交付，经验留下。", "Deliver the work. Keep the knowledge.")}</h2>
                  <p>{t(
                    "洞察、案例、素材、创作版本和作品持续保留在项目中。下一次任务可以引用已有资料，团队也能回看版本、整理方法，继续完善作品。",
                    "Research, cases, assets, creative versions, and finished works stay with the project. Draw on existing references, revisit earlier decisions, and prepare useful material for the next task.",
                  )}</p>
                  <ul className="amp-public-value-outcomes">
                    <li><OutcomeIllustration type="reference" /><span className="amp-public-outcome-copy">
                      <strong>{t("研究可引用", "Research to draw on")}</strong>
                      <span>{t("洞察与案例关联到创作，重要背景随任务保留。", "Reference insights and cases in the conversation, keeping the background with the task.")}</span>
                    </span></li>
                    <li><OutcomeIllustration type="versions" /><span className="amp-public-outcome-copy">
                      <strong>{t("版本可回溯", "Versions to revisit")}</strong>
                      <span>{t("回看方案和作品版本，必要时恢复，再继续完善。", "Revisit plans and work versions. Restore an earlier version and keep refining.")}</span>
                    </span></li>
                    <li><OutcomeIllustration type="reuse" /><span className="amp-public-outcome-copy">
                      <strong>{t("经验可复用", "Knowledge to reuse")}</strong>
                      <span>{t("把有效的表达和参考整理成素材，供后续任务引用。", "Turn useful copy and references into assets your team can draw on again.")}</span>
                    </span></li>
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
                  aria-label={t("注册并开启团队的新项目", "Sign up and start a project with your team")}
                  onClick={(event) => openAuth("register", event)}>
                  <span>{t("开启团队的下一个项目", "Start your team's next project")}</span>
                  <svg className="amp-public-start-arrow" aria-hidden="true" focusable="false" viewBox="0 0 40 40" fill="none">
                    <path d="M8 32 32 8M9 8h23v23" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </h2>
              <p className="amp-public-start-copy">{t(
                "从一份产品资料开始，把下一次创作接在团队已有的积累上。",
                "Start with a product brief. Build the next piece of work on what your team already knows.",
              )}</p>
            </div>
          </section>
        </main>

        <footer className="amp-public-footer">
          <div className="amp-public-container amp-public-footer-content">
            <small>© {new Date().getFullYear()} Marventa AI</small>
            <p className="amp-public-footer-note">{t("把知识留在项目，把经验留给团队。", "Keep knowledge with the project. Keep experience with the team.")}</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
