"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import InlineIcon from "@/components/redesign/InlineIcon";
import PortfolioProjectSidebar from "@/components/portfolio/PortfolioProjectSidebar";
import {
  fetch_content_projects,
  fetch_script,
  update_script,
} from "@/services/api_client";
import type { PortfolioScript } from "@/types/portfolio";
import type { ContentProject } from "@/types/publishing";
import {
  buildPortfolioReportHtml,
  hasBilingualPortfolioReport,
  parsePortfolioReport,
  type PortfolioReport,
} from "@/utils/portfolio_report";
import type { Locale } from "@/i18n/locale";

export default function PortfolioDetailPage() {
  const params = useParams<{ scriptId: string }>();
  const scriptId = params.scriptId;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useI18n();
  const { showError, showSuccess } = useToast();
  const pdfPreviewDialogRef = useRef<HTMLDialogElement>(null);
  const [script, setScript] = useState<PortfolioScript | null>(null);
  const [projects, setProjects] = useState<ContentProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [reportDraft, setReportDraft] = useState<PortfolioReport | null>(null);
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
        setTitleDraft(scriptResponse.data.title);
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
  const canManage = Boolean(user && script && (
    script.user_id === user.id
    || script.project_role === "owner"
    || script.project_role === "admin"
  ));
  const completed = script?.status === "completed";

  const saveWork = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!script || !reportDraft) return;
    const title = titleDraft.trim();
    const normalizedReport = {
      ...reportDraft,
      title: reportDraft.title.trim(),
      summary: reportDraft.summary.trim(),
      sections: reportDraft.sections.map((section) => ({
        title: section.title.trim(),
        paragraphs: section.paragraphs.map((paragraph) => paragraph.trim()),
      })),
    };
    if (!title || !normalizedReport.title || !normalizedReport.summary
      || normalizedReport.sections.some((section) => (
        !section.title || section.paragraphs.length === 0
        || section.paragraphs.some((paragraph) => !paragraph)
      ))) {
      showError(t(
        "作品名称、报告标题、摘要、章节标题和段落均不能为空",
        "Work name, report title, summary, section titles, and paragraphs are required",
      ));
      return;
    }
    let content = "";
    if (bilingual) {
      const data = JSON.parse(script.content) as {
        title_zh: string;
        title_en: string;
        summary_zh: string;
        summary_en: string;
        sections: Array<{
          section_type: string;
          title_zh: string;
          title_en: string;
          paragraphs_zh: string[];
          paragraphs_en: string[];
        }>;
      };
      if (reportLocale === "en") {
        data.title_en = normalizedReport.title;
        data.summary_en = normalizedReport.summary;
        data.sections = normalizedReport.sections.map((section, index) => {
          const existing = data.sections[index];
          return existing ? {
            ...existing,
            title_en: section.title,
            paragraphs_en: section.paragraphs,
          } : {
            section_type: `custom_${Date.now()}_${index}`,
            title_zh: section.title,
            title_en: section.title,
            paragraphs_zh: section.paragraphs,
            paragraphs_en: section.paragraphs,
          };
        });
      } else {
        data.title_zh = normalizedReport.title;
        data.summary_zh = normalizedReport.summary;
        data.sections = normalizedReport.sections.map((section, index) => {
          const existing = data.sections[index];
          return existing ? {
            ...existing,
            title_zh: section.title,
            paragraphs_zh: section.paragraphs,
          } : {
            section_type: `custom_${Date.now()}_${index}`,
            title_zh: section.title,
            title_en: section.title,
            paragraphs_zh: section.paragraphs,
            paragraphs_en: section.paragraphs,
          };
        });
      }
      content = JSON.stringify(data);
    } else {
      content = [
        normalizedReport.title,
        "",
        "执行摘要",
        normalizedReport.summary,
        ...normalizedReport.sections.flatMap((section) => [
          "",
          section.title,
          ...section.paragraphs,
        ]),
      ].join("\n");
    }
    setSaving(true);
    try {
      const response = await update_script(script.id, { title, content });
      setScript({
        ...response.data,
        project_title: script.project_title,
        project_role: script.project_role,
        creator_name: script.creator_name,
      });
      setEditing(false);
      setReportDraft(null);
      showSuccess(t("作品已保存", "Work saved"));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not save work", locale));
    } finally {
      setSaving(false);
    }
  };

  const exportPdf = async () => {
    if (!script || !report || exportingPdf) return;
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
    return <div className="amp-page-state" role="status">{t("正在加载作品...", "Loading work...")}</div>;
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
          {!editing && completed && (
            <div className="flex gap-2">
              {canManage && (
                <button type="button" className="amp-button amp-button-secondary"
                  onClick={() => {
                    setTitleDraft(script.title);
                    setReportDraft(structuredClone(report));
                    setEditing(true);
                  }}>
                  {t("编辑", "Edit")}
                </button>
              )}
              <button type="button" className="amp-button amp-button-secondary"
                onClick={() => pdfPreviewDialogRef.current?.showModal()}>
                {t("导出 PDF", "Export PDF")}
              </button>
            </div>
          )}
        </header>

        <div className="amp-project-detail-tabs" role="tablist">
          {bilingual ? (
            <>
              <button type="button" role="tab" aria-selected={reportLocale === "en"}
                disabled={editing}
                onClick={() => setReportLocale("en")}>English</button>
              <button type="button" role="tab" aria-selected={reportLocale === "zh-CN"}
                disabled={editing}
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
        ) : editing && reportDraft ? (
          <form className="amp-insight-edit-form" onSubmit={(event) => void saveWork(event)}>
            <div className="amp-portfolio-module-editor">
              <label className="amp-insight-edit-wide">
                <span>{t("作品名称", "Work name")}</span>
                <input className="amp-workspace-control" value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)} />
              </label>
              <label className="amp-insight-edit-wide">
                <span>{t("报告标题", "Report title")}</span>
                <input className="amp-workspace-control" value={reportDraft.title}
                  onChange={(event) => setReportDraft({
                    ...reportDraft, title: event.target.value,
                  })} />
              </label>
              <label className="amp-insight-edit-wide">
                <span>{t("执行摘要", "Executive summary")}</span>
                <textarea className="amp-workspace-control resize-y" rows={4}
                  value={reportDraft.summary}
                  onChange={(event) => setReportDraft({
                    ...reportDraft, summary: event.target.value,
                  })} />
              </label>
              <div className="amp-portfolio-edit-sections">
                {reportDraft.sections.map((section, sectionIndex) => (
                  <section key={sectionIndex} className="amp-portfolio-edit-section">
                    <div className="amp-portfolio-edit-section-heading">
                      <span>{String(sectionIndex + 1).padStart(2, "0")}</span>
                      <input className="amp-workspace-control" value={section.title}
                        aria-label={t("第 {count} 章标题", "Section {count} title", { count: sectionIndex + 1 })}
                        onChange={(event) => setReportDraft({
                          ...reportDraft,
                          sections: reportDraft.sections.map((item, index) => (
                            index === sectionIndex ? { ...item, title: event.target.value } : item
                          )),
                        })} />
                      {section.custom && (
                        <button type="button" onClick={() => setReportDraft({
                        ...reportDraft,
                        sections: reportDraft.sections.filter((_, index) => index !== sectionIndex),
                        })}>
                        {t("移除模块", "Remove module")}
                        </button>
                      )}
                    </div>
                    <div className="amp-portfolio-edit-paragraphs">
                      {section.paragraphs.map((paragraph, paragraphIndex) => (
                        <textarea key={paragraphIndex} className="amp-workspace-control resize-y"
                          rows={4} value={paragraph}
                          aria-label={t(
                            "第 {section} 章第 {paragraph} 段",
                            "Section {section}, paragraph {paragraph}",
                            { section: sectionIndex + 1, paragraph: paragraphIndex + 1 },
                          )}
                          onChange={(event) => setReportDraft({
                            ...reportDraft,
                            sections: reportDraft.sections.map((item, index) => (
                              index === sectionIndex ? {
                                ...item,
                                paragraphs: item.paragraphs.map((value, itemIndex) => (
                                  itemIndex === paragraphIndex ? event.target.value : value
                                )),
                              } : item
                            )),
                          })} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <button type="button" className="amp-button amp-button-secondary amp-portfolio-add-module"
                onClick={() => setReportDraft({
                  ...reportDraft,
                  sections: [
                    ...reportDraft.sections,
                    { title: "", paragraphs: [""], custom: true },
                  ],
                })}>
                {t("添加模块", "Add module")}
              </button>
            </div>
            <div className="amp-insight-edit-actions">
              <button type="button" className="amp-button amp-button-secondary" disabled={saving}
                onClick={() => { setEditing(false); setReportDraft(null); }}>{t("取消", "Cancel")}</button>
              <button type="submit" className="amp-button amp-button-primary" disabled={saving}>
                {saving ? t("保存中...", "Saving...") : t("保存作品", "Save work")}
              </button>
            </div>
          </form>
        ) : (
          <div className="amp-portfolio-report-grid">
            <section className="amp-portfolio-report-summary">
              <div>
                <span>{t("作品摘要", "Work summary")}</span>
                <h2>{report.title}</h2>
                <p>{report.summary}</p>
              </div>
            </section>
            {report.sections.map((section, index) => (
              <section key={`${section.title}-${index}`} className="amp-insight-detail-card amp-portfolio-report-section">
                <h2><span>{String(index + 1).padStart(2, "0")}</span>{section.title}</h2>
                <div>
                  {section.paragraphs.map((paragraph, paragraphIndex) => (
                    <p key={`${section.title}-${paragraphIndex}`}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <dialog ref={pdfPreviewDialogRef} aria-labelledby="portfolio-pdf-preview-title"
        className="amp-workspace-dialog amp-portfolio-pdf-preview-dialog m-auto w-[calc(100%_-_32px)] max-w-4xl overflow-hidden bg-white p-0 text-slate-950 backdrop:bg-slate-950/40"
        onCancel={(event) => {
          event.preventDefault();
          if (!exportingPdf) pdfPreviewDialogRef.current?.close();
        }}>
        <div className="flex max-h-[88dvh] min-h-0 flex-col">
          <header className="flex shrink-0 items-center border-b border-slate-200 px-5 py-4">
            <h2 id="portfolio-pdf-preview-title" className="text-base font-semibold">
              {t("导出 PDF 预览", "PDF export preview")}
            </h2>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-100 p-5">
            <div className="mx-auto overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
              dangerouslySetInnerHTML={{ __html: pdfPreviewHtml }} />
          </div>
          <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <button type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={exportingPdf}
              onClick={() => pdfPreviewDialogRef.current?.close()}>
              {t("取消", "Cancel")}
            </button>
            <button type="button" className="amp-button amp-button-primary" disabled={exportingPdf}
              onClick={() => void exportPdf()}>
              {exportingPdf ? t("导出中...", "Exporting...") : t("继续", "Continue")}
            </button>
          </footer>
        </div>
      </dialog>
    </div>
  );
}
