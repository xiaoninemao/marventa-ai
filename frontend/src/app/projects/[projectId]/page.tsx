"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import QRCode from "qrcode";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth_context";
import { useI18n } from "@/contexts/i18n_context";
import { useToast } from "@/contexts/toast_context";
import { localizeErrorMessage } from "@/i18n/errors";
import { selectUploadFiles } from "@/utils/upload_selection";
import { materialCopyTitle } from "@/utils/material_copy_title";
import {
  fetch_content_project,
  fetch_content_projects,
  fetch_history,
  fetch_my_cases,
  fetch_project_channel_accounts,
  fetch_project_materials,
  fetch_project_members,
  fetch_scripts,
  fetch_sessions,
  delete_project_channel_account,
  delete_project_material,
  create_project_material_set,
  create_project_material_copy,
  invite_project_member,
  poll_xiaohongshu_channel_authorization,
  remove_project_member,
  start_project_channel_authorization,
  upload_project_material,
  update_project_material,
  update_project_material_set,
  update_project_member_role,
} from "@/services/api_client";
import type { ContentProject, ProjectChannelAccount, ProjectMaterial, ProjectMember } from "@/types/publishing";
import type { HistoryRecord } from "@/types/market_insight";
import type { CaseItem } from "@/types/case_library";
import type { SessionRecord } from "@/types/content_generator";
import InlineIcon, { type InlineIconName } from "@/components/redesign/InlineIcon";
import EnterpriseSelect from "@/components/redesign/EnterpriseSelect";
import RedesignInput from "@/components/redesign/RedesignInput";
import DeleteConfirmDialog from "@/components/redesign/DeleteConfirmDialog";
import ProjectQuickSidebar from "@/components/projects/ProjectQuickSidebar";
import MaterialRichTextEditor from "@/components/projects/MaterialRichTextEditor";
import MaterialDocumentPreview from "@/components/projects/MaterialDocumentPreview";
import MaterialDocumentThumbnail from "@/components/projects/MaterialDocumentThumbnail";
import { userAvatarColor as memberAvatarColor, userAvatarInitial } from "@/utils/user_avatar";

type AssetType = "all" | "insight" | "case" | "content" | "portfolio";
type ChannelPlatformFilter = "all" | "xiaohongshu" | "douyin";
type ChannelSortOrder = "desc" | "asc";
type DeviceAuthorization = {
  state: string;
  authorizationUrl: string;
  expiresIn: number;
  interval: number;
  userCode: string;
};

type ProjectAsset = {
  id: string;
  type: Exclude<AssetType, "all">;
  title: string;
  detail: string;
  icon: InlineIconName;
  timestamp: string;
  href?: string;
};

const MARKETING_CHANNELS = [
  {
    key: "xiaohongshu",
    zh: "小红书",
    en: "Xiaohongshu",
    detailZh: "图文与短视频内容",
    detailEn: "Image posts and short video",
    logo: "/images/channels/xiaohongshu.jpg",
  },
  {
    key: "douyin",
    zh: "抖音",
    en: "Douyin",
    detailZh: "短视频内容",
    detailEn: "Short-video content",
    logo: "/images/channels/douyin.jpg",
  },
] as const;

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8765";

function mediaUrl(url: string) {
  if (!url) return "";
  return url.startsWith("http") ? url : `${API_BASE}${url}`;
}

function assetDate(value: string) {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  return new Date(normalized);
}

function formatDate(value: string, locale: string) {
  const date = assetDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale === "en" ? "en-US" : "zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function ProjectDetailPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = useI18n();
  const { showError, showSuccess } = useToast();
  const [project, setProject] = useState<ContentProject | null>(null);
  const [quickProjects, setQuickProjects] = useState<ContentProject[]>([]);
  const [projectInsights, setProjectInsights] = useState<HistoryRecord[]>([]);
  const [projectCases, setProjectCases] = useState<CaseItem[]>([]);
  const [projectSessions, setProjectSessions] = useState<SessionRecord[]>([]);
  const [projectScripts, setProjectScripts] = useState<Array<{
    id: string; title: string; content: string; updated_at: string;
  }>>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [channelAccounts, setChannelAccounts] = useState<ProjectChannelAccount[]>([]);
  const [projectMaterials, setProjectMaterials] = useState<ProjectMaterial[]>([]);
  const [channelPlatformFilter, setChannelPlatformFilter] = useState<ChannelPlatformFilter>("all");
  const [channelSearch, setChannelSearch] = useState("");
  const [channelSortOrder, setChannelSortOrder] = useState<ChannelSortOrder>("desc");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"materials" | "assets" | "channels" | "members">("assets");
  const [assetType, setAssetType] = useState<AssetType>("all");
  const [assetSort, setAssetSort] = useState<"newest" | "oldest">("newest");
  const [materialSetSearch, setMaterialSetSearch] = useState("");
  const [materialSetSort, setMaterialSetSort] = useState<"newest" | "oldest">("newest");
  const [assetSearch, setAssetSearch] = useState("");
  const [selectedMaterialSet, setSelectedMaterialSet] = useState<ProjectMaterial | null>(null);
  const [materialSetName, setMaterialSetName] = useState("");
  const [materialSetToRename, setMaterialSetToRename] = useState<ProjectMaterial | null>(null);
  const [materialSetRenameName, setMaterialSetRenameName] = useState("");
  const [materialToRename, setMaterialToRename] = useState<ProjectMaterial | null>(null);
  const [materialRenameName, setMaterialRenameName] = useState("");
  const [materialToPreview, setMaterialToPreview] = useState<ProjectMaterial | null>(null);
  const [materialCopySaving, setMaterialCopySaving] = useState(false);
  const [materialMenuOpensUp, setMaterialMenuOpensUp] = useState(false);
  const [materialUploadMode, setMaterialUploadMode] = useState<"image" | "video" | "copy">("image");
  const [copyMode, setCopyMode] = useState<"document" | "rich">("document");
  const [materialDocuments, setMaterialDocuments] = useState<File[]>([]);
  const [copyHtml, setCopyHtml] = useState("");
  const [copyText, setCopyText] = useState("");
  const [editorVersion, setEditorVersion] = useState(0);
  const [materialImages, setMaterialImages] = useState<File[]>([]);
  const [materialVideo, setMaterialVideo] = useState<File | null>(null);
  const [materialFilesExpanded, setMaterialFilesExpanded] = useState(false);
  const materialSelectedFilesRef = useRef<HTMLDivElement>(null);
  const selectedMaterialFiles = materialUploadMode === "image"
    ? materialImages : materialUploadMode === "video"
      ? materialVideo ? [materialVideo] : []
      : copyMode === "document" ? materialDocuments : [];

  useEffect(() => {
    if (!materialFilesExpanded) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !materialSelectedFilesRef.current?.contains(event.target)) {
        setMaterialFilesExpanded(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [materialFilesExpanded]);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [inviting, setInviting] = useState(false);
  const [materialSaving, setMaterialSaving] = useState(false);
  const [materialToDelete, setMaterialToDelete] = useState<ProjectMaterial | null>(null);
  const [accountSaving, setAccountSaving] = useState(false);
  const [choosingPlatform, setChoosingPlatform] = useState(true);
  const [bindingPlatform, setBindingPlatform] = useState<"xiaohongshu" | "douyin">("xiaohongshu");
  const [deviceAuthorization, setDeviceAuthorization] = useState<DeviceAuthorization | null>(null);
  const [deviceAuthorizationStatus, setDeviceAuthorizationStatus] = useState<"pending" | "scanned">("pending");
  const [deviceQrCode, setDeviceQrCode] = useState("");
  const [memberToRemove, setMemberToRemove] = useState<ProjectMember | null>(null);
  const [memberMenuUserId, setMemberMenuUserId] = useState<string | null>(null);
  const [channelMenuAccountId, setChannelMenuAccountId] = useState<string | null>(null);
  const [materialMenuId, setMaterialMenuId] = useState<string | null>(null);
  const createMenuRef = useRef<HTMLDivElement>(null);
  const memberMenuRef = useRef<HTMLDivElement>(null);
  const channelMenuRef = useRef<HTMLDivElement>(null);
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  const accountDialogRef = useRef<HTMLDialogElement>(null);
  const inviteDialogRef = useRef<HTMLDialogElement>(null);
  const materialDialogRef = useRef<HTMLDialogElement>(null);
  const materialSetDialogRef = useRef<HTMLDialogElement>(null);
  const materialSetRenameDialogRef = useRef<HTMLDialogElement>(null);
  const materialRenameDialogRef = useRef<HTMLDialogElement>(null);
  const materialPreviewDialogRef = useRef<HTMLDialogElement>(null);
  const materialManagementDialogRef = useRef<HTMLDialogElement>(null);
  const materialManagementBodyRef = useRef<HTMLDivElement>(null);
  const materialMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/");
  }, [authLoading, router, user]);

  useEffect(() => {
    setChannelPlatformFilter("all");
    setChannelSortOrder("desc");
    setChannelSearch("");
    setAssetSearch("");
    setMaterialSetSearch("");
    setMaterialSetSort("newest");
  }, [projectId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("channel_authorization");
    if (!status) return;
    setTab("channels");
    if (status === "success") {
      showSuccess(t("抖音账号授权成功", "Douyin account authorized"));
    } else if (status === "cancelled") {
      showError(t("已取消抖音账号授权", "Douyin authorization was cancelled"));
    } else {
      showError(t("抖音账号授权失败，请重试", "Douyin authorization failed. Try again."));
    }
    window.history.replaceState({}, "", window.location.pathname);
  }, [showError, showSuccess, t]);

  useEffect(() => {
    if (!user || !projectId) return;
    let cancelled = false;
    setLoading(true);
    setSelectedMaterialSet(null);
    Promise.all([
      fetch_content_project(projectId),
      fetch_project_materials(projectId),
      fetch_project_channel_accounts(projectId),
      fetch_project_members(projectId),
      fetch_content_projects(),
      fetch_history("", projectId),
      fetch_my_cases(100, 0, "", projectId),
      fetch_sessions(projectId),
      fetch_scripts(projectId),
    ])
      .then(([
        projectResponse, materialsResponse, accountsResponse, membersResponse, projectsResponse, insightsResponse,
        casesResponse, sessionsResponse, scriptsResponse,
      ]) => {
        if (cancelled) return;
        setProject(projectResponse.data);
        setProjectMaterials(materialsResponse.data || []);
        setChannelAccounts(accountsResponse.data || []);
        setMembers(membersResponse.data || []);
        setQuickProjects(projectsResponse.data || []);
        setProjectInsights(insightsResponse.data || []);
        const caseData = casesResponse.data;
        setProjectCases(Array.isArray(caseData) ? caseData : caseData.cases || []);
        setProjectSessions(sessionsResponse.data || []);
        setProjectScripts(scriptsResponse.data || []);
      })
      .catch((error) => {
        if (!cancelled) {
          showError(localizeErrorMessage(error instanceof Error ? error.message : "Fetch project failed", locale));
          router.replace("/projects");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [locale, projectId, router, showError, user]);

  useEffect(() => {
    if (!createMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !createMenuRef.current?.contains(event.target)) {
        setCreateMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [createMenuOpen]);

  useEffect(() => {
    if (!memberMenuUserId) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !memberMenuRef.current?.contains(event.target)) {
        setMemberMenuUserId(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [memberMenuUserId]);

  useEffect(() => {
    if (!channelMenuAccountId) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !channelMenuRef.current?.contains(event.target)) {
        setChannelMenuAccountId(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [channelMenuAccountId]);

  useEffect(() => {
    if (!materialMenuId) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !materialMenuRef.current?.contains(event.target)) {
        setMaterialMenuId(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [materialMenuId]);

  useEffect(() => {
    if (!deviceAuthorization || !project) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let interval = deviceAuthorization.interval;
    const poll = async () => {
      try {
        const response = await poll_xiaohongshu_channel_authorization(
          project.id,
          deviceAuthorization.state,
        );
        if (cancelled) return;
        if (response.data.status === "authorized" && response.data.account) {
          setChannelAccounts((current) => [
            ...current.filter((item) => item.id !== response.data.account?.id),
            response.data.account!,
          ]);
          setDeviceAuthorization(null);
          setDeviceQrCode("");
          accountDialogRef.current?.close();
          showSuccess(t("小红书账号授权成功", "Xiaohongshu account authorized"));
          return;
        }
        setDeviceAuthorizationStatus(
          response.data.status === "scanned" ? "scanned" : "pending",
        );
        interval = response.data.interval || interval;
        timeoutId = setTimeout(poll, interval * 1000);
      } catch (error) {
        if (cancelled) return;
        setDeviceAuthorization(null);
        setDeviceQrCode("");
        showError(localizeErrorMessage(
          error instanceof Error ? error.message : "Could not check channel authorization",
          locale,
        ));
      }
    };
    timeoutId = setTimeout(poll, interval * 1000);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [deviceAuthorization, locale, project, showError, showSuccess, t]);

  const assets = useMemo<ProjectAsset[]>(() => {
    if (!project) return [];
    const items: ProjectAsset[] = projectInsights.map((insight) => ({
      id: `insight-${insight.id}`,
      type: "insight",
      title: insight.title || insight.filename,
      detail: insight.ai_analysis?.product_summary || insight.ai_analysis?.product_description || t("市场洞察", "Market insight"),
      icon: "insight",
      timestamp: insight.upload_time,
      href: `/market_insight/${encodeURIComponent(insight.id)}`,
    }));
    items.push(...projectCases.map<ProjectAsset>((item) => ({
      id: `case-${item.id}`,
      type: "case",
      title: item.title,
      detail: item.description || t("案例", "Case"),
      icon: "case",
      timestamp: item.updated_at || item.created_at,
      href: `/case_library?project=${encodeURIComponent(project.id)}&case=${encodeURIComponent(item.id)}`,
    })));
    items.push(...projectSessions.map<ProjectAsset>((session) => ({
      id: `content-${session.id}`,
      type: "content",
      title: session.title || t("未命名创作", "Untitled creation"),
      detail: session.cards[0]?.preview || t("智能创作", "Content Studio"),
      icon: "edit",
      timestamp: session.updated_at || session.created_at,
      href: `/content_generator/${encodeURIComponent(session.id)}`,
    })));
    items.push(...projectScripts.map<ProjectAsset>((script) => ({
      id: `portfolio-${script.id}`,
      type: "portfolio",
      title: script.title,
      detail: script.content.slice(0, 120) || t("作品", "Portfolio"),
      icon: "briefcase",
      timestamp: script.updated_at,
      href: `/portfolio?project=${encodeURIComponent(project.id)}`,
    })));
    return items;
  }, [project, projectCases, projectInsights, projectScripts, projectSessions, t]);

  const visibleAssets = useMemo(() => {
    const query = assetSearch.trim().toLocaleLowerCase();
    return assets.filter((asset) => (
      (assetType === "all" || asset.type === assetType)
      && asset.title.toLocaleLowerCase().includes(query)
    )).sort((left, right) => {
      const a = assetDate(left.timestamp).getTime();
      const b = assetDate(right.timestamp).getTime();
      if (Number.isNaN(a)) return Number.isNaN(b) ? left.id.localeCompare(right.id) : 1;
      if (Number.isNaN(b)) return -1;
      const difference = assetSort === "oldest" ? a - b : b - a;
      return difference || left.id.localeCompare(right.id);
    });
  }, [assetSearch, assetSort, assetType, assets]);

  const currentMaterialSetId = selectedMaterialSet?.id || "";

  const visibleMaterials = useMemo(() => {
    if (selectedMaterialSet) return projectMaterials;
    const query = materialSetSearch.trim().toLocaleLowerCase();
    return projectMaterials.filter((material) =>
      material.name.toLocaleLowerCase().includes(query)
    ).sort((left, right) => {
      const a = assetDate(left.created_at).getTime();
      const b = assetDate(right.created_at).getTime();
      if (Number.isNaN(a)) return Number.isNaN(b) ? left.id.localeCompare(right.id) : 1;
      if (Number.isNaN(b)) return -1;
      return (materialSetSort === "oldest" ? a - b : b - a) || left.id.localeCompare(right.id);
    });
  }, [materialSetSearch, materialSetSort, projectMaterials, selectedMaterialSet]);

  const visibleChannelAccounts = useMemo(() => {
    const query = channelSearch.trim().toLocaleLowerCase();
    const filtered = channelAccounts.filter((account) =>
      (channelPlatformFilter === "all" || account.platform === channelPlatformFilter)
      && account.account_name.toLocaleLowerCase().includes(query));
    return [...filtered].sort((left, right) => {
      const difference = Date.parse(left.created_at) - Date.parse(right.created_at);
      return channelSortOrder === "asc" ? difference : -difference;
    });
  }, [channelAccounts, channelPlatformFilter, channelSearch, channelSortOrder]);

  const typeCount = (type: Exclude<AssetType, "all">) =>
    assets.filter((asset) => asset.type === type).length;

  const openAccountDialog = () => {
    setChoosingPlatform(true);
    setDeviceAuthorization(null);
    setDeviceQrCode("");
    setDeviceAuthorizationStatus("pending");
    accountDialogRef.current?.showModal();
  };

  const openMaterialDialog = () => {
    setMaterialFilesExpanded(false);
    setMaterialUploadMode("image");
    setMaterialImages([]);
    setMaterialVideo(null);
    setMaterialDocuments([]);
    setCopyMode("document");
    setCopyHtml("");
    setCopyText("");
    setEditorVersion((value) => value + 1);
    materialDialogRef.current?.showModal();
  };

  const openMaterialPreview = (material: ProjectMaterial) => {
    setMaterialToPreview(material);
    materialPreviewDialogRef.current?.showModal();
  };

  const closeMaterialPreview = () => {
    materialPreviewDialogRef.current?.close();
    setMaterialToPreview(null);
  };

  const loadMaterialSet = async (materialSetId: string) => {
    const response = await fetch_project_materials(projectId, materialSetId);
    setProjectMaterials(response.data || []);
  };

  const enterMaterialSet = async (materialSet: ProjectMaterial) => {
    setMaterialSaving(true);
    try {
      await loadMaterialSet(materialSet.id);
      setSelectedMaterialSet(materialSet);
    } catch (error) {
      showError(localizeErrorMessage(
        error instanceof Error ? error.message : "Could not load material set",
        locale,
      ));
    } finally {
      setMaterialSaving(false);
    }
  };

  const leaveMaterialSet = async () => {
    setMaterialSaving(true);
    try {
      await loadMaterialSet("");
      setSelectedMaterialSet(null);
    } catch (error) {
      showError(localizeErrorMessage(
        error instanceof Error ? error.message : "Could not load material sets",
        locale,
      ));
    } finally {
      setMaterialSaving(false);
    }
  };

  const createMaterialSet = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = materialSetName.trim();
    if (!name) return;
    setMaterialSaving(true);
    try {
      const response = await create_project_material_set(
        projectId,
        name,
      );
      setProjectMaterials((current) => [...current, response.data].sort(
        (left, right) => left.name.localeCompare(right.name, locale),
      ));
      materialSetDialogRef.current?.close();
      setMaterialSetName("");
      showSuccess(t("素材集已创建", "Material set created"));
    } catch (error) {
      showError(localizeErrorMessage(
        error instanceof Error ? error.message : "Could not create material set",
        locale,
      ));
    } finally {
      setMaterialSaving(false);
    }
  };

  const uploadMaterial = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (materialSaving) return;
    if (materialUploadMode === "copy" && copyMode === "rich") {
      const title = materialCopyTitle(copyText);
      if (!title) {
        showError(t("请输入文案正文。", "Enter copy content."));
        return;
      }
      if (new TextEncoder().encode(copyHtml).length > 1024 * 1024) {
        showError(t("富文本内容过长，请缩短后重试。", "Rich text is too long. Shorten it and try again."));
        return;
      }
      setMaterialSaving(true);
      try {
        const response = await create_project_material_copy(
          projectId, currentMaterialSetId, title, copyHtml,
        );
        setProjectMaterials((current) => [...current, response.data]);
        materialDialogRef.current?.close();
        showSuccess(t("文案已添加", "Copy added"));
      } catch (error) {
        showError(localizeErrorMessage(
          error instanceof Error ? error.message : "Could not create material copy", locale,
        ));
      } finally {
        setMaterialSaving(false);
      }
      return;
    }
    const files = selectedMaterialFiles;
    if (files.length === 0) {
      showError(t("请选择素材文件", "Choose a material file"));
      return;
    }
    setMaterialSaving(true);
    const uploaded: ProjectMaterial[] = [];
    try {
      for (const file of files) {
        const response = await upload_project_material(
          projectId,
          file,
          currentMaterialSetId,
        );
        uploaded.push(response.data);
        if (materialUploadMode === "image") setMaterialImages((current) => current.filter((item) => item !== file));
        else if (materialUploadMode === "video") setMaterialVideo(null);
        else setMaterialDocuments((current) => current.filter((item) => item !== file));
      }
      setProjectMaterials((current) => [...current, ...uploaded]);
      materialDialogRef.current?.close();
      setMaterialImages([]);
      setMaterialVideo(null);
      setMaterialDocuments([]);
      showSuccess(materialUploadMode === "copy" ? t("文档已解析并添加为文案", "Document parsed and added as copy") : t(
        "已上传 {count} 个素材",
        "{count} materials uploaded",
        { count: uploaded.length },
      ));
    } catch (error) {
      if (uploaded.length > 0) {
        setProjectMaterials((current) => [...current, ...uploaded]);
      }
      const reason = localizeErrorMessage(
        error instanceof Error ? error.message : "Could not upload project material",
        locale,
      );
      showError(uploaded.length ? t(
        "已上传 {count} 个文件，其余未完成，请重试：{reason}",
        "{count} files uploaded. Retry the remaining files: {reason}",
        { count: uploaded.length, reason },
      ) : reason);
    } finally {
      setMaterialSaving(false);
    }
  };

  const renameMaterialSet = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = materialSetRenameName.trim();
    if (!materialSetToRename || !name) return;
    setMaterialSaving(true);
    try {
      const response = await update_project_material_set(
        projectId,
        materialSetToRename.id,
        name,
      );
      setProjectMaterials((current) => current.map((material) => (
        material.id === response.data.id ? { ...response.data, covers: material.covers } : material
      )).sort((left, right) => left.name.localeCompare(right.name, locale)));
      setSelectedMaterialSet((current) => (
        current?.id === response.data.id ? response.data : current
      ));
      materialSetRenameDialogRef.current?.close();
      setMaterialSetToRename(null);
      setMaterialSetRenameName("");
      showSuccess(t("素材集已重命名", "Material set renamed"));
    } catch (error) {
      showError(localizeErrorMessage(
        error instanceof Error ? error.message : "Could not rename material set",
        locale,
      ));
    } finally {
      setMaterialSaving(false);
    }
  };

  const renameMaterial = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = materialRenameName.trim();
    if (!materialToRename || !name) return;
    setMaterialSaving(true);
    try {
      const response = await update_project_material(
        projectId,
        materialToRename.id,
        name,
      );
      setProjectMaterials((current) => current.map((material) => (
        material.id === response.data.id ? response.data : material
      )));
      materialRenameDialogRef.current?.close();
      setMaterialToRename(null);
      setMaterialRenameName("");
      showSuccess(t("素材已重命名", "Material renamed"));
    } catch (error) {
      showError(localizeErrorMessage(
        error instanceof Error ? error.message : "Could not rename material",
        locale,
      ));
    } finally {
      setMaterialSaving(false);
    }
  };

  const removeMaterial = async () => {
    if (!materialToDelete) return;
    setMaterialSaving(true);
    try {
      await delete_project_material(projectId, materialToDelete.id);
      setProjectMaterials((current) => current.filter(
        (material) => material.id !== materialToDelete.id,
      ));
      setMaterialToDelete(null);
      showSuccess(t("素材已删除", "Material deleted"));
    } catch (error) {
      showError(localizeErrorMessage(
        error instanceof Error ? error.message : "Could not delete project material",
        locale,
      ));
    } finally {
      setMaterialSaving(false);
    }
  };

  const authorizeChannelAccount = async () => {
    if (!project) return;
    setAccountSaving(true);
    try {
      const response = await start_project_channel_authorization(project.id, bindingPlatform);
      if (response.data.mode === "redirect") {
        window.location.assign(response.data.authorization_url);
        return;
      }
      const qrCode = await QRCode.toDataURL(response.data.authorization_url, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 224,
        color: { dark: "#101828", light: "#ffffff" },
      });
      setDeviceAuthorization({
        state: response.data.state,
        authorizationUrl: response.data.authorization_url,
        expiresIn: response.data.expires_in,
        interval: response.data.interval,
        userCode: response.data.user_code,
      });
      setDeviceAuthorizationStatus("pending");
      setDeviceQrCode(qrCode);
    } catch (error) {
      showError(localizeErrorMessage(
        error instanceof Error ? error.message : "Could not start channel authorization",
        locale,
      ));
    } finally {
      setAccountSaving(false);
    }
  };

  const unbindChannelAccount = async (account: ProjectChannelAccount) => {
    if (
      !project
      || (!canManageMembers && account.created_by_user_id !== user?.id)
    ) return;
    setAccountSaving(true);
    try {
      await delete_project_channel_account(project.id, account.id);
      setChannelAccounts((current) => current.filter((item) => item.id !== account.id));
      showSuccess(t("账号授权已取消", "Account authorization revoked"));
    } catch (error) {
      showError(localizeErrorMessage(
        error instanceof Error ? error.message : "Could not remove channel account",
        locale,
      ));
    } finally {
      setAccountSaving(false);
    }
  };

  const inviteMember = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = inviteEmail.trim();
    if (!email) {
      showError(t("请输入邮箱", "Email is required"));
      return;
    }
    setInviting(true);
    try {
      const response = await invite_project_member(projectId, email, inviteRole);
      setMembers((current) => [...current, response.data]);
      setInviteEmail("");
      setInviteRole("member");
      inviteDialogRef.current?.close();
      showSuccess(t("成员已加入项目。", "The member was added to the project."));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not add project member", locale));
    } finally {
      setInviting(false);
    }
  };

  const changeMemberRole = async (member: ProjectMember, role: "member" | "admin") => {
    if (member.role === role) return;
    setInviting(true);
    try {
      const response = await update_project_member_role(projectId, member.user_id, role);
      setMembers((current) => current.map((item) => item.user_id === member.user_id ? response.data : item));
      showSuccess(t("项目成员权限已更新。", "Project member permissions updated."));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not update project member", locale));
    } finally {
      setInviting(false);
    }
  };

  const removeMember = async (member: ProjectMember) => {
    setInviting(true);
    try {
      await remove_project_member(projectId, member.user_id);
      setMembers((current) => current.filter((item) => item.user_id !== member.user_id));
      removeDialogRef.current?.close();
      setMemberToRemove(null);
      showSuccess(t("成员已移出项目。", "The member was removed from the project."));
    } catch (error) {
      showError(localizeErrorMessage(error instanceof Error ? error.message : "Could not remove project member", locale));
    } finally {
      setInviting(false);
    }
  };

  if (authLoading || loading || !project) {
    return <div className="amp-page-state" role="status">{t("正在加载项目...", "Loading project...")}</div>;
  }

  const categories: Array<{ type: Exclude<AssetType, "all">; label: string }> = [
    { type: "insight", label: t("市场洞察", "Market insights") },
    { type: "case", label: t("案例", "Cases") },
    { type: "content", label: t("智能创作", "Content Studio") },
    { type: "portfolio", label: t("作品", "Portfolio") },
  ];
  const canManageMembers = project.role === "owner" || project.role === "admin";
  const canManageAdmins = project.role === "owner";
  const roleOptions = [
    { value: "member" as const, label: t("成员", "Member") },
    { value: "admin" as const, label: t("管理员", "Administrator") },
  ];
  return (
    <div className="amp-project-detail-layout">
      <ProjectQuickSidebar projects={quickProjects} currentProjectId={project.id} />
      <main className={`amp-project-detail-main${selectedMaterialSet ? " is-material-set" : ""}`}>
        <header className="amp-project-detail-header">
          {selectedMaterialSet ? (
            <div className="amp-project-detail-title amp-project-material-detail-title">
              <button type="button" className="amp-project-detail-back"
                aria-label={t("返回素材集", "Back to material sets")}
                disabled={materialSaving}
                onClick={() => void leaveMaterialSet()}>
                <InlineIcon name="arrowLeft" />
              </button>
              <div>
                <h1>{selectedMaterialSet.name}</h1>
              </div>
            </div>
          ) : (
            <div className="amp-project-detail-title">
              <Link href="/projects" className="amp-project-detail-back" aria-label={t("返回项目列表", "Back to projects")}>
                <InlineIcon name="arrowLeft" />
              </Link>
              <span className="amp-project-avatar amp-project-custom-avatar"
                style={{ backgroundColor: project.avatar_color || "#bfdbfe" }}>
                <span className="amp-project-avatar-emoji">{project.avatar_icon || "💡"}</span>
              </span>
              <div>
                <h1>{project.title}</h1>
                {project.notes && <p>{project.notes}</p>}
              </div>
            </div>
          )}
          {selectedMaterialSet ? (
            <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="amp-button amp-button-secondary"
              disabled={materialSaving} aria-haspopup="dialog"
              onClick={() => {
                setMaterialMenuId(null);
                materialManagementDialogRef.current?.showModal();
              }}>
              {t("管理素材", "Manage materials")}
            </button>
            <button type="button" className="amp-button amp-button-primary"
              disabled={materialSaving} onClick={openMaterialDialog}>
              {t("上传素材", "Upload material")}
            </button>
            </div>
          ) : tab === "materials" ? (
            <button type="button" className="amp-button amp-button-primary"
              disabled={materialSaving}
              onClick={() => {
                setMaterialSetName("");
                materialSetDialogRef.current?.showModal();
              }}>
              {t("创建素材集", "Create material set")}
            </button>
          ) : tab === "assets" ? <div ref={createMenuRef} className="amp-project-create-menu">
            <button type="button" className="amp-button amp-button-primary" aria-haspopup="menu" aria-expanded={createMenuOpen}
              onClick={() => setCreateMenuOpen((open) => !open)}>
              {t("添加资产", "Add asset")}
              <InlineIcon name="chevronRight" className="amp-project-create-chevron" />
            </button>
            {createMenuOpen && (
              <div role="menu" className="amp-project-create-popover">
                <Link role="menuitem" href={`/market_insight?project=${encodeURIComponent(project.id)}`}><InlineIcon name="insight" />{t("市场洞察", "Market insight")}</Link>
                <Link role="menuitem" href={`/case_library?project=${encodeURIComponent(project.id)}`}><InlineIcon name="case" />{t("案例", "Case")}</Link>
                <Link role="menuitem" href={`/content_generator?project=${encodeURIComponent(project.id)}`}><InlineIcon name="edit" />{t("智能创作", "Content Studio")}</Link>
                <Link role="menuitem" href={`/portfolio?project=${encodeURIComponent(project.id)}`}><InlineIcon name="briefcase" />{t("作品", "Portfolio")}</Link>
              </div>
            )}
          </div> : tab === "members" && canManageMembers ? (
            <button type="button" className="amp-button amp-button-primary"
              onClick={() => {
                setInviteEmail("");
                setInviteRole("member");
                inviteDialogRef.current?.showModal();
              }}>
              {t("邀请成员", "Invite member")}
            </button>
          ) : tab === "channels" ? (
            <button type="button" className="amp-button amp-button-primary"
              onClick={openAccountDialog}>
              {t("添加渠道", "Add channel")}
            </button>
          ) : null}
        </header>

        {!selectedMaterialSet && <div className="amp-project-detail-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "assets"} onClick={() => setTab("assets")}>{t("资产", "Assets")}</button>
          <button type="button" role="tab" aria-selected={tab === "materials"}
            onClick={() => setTab("materials")}>{t("素材", "Materials")}</button>
          <button type="button" role="tab" aria-selected={tab === "members"} onClick={() => setTab("members")}>{t("成员", "Members")}</button>
          <button type="button" role="tab" aria-selected={tab === "channels"} onClick={() => setTab("channels")}>{t("集成", "Integrations")}</button>
        </div>}

        {tab === "materials" ? (
          <section className="amp-project-materials" aria-label={t("项目素材", "Project materials")}>
            {!selectedMaterialSet && (
              <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
                <div className="amp-projects-search amp-project-asset-search">
                  <RedesignInput
                    leftIcon={<InlineIcon name="search" className="h-4 w-4" />}
                    value={materialSetSearch}
                    onChange={(event) => setMaterialSetSearch(event.target.value)}
                    placeholder={t("搜索素材集", "Search material sets")}
                    aria-label={t("搜索素材集", "Search material sets")}
                  />
                </div>
                <EnterpriseSelect
                  value={materialSetSort}
                  onChange={setMaterialSetSort}
                  ariaLabel={t("素材集时间排序", "Material set time sorting")}
                  className="ml-auto w-36 max-w-full"
                  options={[
                    { value: "newest", label: t("最新优先", "Newest first") },
                    { value: "oldest", label: t("最早优先", "Oldest first") },
                  ]}
                />
              </div>
            )}
            {!selectedMaterialSet && materialSetSearch.trim() && visibleMaterials.length === 0 ? (
              <div className="amp-project-assets-empty amp-project-material-empty">
                <InlineIcon name="search" />
                <strong>{t("未找到匹配的素材集", "No matching material sets")}</strong>
                <p>{t("请尝试其他关键词。", "Try another search term.")}</p>
              </div>
            ) : projectMaterials.length === 0 ? (
              <div className="amp-project-assets-empty amp-project-material-empty">
                <InlineIcon name="collection" />
                <strong>{!selectedMaterialSet
                  ? t("还没有素材集", "No material sets yet")
                  : t("此素材集为空", "This material set is empty")}</strong>
                <p>{t(
                  !selectedMaterialSet
                    ? "创建素材集，将相关的图片、视频和文案整理在一起。"
                    : "上传图片、视频或文案素材。",
                  !selectedMaterialSet
                    ? "Create a material set to organize related images, videos, and copy."
                    : "Upload images, videos, or copy.",
                )}</p>
              </div>
            ) : (
              <div className="amp-project-material-grid">
                {visibleMaterials.map((material) => {
                  const canDeleteMaterial = canManageMembers
                    || material.created_by_user_id === user?.id;
                  const preview = (
                    <span className="amp-project-material-preview">
                    {material.node_type === "file" && (
                      <span className="amp-case-type-overlay amp-project-material-type-overlay">
                        {material.media_type === "video"
                          ? t("视频", "Video")
                          : material.media_type === "image" ? t("图片", "Image") : t("文案", "Copy")}
                      </span>
                    )}
                    {material.node_type === "collection" ? (
                      <span className={`amp-material-collage has-${material.covers.length}`}>
                        {material.covers.length ? material.covers.map((cover) => (
                          <span key={cover.id} className="amp-material-collage-frame">
                            {cover.media_type === "image"
                              ? <Image src={cover.file_url} alt="" width={400} height={300}
                                  unoptimized className="amp-material-collage-media" />
                              : <video src={cover.file_url} muted playsInline preload="metadata"
                                  className="amp-material-collage-media" />}
                          </span>
                        )) : (
                          <span className="amp-material-collage-empty">
                            <InlineIcon name="collection" />
                            <span>{material.material_count > 0 ? t("文案素材集", "Copy collection") : t("暂无素材", "No materials yet")}</span>
                          </span>
                        )}
                      </span>
                    ) : material.media_type === "video" ? (
                      <video src={material.file_url} muted playsInline preload="metadata"
                        className="amp-project-material-media" />
                    ) : material.media_type === "document" ? (
                      <MaterialDocumentThumbnail material={material} />
                    ) : (
                      <Image src={material.file_url} alt={material.name}
                        width={600} height={450} unoptimized sizes="120px"
                        className="amp-project-material-media" />
                    )}
                    </span>
                  );
                  const actions = canDeleteMaterial && material.node_type === "collection" ? (
                    <div ref={materialMenuId === material.id ? materialMenuRef : undefined}
                      className="amp-project-material-menu">
                      <button type="button" className="amp-member-action-more"
                        aria-haspopup="menu" aria-expanded={materialMenuId === material.id}
                        aria-label={t("{name} 素材操作", "Material actions for {name}", {
                          name: material.name,
                        })}
                        onClick={() => setMaterialMenuId((current) =>
                          current === material.id ? null : material.id)}>
                        <InlineIcon name="more" className="h-5 w-5" strokeWidth={3} />
                      </button>
                      {materialMenuId === material.id && (
                        <div role="menu" className="amp-member-action-menu">
                          {material.node_type === "collection" && (
                            <button type="button" role="menuitem"
                              disabled={materialSaving}
                              onClick={() => {
                                setMaterialMenuId(null);
                                setMaterialSetToRename(material);
                                setMaterialSetRenameName(material.name);
                                materialSetRenameDialogRef.current?.showModal();
                              }}>
                              <InlineIcon name="edit" />
                              {t("重命名", "Rename")}
                            </button>
                          )}
                          <button type="button" role="menuitem"
                            className="amp-member-action-danger"
                            disabled={materialSaving}
                            onClick={() => {
                              setMaterialMenuId(null);
                              setMaterialToDelete(material);
                            }}>
                            <InlineIcon name="trash" />
                            {t("删除", "Delete")}
                          </button>
                        </div>
                      )}
                    </div>
                  ) : null;
                  return (
                    <article key={material.id}
                      className={`amp-project-material-card is-${material.node_type === "collection" ? "collection" : material.media_type}`}>
                      {material.node_type === "collection" ? (
                        <button type="button" className="amp-project-material-open"
                          onClick={() => void enterMaterialSet(material)}>
                          {preview}
                        </button>
                      ) : material.media_type === "document" ? (
                        <div className="amp-material-document-cover">
                          {preview}
                          <button type="button" className="amp-project-material-open amp-material-document-cover-open"
                            aria-label={t("预览文案：{name}", "Preview copy: {name}", { name: material.name })}
                            onClick={() => openMaterialPreview(material)} />
                        </div>
                      ) : (
                        <button type="button" className="amp-project-material-open"
                          onClick={() => openMaterialPreview(material)}>
                          {preview}
                        </button>
                      )}
                      <div className="amp-project-material-copy">
                        <div className="amp-project-material-title-row">
                          {material.node_type === "collection" ? (
                            <button type="button" onClick={() => void enterMaterialSet(material)}
                              title={material.name}>
                              <strong>{material.name}</strong>
                            </button>
                          ) : (
                            <button type="button" title={material.name}
                              onClick={() => openMaterialPreview(material)}>
                              <strong>{material.name}</strong>
                            </button>
                          )}
                          {actions}
                        </div>
                        {material.node_type === "collection" && (
                          <div className="amp-material-collection-meta">
                            <span>{t("{count} 个素材", "{count} materials", { count: material.material_count })}</span>
                            <span>{t("图片 {images} · 视频 {videos}", "{images} images · {videos} videos", {
                              images: material.image_count, videos: material.video_count,
                            })}{material.document_count > 0 && t(" · 文案 {count}", " · {count} documents", {
                              count: material.document_count,
                            })}</span>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        ) : tab === "assets" ? (
          <>
            <div className="mt-5 mb-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="amp-projects-search amp-project-asset-search">
                <RedesignInput
                  leftIcon={<InlineIcon name="search" className="h-4 w-4" />}
                  value={assetSearch}
                  onChange={(event) => setAssetSearch(event.target.value)}
                  placeholder={t("搜索资产", "Search assets")}
                  aria-label={t("搜索资产", "Search assets")}
                />
              </div>
              <div className="ml-auto flex flex-wrap justify-end gap-3">
              <EnterpriseSelect<AssetType>
                value={assetType}
                onChange={setAssetType}
                ariaLabel={t("资产类型", "Asset type")}
                className="w-40 max-w-full"
                options={[
                  { value: "all", label: `${t("全部", "All")} (${assets.length})` },
                  ...categories.map((category) => ({
                    value: category.type,
                    label: `${category.label} (${typeCount(category.type)})`,
                  })),
                ]}
              />
              <EnterpriseSelect
                value={assetSort}
                onChange={setAssetSort}
                ariaLabel={t("资产时间排序", "Asset time sorting")}
                className="w-36 max-w-full"
                options={[
                  { value: "newest", label: t("最新优先", "Newest first") },
                  { value: "oldest", label: t("最早优先", "Oldest first") },
                ]}
              />
              </div>
            </div>

            <div className="amp-project-asset-list">
              {visibleAssets.length === 0 ? (
                <div className="amp-project-assets-empty">
                  <InlineIcon name="folder" />
                  <strong>{assetSearch.trim()
                    ? t("未找到匹配资产", "No matching assets")
                    : assetType !== "all" ? t("没有此类资产", "No assets of this type") : t("项目中还没有资产", "No assets in this project yet")}</strong>
                  <p>{assetSearch.trim()
                    ? t("请尝试其他关键词或调整资产类型。", "Try another search term or change the asset type.")
                    : t("市场洞察、案例、智能创作和作品都可以归入这个项目。", "Market insights, cases, generated content, and portfolio work can all live in this project.")}</p>
                </div>
              ) : visibleAssets.map((asset) => (
                <article key={asset.id} className={`amp-project-asset-row amp-project-asset-${asset.type}`}>
                  <div className="amp-project-asset-icon">
                    <InlineIcon name={asset.icon} />
                  </div>
                  <div className="amp-project-asset-copy">
                    {asset.href ? (
                      <Link href={asset.href}><strong>{asset.title}</strong></Link>
                    ) : <strong>{asset.title}</strong>}
                    <span>{asset.detail}</span>
                  </div>
                  <span className="amp-project-asset-type">
                    {asset.type === "content" ? t("智能创作", "Content Studio")
                      : asset.type === "portfolio" ? t("作品", "Portfolio")
                        : asset.type === "insight" ? t("市场洞察", "Market insight") : t("案例", "Case")}
                  </span>
                  <time>{asset.timestamp ? formatDate(asset.timestamp, locale) : t("暂无时间", "No timestamp")}</time>
                  {asset.href ? (
                    <Link href={asset.href}
                      className="amp-project-asset-more" aria-label={t("打开 {name}", "Open {name}", { name: asset.title })}>
                      <InlineIcon name="chevronRight" />
                    </Link>
                  ) : <InlineIcon name="more" className="amp-project-asset-more" />}
                </article>
              ))}
            </div>
          </>
        ) : tab === "channels" ? (
          <section className="amp-project-channels" aria-label={t("渠道集成", "Channel integrations")}>
            <div className="amp-project-channel-toolbar">
              <div className="amp-projects-search amp-project-asset-search mr-auto">
                <RedesignInput
                  leftIcon={<InlineIcon name="search" className="h-4 w-4" />}
                  value={channelSearch}
                  onChange={(event) => setChannelSearch(event.target.value)}
                  placeholder={t("搜索渠道账号", "Search channel accounts")}
                  aria-label={t("搜索渠道账号", "Search channel accounts")}
                />
              </div>
              <EnterpriseSelect
                value={channelPlatformFilter}
                options={[
                  { value: "all", label: t("全部应用", "All applications") },
                  ...MARKETING_CHANNELS.map((channel) => ({
                    value: channel.key,
                    label: t(channel.zh, channel.en),
                  })),
                ]}
                onChange={setChannelPlatformFilter}
                ariaLabel={t("筛选应用", "Filter applications")}
                className="w-36"
              />
              <EnterpriseSelect
                value={channelSortOrder}
                options={[
                  { value: "desc", label: t("最近创建", "Newest") },
                  { value: "asc", label: t("最早创建", "Oldest") },
                ]}
                onChange={setChannelSortOrder}
                ariaLabel={t("账号创建时间排序", "Sort by account creation time")}
                className="w-40"
              />
            </div>
            <div className="amp-project-integration-list has-toolbar">
              {channelAccounts.length === 0 ? (
                <div className="amp-project-assets-empty">
                  <InlineIcon name="share" />
                  <strong>{t("尚未添加渠道", "No channels added")}</strong>
                  <p>{t("点击右上角“添加渠道”绑定发布账号。", "Use Add channel to bind a publishing account.")}</p>
                </div>
              ) : visibleChannelAccounts.length === 0 ? (
                <div className="amp-project-channel-filter-empty">
                  {channelSearch.trim()
                    ? t("未找到匹配账号，请调整关键词或应用筛选。", "No matching accounts. Try another search term or application.")
                    : t("该应用暂无授权账号", "No authorized accounts for this application")}
                </div>
              ) : visibleChannelAccounts.map((account) => {
                const channel = MARKETING_CHANNELS.find((item) => item.key === account.platform)!;
                const canRevokeAccount = canManageMembers || account.created_by_user_id === user?.id;
                return (
                  <article key={account.id} className="amp-project-integration-row">
                    <div className="amp-project-integration-main">
                      <div className="amp-project-integration-app">
                        <span className="amp-project-integration-icon" aria-hidden="true">
                          <Image src={channel.logo} alt="" width={42} height={42} />
                        </span>
                        <strong>{t(channel.zh, channel.en)}</strong>
                      </div>
                      <div className="amp-project-integration-account">
                        <strong>{account.account_name}</strong>
                        <span>{account.platform_user_id || t("未提供平台账号 ID", "No platform account ID")}</span>
                      </div>
                      <div className="amp-project-integration-creator">
                        <span className="amp-project-integration-avatar"
                          style={{ backgroundColor: memberAvatarColor(account.created_by_user_id || account.creator_name) }}>
                          {account.creator_avatar_url ? (
                            <Image src={mediaUrl(account.creator_avatar_url)} alt="" width={34} height={34}
                              unoptimized className="h-full w-full object-cover" />
                          ) : (
                            userAvatarInitial(account.creator_name || t("项目成员", "Project member"))
                          )}
                        </span>
                        <strong>{account.creator_name || t("项目成员", "Project member")}</strong>
                      </div>
                      <time className="amp-project-integration-created">
                        {formatDate(account.created_at, locale)}
                      </time>
                      {(account.profile_url || canRevokeAccount) && (
                      <div ref={channelMenuAccountId === account.id ? channelMenuRef : undefined}
                        className="amp-project-integration-actions">
                        <button type="button" className="amp-member-action-more"
                          aria-haspopup="menu"
                          aria-expanded={channelMenuAccountId === account.id}
                          aria-label={t("{name} 的账号操作", "Account actions for {name}", { name: account.account_name })}
                          onClick={() => setChannelMenuAccountId((current) =>
                            current === account.id ? null : account.id)}>
                          <InlineIcon name="more" className="h-5 w-5" strokeWidth={3} />
                        </button>
                        {channelMenuAccountId === account.id && (
                          <div role="menu" className="amp-member-action-menu amp-channel-action-menu"
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                setChannelMenuAccountId(null);
                              }
                            }}>
                            {account.profile_url && (
                              <a role="menuitem" href={account.profile_url} target="_blank" rel="noreferrer"
                                onClick={() => setChannelMenuAccountId(null)}>
                                <InlineIcon name="eye" />
                                {t("查看主页", "Open profile")}
                              </a>
                            )}
                            {canRevokeAccount && (
                              <button type="button" role="menuitem" className="amp-channel-revoke"
                                disabled={accountSaving}
                                onClick={() => {
                                  setChannelMenuAccountId(null);
                                  void unbindChannelAccount(account);
                                }}>
                                <InlineIcon name="close" />
                                {t("取消授权", "Revoke access")}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="amp-project-members">
            <div className="amp-workspace-card p-5">
              <div className="divide-y divide-slate-100">
              {members.map((member) => {
                const canEditMember = canManageMembers
                  && member.role !== "owner"
                  && member.user_id !== user?.id
                  && (canManageAdmins || member.role === "member");
                const displayName = member.nickname || member.username;
                return (
                <div key={member.user_id} className="flex flex-col gap-3 py-3.5 first:pt-0 last:pb-0 sm:grid sm:grid-cols-[minmax(0,1.1fr)_minmax(220px,1fr)_72px] sm:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white ${memberAvatarColor(member.user_id)}`}>
                      {member.avatar_url ? (
                        <Image
                          src={mediaUrl(member.avatar_url)}
                          alt=""
                          fill
                          sizes="36px"
                          unoptimized
                          className="object-cover"
                        />
                      ) : (
                        userAvatarInitial(displayName)
                      )}
                    </span>
                    <span className="min-w-0">
                      <strong className="block truncate text-sm font-semibold text-slate-900">{displayName}</strong>
                      <small className="mt-1 block truncate text-xs text-slate-500">{member.email || `@${member.username}`}</small>
                    </span>
                  </div>
                  <div className="flex items-center text-sm text-slate-600 sm:justify-self-start">
                    {canEditMember ? (
                      <EnterpriseSelect
                        value={member.role as "member" | "admin"}
                        options={roleOptions}
                        onChange={(role) => void changeMemberRole(member, role)}
                        ariaLabel={t("设置 {name} 的项目权限", "Set project permissions for {name}", { name: displayName })}
                        disabled={inviting}
                        variant="inline"
                        className="w-auto"
                      />
                    ) : (
                      <span className="text-sm font-[550] leading-5 text-[#344054]">
                        {member.role === "owner" ? t("所有者", "Owner") : member.role === "admin" ? t("管理员", "Administrator") : t("成员", "Member")}
                      </span>
                    )}
                  </div>
                  <div className="sm:justify-self-end">
                    {canEditMember && (
                      <div ref={memberMenuUserId === member.user_id ? memberMenuRef : undefined}
                        className="relative inline-flex">
                        <button type="button" disabled={inviting}
                          className="amp-member-action-more"
                          aria-haspopup="menu"
                          aria-expanded={memberMenuUserId === member.user_id}
                          aria-label={t("{name} 的成员操作", "Member actions for {name}", { name: displayName })}
                          onClick={() => setMemberMenuUserId((current) =>
                            current === member.user_id ? null : member.user_id)}>
                          <InlineIcon name="more" className="h-5 w-5" strokeWidth={3} />
                        </button>
                        {memberMenuUserId === member.user_id && (
                          <div role="menu" className="amp-member-action-menu"
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                event.preventDefault();
                                setMemberMenuUserId(null);
                              }
                            }}>
                            <button type="button" role="menuitem"
                              className="amp-member-action-danger" disabled={inviting}
                              onClick={() => {
                                setMemberMenuUserId(null);
                                setMemberToRemove(member);
                                removeDialogRef.current?.showModal();
                              }}>
                              <InlineIcon name="trash" />
                              {t("移出成员", "Remove member")}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                );
              })}
              </div>
            </div>
          </section>
        )}

        <dialog ref={materialManagementDialogRef} aria-labelledby="material-management-title"
          className="amp-material-preview-dialog amp-material-management-dialog m-auto w-[calc(100%_-_32px)] max-w-lg bg-white text-slate-950 backdrop:bg-slate-950/40"
          onClose={() => setMaterialMenuId(null)}
          onCancel={(event) => {
            if (materialSaving || materialMenuId) {
              event.preventDefault();
              if (!materialSaving) setMaterialMenuId(null);
            }
          }}>
          <header>
            <h2 id="material-management-title">{t("管理素材", "Manage materials")}</h2>
            <button type="button" className="amp-material-preview-icon" disabled={materialSaving}
              aria-label={t("关闭素材管理", "Close material management")}
              onClick={() => materialManagementDialogRef.current?.close()}>
              <InlineIcon name="close" />
            </button>
          </header>
          <div ref={materialManagementBodyRef} className="amp-material-management"
            onScroll={() => setMaterialMenuId(null)}>
            {selectedMaterialSet && (projectMaterials.length === 0 ? (
              <p className="amp-material-management-empty">{t("此素材集为空", "This material set is empty")}</p>
            ) : (
              <ul>
                {projectMaterials.map((material) => {
                  const canManage = canManageMembers || material.created_by_user_id === user?.id;
                  return (
                    <li key={material.id}>
                      <InlineIcon name={material.media_type === "video" ? "videoFile" : material.media_type === "image" ? "imageFile" : "file"} strokeWidth={1.25} />
                      <span className="amp-material-management-name" title={material.name}>{material.name}</span>
                      <div className={`amp-material-management-actions amp-project-material-menu${materialMenuOpensUp ? " opens-up" : ""}`}
                        ref={materialMenuId === material.id ? materialMenuRef : undefined}>
                        <button type="button" className="amp-member-action-more"
                          disabled={materialSaving || !canManage}
                          aria-label={t("{name} 素材操作", "Material actions for {name}", { name: material.name })}
                          aria-haspopup="menu" aria-expanded={materialMenuId === material.id}
                          onClick={(event) => {
                            const button = event.currentTarget.getBoundingClientRect();
                            const body = materialManagementBodyRef.current?.getBoundingClientRect();
                            setMaterialMenuOpensUp(Boolean(body && button.bottom + 104 > body.bottom && button.top - 104 > body.top));
                            setMaterialMenuId((current) => current === material.id ? null : material.id);
                          }}>
                          <InlineIcon name="more" className="h-5 w-5" strokeWidth={3} />
                        </button>
                        {materialMenuId === material.id && (
                          <div role="menu" className="amp-member-action-menu">
                            <button type="button" role="menuitem" disabled={materialSaving || !canManage}
                              onClick={() => {
                                setMaterialMenuId(null);
                                setMaterialToRename(material);
                                setMaterialRenameName(material.name);
                                materialRenameDialogRef.current?.showModal();
                              }}><InlineIcon name="edit" />{t("重命名", "Rename")}</button>
                            <button type="button" role="menuitem" className="amp-member-action-danger"
                              disabled={materialSaving || !canManage}
                              onClick={() => {
                                setMaterialMenuId(null);
                                setMaterialToDelete(material);
                              }}>
                              <InlineIcon name="trash" />{t("删除", "Delete")}
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ))}
          </div>
        </dialog>

        <dialog ref={materialPreviewDialogRef} aria-labelledby="material-preview-title"
          className="amp-material-preview-dialog m-auto w-[calc(100%_-_32px)] max-w-5xl bg-white text-slate-950 backdrop:bg-slate-950/70"
          onCancel={(event) => { if (materialCopySaving) event.preventDefault(); }}
          onClose={() => setMaterialToPreview(null)}>
          {materialToPreview && (materialToPreview.media_type === "document" ? (
            <MaterialDocumentPreview key={materialToPreview.id} material={materialToPreview}
              canEdit={canManageMembers || materialToPreview.created_by_user_id === user?.id}
              onClose={closeMaterialPreview} onSavingChange={setMaterialCopySaving}
              onSaved={(updated) => {
                setMaterialToPreview(updated);
                setProjectMaterials((current) => current.map((item) => item.id === updated.id ? updated : item));
              }} />
          ) : (
            <>
              <header>
                <h2 id="material-preview-title" title={materialToPreview.name}>
                  {materialToPreview.name}
                </h2>
                <button type="button" className="amp-material-preview-icon" aria-label={t("关闭预览", "Close preview")}
                  onClick={closeMaterialPreview}>
                  <InlineIcon name="close" />
                </button>
              </header>
              <div className="amp-material-preview-stage">
                {materialToPreview.media_type === "video" ? (
                  <video key={materialToPreview.id} src={materialToPreview.file_url}
                    controls autoPlay playsInline preload="metadata" />
                ) : (
                  <Image src={materialToPreview.file_url} alt={materialToPreview.name}
                    width={1600} height={1200} unoptimized
                    sizes="(min-width: 1024px) 80vw, 100vw" />
                )}
              </div>
            </>
          ))}
        </dialog>

        <dialog ref={materialSetDialogRef} aria-labelledby="create-material-set-title"
          className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
          onCancel={(event) => { if (materialSaving) event.preventDefault(); }}>
          <form onSubmit={(event) => void createMaterialSet(event)}>
            <h2 id="create-material-set-title" className="text-lg font-semibold">
              {t("创建素材集", "Create material set")}
            </h2>
            <label className="mt-5 block text-sm font-medium text-slate-700">
              {t("素材集名称", "Material set name")}
              <input autoFocus value={materialSetName} maxLength={120}
                disabled={materialSaving}
                onChange={(event) => setMaterialSetName(event.target.value)}
                className="amp-workspace-control mt-2 w-full font-normal"
                placeholder={t("请输入素材集名称", "Enter material set name")} />
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="amp-button amp-button-secondary amp-button-cancel"
                disabled={materialSaving}
                onClick={() => materialSetDialogRef.current?.close()}>
                {t("取消", "Cancel")}
              </button>
              <button type="submit" className="amp-button amp-button-primary"
                disabled={materialSaving || !materialSetName.trim()}>
                {materialSaving ? t("创建中...", "Creating...") : t("创建", "Create")}
              </button>
            </div>
          </form>
        </dialog>

        <dialog ref={materialSetRenameDialogRef} aria-labelledby="rename-material-set-title"
          className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
          onCancel={(event) => { if (materialSaving) event.preventDefault(); }}>
          <form onSubmit={(event) => void renameMaterialSet(event)}>
            <h2 id="rename-material-set-title" className="text-lg font-semibold">
              {t("重命名素材集", "Rename material set")}
            </h2>
            <label className="mt-5 block text-sm font-medium text-slate-700">
              {t("素材集名称", "Material set name")}
              <input autoFocus value={materialSetRenameName} maxLength={120}
                disabled={materialSaving}
                onChange={(event) => setMaterialSetRenameName(event.target.value)}
                className="amp-workspace-control mt-2 w-full font-normal"
                placeholder={t("请输入素材集名称", "Enter material set name")} />
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="amp-button amp-button-secondary amp-button-cancel"
                disabled={materialSaving}
                onClick={() => {
                  materialSetRenameDialogRef.current?.close();
                  setMaterialSetToRename(null);
                }}>
                {t("取消", "Cancel")}
              </button>
              <button type="submit" className="amp-button amp-button-primary"
                disabled={materialSaving || !materialSetRenameName.trim()}>
                {materialSaving ? t("保存中...", "Saving...") : t("保存", "Save")}
              </button>
            </div>
          </form>
        </dialog>

        <dialog ref={materialRenameDialogRef} aria-labelledby="rename-material-title"
          className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
          onCancel={(event) => { if (materialSaving) event.preventDefault(); }}>
          <form onSubmit={(event) => void renameMaterial(event)}>
            <h2 id="rename-material-title" className="text-lg font-semibold">
              {t("重命名素材", "Rename material")}
            </h2>
            <label className="mt-5 block text-sm font-medium text-slate-700">
              {t("素材名称", "Material name")}
              <input autoFocus value={materialRenameName} maxLength={255}
                disabled={materialSaving}
                onChange={(event) => setMaterialRenameName(event.target.value)}
                className="amp-workspace-control mt-2 w-full font-normal"
                placeholder={t("请输入素材名称", "Enter material name")} />
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" className="amp-button amp-button-secondary amp-button-cancel"
                disabled={materialSaving}
                onClick={() => {
                  materialRenameDialogRef.current?.close();
                  setMaterialToRename(null);
                }}>
                {t("取消", "Cancel")}
              </button>
              <button type="submit" className="amp-button amp-button-primary"
                disabled={materialSaving || !materialRenameName.trim()}>
                {materialSaving ? t("保存中...", "Saving...") : t("保存", "Save")}
              </button>
            </div>
          </form>
        </dialog>

        <dialog ref={materialDialogRef} aria-labelledby="upload-material-title"
          className="amp-workspace-dialog amp-insight-create-dialog m-auto w-[calc(100%_-_32px)] max-w-2xl bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
          onCancel={(event) => { if (materialSaving) event.preventDefault(); }}>
          <form onSubmit={(event) => void uploadMaterial(event)}>
            <h2 id="upload-material-title" className="text-xl font-semibold">
              {t("上传素材", "Upload material")}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {t("选择图片、视频或文案添加到当前素材集。", "Add images, a video, or copy to this material set.")}
            </p>

            <div className="amp-insight-create-modes amp-material-upload-modes mt-6" role="tablist">
              <button type="button" role="tab"
                aria-selected={materialUploadMode === "image"}
                disabled={materialSaving}
                onClick={() => {
                  setMaterialUploadMode("image");
                  setMaterialFilesExpanded(false);
                }}>
                <InlineIcon name="image" />{t("图片上传", "Images")}
              </button>
              <button type="button" role="tab"
                aria-selected={materialUploadMode === "video"}
                disabled={materialSaving}
                onClick={() => {
                  setMaterialUploadMode("video");
                  setMaterialFilesExpanded(false);
                }}>
                <InlineIcon name="video" />{t("视频上传", "Video")}
              </button>
              <button type="button" role="tab" disabled={materialSaving}
                aria-selected={materialUploadMode === "copy"}
                onClick={() => { setMaterialUploadMode("copy"); setMaterialFilesExpanded(false); }}>
                <InlineIcon name="file" />{t("上传文案", "Upload copy")}
              </button>
            </div>

            {materialUploadMode === "copy" && (
              <div className="amp-material-copy-method" role="group" aria-label={t("文案来源", "Copy source")}>
                <label>
                  <input type="radio" name="copy-method" checked={copyMode === "document"}
                    disabled={materialSaving} onChange={() => { setCopyMode("document"); setMaterialFilesExpanded(false); }} />
                  {t("上传文档", "Upload document")}
                </label>
                <label>
                  <input type="radio" name="copy-method" checked={copyMode === "rich"}
                    disabled={materialSaving} onChange={() => { setCopyMode("rich"); setMaterialFilesExpanded(false); }} />
                  {t("输入富文本", "Write rich text")}
                </label>
              </div>
            )}

            <div className="amp-insight-create-panel">
              {materialUploadMode === "copy" && copyMode === "rich" ? (
                <div className="amp-material-copy-fields">
                  <MaterialRichTextEditor key={editorVersion} content={copyHtml} disabled={materialSaving}
                    onChange={(html, text) => { setCopyHtml(html); setCopyText(text); }} />
                </div>
              ) : (
              <label className="amp-insight-upload amp-case-upload-dropzone">
                <InlineIcon name="upload" />
                <strong>{materialUploadMode === "video"
                  ? t("选择视频", "Select video")
                  : materialUploadMode === "copy" ? t("选择文档", "Select document") : t("选择图片", "Select images")}</strong>
                <span>{materialUploadMode === "video"
                  ? t("支持 MP4、MOV、WebM 和 M4V，最多 1 个文件", "MP4, MOV, WebM, and M4V; up to 1 file")
                  : materialUploadMode === "copy"
                    ? t("支持 TXT、Markdown、PDF 和 DOCX，最多 1 个文件", "TXT, Markdown, PDF, and DOCX; up to 1 file")
                    : t("支持 JPG、PNG、GIF 和 WebP，最多 10 张", "JPG, PNG, GIF, and WebP; up to 10 images")}</span>
                <input type="file" disabled={materialSaving}
                  accept={materialUploadMode === "video"
                    ? ".mp4,.mov,.webm,.m4v"
                    : materialUploadMode === "copy" ? ".txt,.md,.markdown,.pdf,.docx" : "image/*"}
                  multiple={materialUploadMode === "image"}
                  onChange={(event) => {
                    const isVideo = materialUploadMode === "video";
                    const result = selectUploadFiles(
                      selectedMaterialFiles,
                      Array.from(event.target.files || []),
                      materialUploadMode === "image" ? 10 : 1,
                    );
                    if (isVideo) setMaterialVideo(result.files[0] || null);
                    else if (materialUploadMode === "copy") setMaterialDocuments(result.files);
                    else setMaterialImages(result.files);
                    const messages: string[] = [];
                    if (result.duplicates.length > 0) {
                      messages.push(t(
                        "已选择以下文件，请勿重复添加：{names}",
                        "These files are already selected: {names}",
                        { names: [...new Set(result.duplicates)].join(", ") },
                      ));
                    }
                    if (result.limitExceeded) {
                      messages.push(isVideo ? t(
                        "只能上传一个视频，请先移除已选择的视频。",
                        "Only one video can be uploaded. Remove the selected video first.",
                      ) : materialUploadMode === "copy" ? t(
                        "只能上传一个文档，请先移除已选择的文档。",
                        "Only one document can be uploaded. Remove the selected document first.",
                      ) : t(
                        "最多选择 10 张图片，超出的图片未添加。",
                        "You can select up to 10 images. Additional images were not added.",
                      ));
                    }
                    if (messages.length > 0) showError(messages.join("\n"));
                    event.currentTarget.value = "";
                  }} />
              </label>
              )}
            </div>

            <div className="amp-insight-create-actions">
            {selectedMaterialFiles.length > 0 && (
              <div ref={materialSelectedFilesRef} className="amp-insight-selected-files">
                <button type="button" className="amp-insight-selected-files-toggle"
                  aria-expanded={materialFilesExpanded}
                  onClick={() => setMaterialFilesExpanded((current) => !current)}>
                  <span>{t("已选择 {count} 个文件", "{count} files selected", { count: selectedMaterialFiles.length })}</span>
                  <InlineIcon name="chevronRight" className={materialFilesExpanded ? "is-expanded" : ""} />
                </button>
              {materialFilesExpanded && <ul>
                {selectedMaterialFiles.map((file, index) => (
                  <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                    <span className="amp-insight-selected-file-copy">
                    <span className="amp-insight-selected-file-name" title={file.name}>{file.name}</span>
                    <small>{file.size >= 1024 * 1024
                      ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                      : `${(file.size / 1024).toFixed(1)} KB`}</small>
                    </span>
                    <button type="button" disabled={materialSaving}
                      aria-label={t("移除文件：{name}", "Remove file: {name}", { name: file.name })}
                      onClick={() => {
                        if (selectedMaterialFiles.length === 1) setMaterialFilesExpanded(false);
                        if (materialUploadMode === "video") setMaterialVideo(null);
                        else if (materialUploadMode === "copy") setMaterialDocuments((current) =>
                          current.filter((_, currentIndex) => currentIndex !== index));
                        else {
                          setMaterialImages((current) => current.filter(
                            (_, currentIndex) => currentIndex !== index,
                          ));
                        }
                      }}>
                      <InlineIcon name="close" />
                    </button>
                  </li>
                ))}
              </ul>}
              </div>
            )}

            <div className="amp-insight-create-action-buttons">
              <button type="button" className="amp-button amp-button-secondary amp-button-cancel"
                disabled={materialSaving}
                onClick={() => {
                  materialDialogRef.current?.close();
                  setMaterialImages([]);
                  setMaterialVideo(null);
                  setMaterialDocuments([]);
                  setCopyHtml("");
                  setCopyText("");
                }}>
                {t("取消", "Cancel")}
              </button>
              <button type="submit" className="amp-button amp-button-primary"
                disabled={materialSaving || (
                  materialUploadMode === "copy" && copyMode === "rich"
                    ? !copyText.trim()
                    : selectedMaterialFiles.length === 0
                )}>
                {materialUploadMode === "copy" && copyMode === "rich"
                  ? materialSaving ? t("添加中...", "Adding...") : t("添加", "Add")
                  : materialSaving ? t("上传中...", "Uploading...") : t("上传", "Upload")}
              </button>
            </div>
            </div>
          </form>
        </dialog>

        <dialog ref={inviteDialogRef} aria-labelledby="invite-project-member-title"
          className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
          onCancel={(event) => { if (inviting) event.preventDefault(); }}>
          <h2 id="invite-project-member-title" className="text-lg font-semibold">{t("邀请成员", "Invite member")}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {t(
              "只有项目成员可以访问项目。被邀请人必须是当前组织成员。",
              "Only project members can access this project. Invitees must be members of the current organization.",
            )}
          </p>
          <form onSubmit={inviteMember} className="mt-5 space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              {t("邮箱", "Email")}
              <input autoFocus type="email" value={inviteEmail} disabled={inviting}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder={t("请输入邮箱", "Enter email")}
                className="amp-workspace-control mt-2 w-full font-normal" />
            </label>
            <fieldset>
              <legend className="text-sm font-medium text-slate-700">{t("权限", "Permission")}</legend>
              <EnterpriseSelect
                value={inviteRole}
                options={roleOptions}
                onChange={setInviteRole}
                ariaLabel={t("邀请成员权限", "Invited member permission")}
                disabled={inviting}
                className="mt-2 w-full"
              />
            </fieldset>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={inviting}
                onClick={() => inviteDialogRef.current?.close()}>{t("取消", "Cancel")}</button>
              <button type="submit" className="amp-button amp-button-primary" disabled={inviting || !inviteEmail.trim()}>
                {inviting ? t("邀请中...", "Inviting...") : t("邀请", "Invite")}
              </button>
            </div>
          </form>
        </dialog>

        <dialog ref={accountDialogRef} aria-labelledby="bind-channel-account-title"
          className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-lg bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
          onClose={() => {
            if (!accountSaving) {
              setChoosingPlatform(true);
              setDeviceAuthorization(null);
              setDeviceQrCode("");
              setDeviceAuthorizationStatus("pending");
            }
          }}>
          <h2 id="bind-channel-account-title" className="text-lg font-semibold">
            {choosingPlatform
              ? t("选择渠道", "Choose a channel")
              : t("授权{channel}账号", "Authorize {channel} account", {
                channel: t(
                  MARKETING_CHANNELS.find((channel) => channel.key === bindingPlatform)!.zh,
                  MARKETING_CHANNELS.find((channel) => channel.key === bindingPlatform)!.en,
                ),
              })}
          </h2>
          {choosingPlatform ? (
            <>
              <div className="amp-project-channel-picker">
                {MARKETING_CHANNELS.map((channel) => (
                  <button key={channel.key} type="button" className="amp-project-channel-option"
                    onClick={() => {
                      setBindingPlatform(channel.key);
                      setChoosingPlatform(false);
                    }}>
                    <Image src={channel.logo} alt="" width={52} height={52} />
                    <span>
                      <strong>{t(channel.zh, channel.en)}</strong>
                      <small>{t(channel.detailZh, channel.detailEn)}</small>
                    </span>
                    <InlineIcon name="chevronRight" aria-hidden="true" />
                  </button>
                ))}
              </div>
              <div className="amp-project-channel-account-actions">
                <button type="button" className="amp-button amp-button-secondary amp-button-cancel"
                  onClick={() => accountDialogRef.current?.close()}>{t("取消", "Cancel")}</button>
              </div>
            </>
          ) : (
          <div className="amp-project-channel-authorization">
            <div className="amp-project-channel-selected">
              {(() => {
                const channel = MARKETING_CHANNELS.find((item) => item.key === bindingPlatform)!;
                return (
                  <>
                    <Image src={channel.logo} alt="" width={52} height={52} />
                    <div className="amp-project-channel-selected-copy">
                      {deviceAuthorization ? (
                        <strong>{t(channel.zh, channel.en)}</strong>
                      ) : (
                        <>
                          <strong>{t("通过平台完成安全授权", "Authorize securely through the platform")}</strong>
                          <p>{t(
                            bindingPlatform === "xiaohongshu"
                              ? "使用小红书扫码并确认授权，完成后账号会自动连接到当前项目。"
                              : "你将前往抖音完成身份验证，完成后自动返回当前项目。",
                            bindingPlatform === "xiaohongshu"
                              ? "Scan with Xiaohongshu and confirm. The account will then be connected to this project."
                              : "You will verify your identity on Douyin and return to this project automatically.",
                          )}</p>
                        </>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
            {deviceAuthorization ? (
              <>
                <div className="amp-project-channel-device">
                  {deviceQrCode && (
                    <Image src={deviceQrCode} alt={t("小红书授权二维码", "Xiaohongshu authorization QR code")}
                      width={224} height={224} unoptimized />
                  )}
                  <strong>
                    {deviceAuthorizationStatus === "scanned"
                      ? t("已扫码，请在小红书中确认授权", "Scanned. Confirm authorization in Xiaohongshu.")
                      : t("请使用小红书扫码授权", "Scan with Xiaohongshu to authorize")}
                  </strong>
                  {deviceAuthorization.userCode && (
                    <small>{t("授权码：{code}", "Authorization code: {code}", {
                      code: deviceAuthorization.userCode,
                    })}</small>
                  )}
                  <a href={deviceAuthorization.authorizationUrl} target="_blank" rel="noreferrer"
                    className="amp-project-channel-device-link">
                    {t("在小红书中打开", "Open in Xiaohongshu")}
                  </a>
                </div>
                <div className="amp-project-channel-account-actions">
                  <button type="button" className="amp-button amp-button-secondary"
                    onClick={() => {
                      setDeviceAuthorization(null);
                      setDeviceQrCode("");
                    }}>{t("返回", "Back")}</button>
                </div>
              </>
            ) : (
            <>
            <div className="amp-project-channel-permissions">
              <strong>{t("Marventa AI 将申请", "Marventa AI will request")}</strong>
              <ul>
                <li><InlineIcon name="check" />{t("识别已授权账号的公开身份", "Read the authorized account identity")}</li>
                <li><InlineIcon name="check" />{t(
                  "账号授权将在当前项目成员之间共享",
                  "Share the account authorization with members of this project",
                )}</li>
              </ul>
            </div>
            <div className="amp-project-channel-account-actions">
              <button type="button" className="amp-button amp-button-secondary" disabled={accountSaving}
                onClick={() => setChoosingPlatform(true)}>{t("返回", "Back")}</button>
              <button type="button" className="amp-button amp-button-primary"
                disabled={accountSaving} onClick={() => void authorizeChannelAccount()}>
                {accountSaving
                  ? t("正在打开授权页...", "Opening authorization...")
                  : t("前往平台授权", "Continue to platform")}
              </button>
            </div>
            </>
            )}
          </div>
          )}
        </dialog>

        <dialog ref={removeDialogRef} aria-labelledby="remove-project-member-title"
          className="amp-workspace-dialog m-auto w-[calc(100%_-_32px)] max-w-md bg-white p-6 text-slate-950 backdrop:bg-slate-950/40"
          onCancel={(event) => { if (inviting) event.preventDefault(); }}
          onClose={() => { if (!inviting) setMemberToRemove(null); }}>
          <h2 id="remove-project-member-title" className="text-lg font-semibold">{t("移出项目成员", "Remove project member")}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {t(
              "确定将「{name}」移出项目吗？该成员将失去此项目的访问权限。",
              "Remove {name} from the project? They will lose access to this project.",
              { name: memberToRemove?.nickname || memberToRemove?.username || "" },
            )}
          </p>
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" className="amp-button amp-button-secondary amp-button-cancel" disabled={inviting}
              onClick={() => removeDialogRef.current?.close()}>{t("取消", "Cancel")}</button>
            <button type="button" className="amp-button bg-red-600 text-white hover:bg-red-700" disabled={inviting || !memberToRemove}
              onClick={() => memberToRemove && void removeMember(memberToRemove)}>
              <InlineIcon name="trash" className="h-4 w-4" />
              {inviting ? t("移出中...", "Removing...") : t("确认移出", "Remove")}
            </button>
          </div>
        </dialog>

        <DeleteConfirmDialog
          open={Boolean(materialToDelete)}
          title={materialToDelete?.node_type === "collection"
            ? t("删除素材集", "Delete material set")
            : t("删除素材", "Delete material")}
          message={materialToDelete?.node_type === "collection"
            ? t(
              "删除素材集会同时删除其中的所有素材，且无法恢复。确认删除“{name}”吗？",
              "Deleting this material set also deletes every material inside it. Delete “{name}”?",
              { name: materialToDelete?.name || "" },
            )
            : t(
              "删除后将无法恢复，确认删除“{name}”吗？",
              "This cannot be undone. Delete “{name}”?",
              { name: materialToDelete?.name || "" },
            )}
          cancelLabel={t("取消", "Cancel")}
          confirmLabel={t("删除", "Delete")}
          busyLabel={t("删除中...", "Deleting...")}
          busy={materialSaving}
          onCancel={() => setMaterialToDelete(null)}
          onConfirm={() => void removeMaterial()}
        />
      </main>
    </div>
  );
}
