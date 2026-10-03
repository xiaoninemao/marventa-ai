"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { ENGLISH_ACTIONS, ENGLISH_PROGRESS, CHINESE_PROGRESS, CHINESE_ACTIONS } from "@/i18n/interaction_copy";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import InlineIcon from "@/components/redesign/InlineIcon";
import { GuardedButton } from "@/components/redesign/GuardedControls";
import PortfolioProjectSidebar from "@/components/portfolio/PortfolioProjectSidebar";
import PortfolioReportDocument from "@/components/portfolio/PortfolioReportDocument";
import {
  fetch_content_projects,
  fetch_script,
} from "@/services/api_client";
import type { PortfolioScript } from "@/types/portfolio";
import type { ContentProject } from "@/types/publishing";
import {
  buildPortfolioReportHtml,
  hasBilingualPortfolioReport,
  parsePortfolioReport,
} from "@/utils/portfolio_report";
import type { Locale } from "@/i18n/locale";

export default function PortfolioDetailPage() {
  const params = useParams<{ scriptId: string }>();
  const scriptId = params.scriptId;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useI18n();
  const { showError } = useToast();
  const pdfPreviewDialogRef = useRef<HTMLDialogElement>(null);
  const [script, setScript] = useState<PortfolioScript | null>(null);
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [reportLocale, setReportLocale] = useState<Locale>(locale);

  const loadScript = useCallback(async () => {
    const response = await fetch_script(scriptId);
    setScript(response.data);
    return response.data;
  }, [scriptId]);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, router, user]);

  useEffect(() => {
    setReportLocale(locale);
  }, [locale, scriptId]);

  useEffect(() => {
    if (!user || !scriptId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([fetch_script(scriptId), fetch_content_projects()])
      .then(([scriptResponse, projectsResponse]) => {
        if (cancelled) return;
        setScript(scriptResponse.data);
        setProjects(projectsResponse.data || []);
      })
      .catch((error) => {
        if (!cancelled) {
          showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not load work", locale));
          router.replace("/portfolio");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locale, router, scriptId, showError, user]);

  useEffect(() => {
    if (script?.status !== "generating") return;
    const timer = window.setInterval(() => {
      void loadScript().catch((error) => {
        showError(localizeErrorMessage(
          error instanceof Error ? error.message : "Could not refresh work",
          locale,
        ));
      });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [loadScript, locale, script?.status, showError]);

  const report = useMemo(() => (
    script ? parsePortfolioReport(script.title, script.content, script.updated_at, t, reportLocale) : null
  ), [reportLocale, script, t]);
  const bilingual = Boolean(script && hasBilingualPortfolioReport(script.content));
  const pdfPreviewHtml = useMemo(
    () => report ? buildPortfolioReportHtml(report, t, reportLocale) : "",
    [report, reportLocale, t],
  );
  const completed = script?.status === "completed";
  const exportReason = t("PDF 正在导出，请稍候。", "The PDF is being exported. Please wait.");

  const exportPdf = async () => {
    if (exportingPdf) { showError(exportReason); return; }
    if (!script || !report) return;
    setExportingPdf(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const container = document.createElement("div");
      container.innerHTML = pdfPreviewHtml;
      document.body.appendChild(container);
      await html2pdf().set({
        margin: [12, 12, 12, 12],
        filename: `${script.title}.pdf`,
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      }).from(container.firstElementChild as HTMLElement).save();
      container.remove();
      pdfPreviewDialogRef.current?.close();
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not export work", locale));
    } finally {
      setExportingPdf(false);
    }
  };

  if (authLoading || loading || !script || !report || !user) {
    return <div className="amp-page-state" role="status">{t(CHINESE_PROGRESS.loading, ENGLISH_PROGRESS.loading)}</div>;
  }

  return (
    <div className="amp-project-detail-layout">
      <PortfolioProjectSidebar projects={projects} selectedProjectId={script.project_id} />
      <main className="amp-project-detail-main">
        <header className="amp-project-detail-header">
          <div className="amp-project-detail-title">
            <Link href={`/portfolio?project=${encodeURIComponent(script.project_id)}`}
              className="amp-project-detail-back" aria-label={t("返回作品列表", "Back to portfolio")}>
              <InlineIcon name="arrowLeft" />
            </Link>
            <div>
              <div className="amp-insight-title-row">
                <h1>{script.title}</h1>
                <span className={`amp-insight-status amp-insight-status-${
                  script.status === "generating" ? "analyzing" : script.status
                }`}>
                  {script.status === "generating"
                    ? t("生成中", "Generating")
                    : script.status === "failed"
                      ? t("失败", "Failed")
                      : t("已完成", "Completed")}
                </span>
              </div>
              <p><Link href={`/projects/${encodeURIComponent(script.project_id)}`}>{script.project_title}</Link></p>
            </div>
          </div>
          {completed && (
            <div className="flex gap-2">
              <GuardedButton type="button" className="amp-button amp-button-secondary"
                disabled={exportingPdf} blockedReason={exportReason}
                onClick={() => pdfPreviewDialogRef.current?.showModal()}>
                <InlineIcon name="download" className="h-4 w-4" />
                {t(CHINESE_ACTIONS.export, ENGLISH_ACTIONS.export)}
              </GuardedButton>
            </div>
          )}
        </header>

        <div className="amp-project-detail-tabs" role="tablist">
          {bilingual ? (
            <>
              <button type="button" role="tab" aria-selected={reportLocale === "en"}
                onClick={() => setReportLocale("en")}>English</button>
              <button type="button" role="tab" aria-selected={reportLocale === "zh-CN"}
                onClick={() => setReportLocale("zh-CN")}>中文版</button>
            </>
          ) : (
            <button type="button" role="tab" aria-selected="true">{t("作品内容", "Work content")}</button>
          )}
        </div>

        {script.status === "generating" ? (
          <div className="amp-insight-processing" role="status">
            <span className="amp-insight-processing-icon"><InlineIcon name="wand" /></span>
            <strong>{t("正在生成作品内容", "Generating work content")}</strong>
            <p>{t("生成完成后，作品内容会自动更新。", "The work will update automatically when generation completes.")}</p>
          </div>
        ) : script.status === "failed" ? (
          <div className="amp-projects-state">
            <strong>{t("作品生成失败", "Work generation failed")}</strong>
            <p>{t("请返回智能创作重新生成作品。", "Return to Content Studio and generate the work again.")}</p>
          </div>
        ) : (
          <PortfolioReportDocument report={report} locale={reportLocale} />
        )}
      </main>

      <dialog ref={pdfPreviewDialogRef} aria-labelledby="portfolio-pdf-preview-title"
        className="amp-workspace-dialog amp-portfolio-pdf-preview-dialog m-auto w-[calc(100%_-_32px)] max-w-4xl overflow-hidden bg-white p-0 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => {
          event.preventDefault();
          if (!exportingPdf) pdfPreviewDialogRef.current?.close();
          else showError(exportReason);
        }}>
        <div className="flex max-h-[88dvh] min-h-0 flex-col">
          <header className="flex shrink-0 items-center justify-between border-b border-slate-200 px-5 py-4">
            <h2 id="portfolio-pdf-preview-title" className="text-base font-semibold">
              {t("导出 PDF 预览", "PDF export preview")}
            </h2>
            <GuardedButton blockedReason={exportReason} type="button" className="amp-material-preview-icon" disabled={exportingPdf}
              aria-label={t("关闭预览", "Close preview")} onClick={() => pdfPreviewDialogRef.current?.close()}>
              <InlineIcon name="close" />
            </GuardedButton>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 p-5">
            <div className="mx-auto overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
              dangerouslySetInnerHTML={{ __html: pdfPreviewHtml }} />
          </div>
          <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <GuardedButton blockedReason={exportReason} type="button" className="amp-button amp-button-primary" disabled={exportingPdf}
              onClick={() => void exportPdf()}>
              {exportingPdf ? t(CHINESE_PROGRESS.exporting, ENGLISH_PROGRESS.exporting) : t(CHINESE_ACTIONS.export, ENGLISH_ACTIONS.export)}
            </GuardedButton>
          </footer>
        </div>
      </dialog>
    </div>
  );
}
