"use client";

import Image from "next/image";
import Link from "next/link";
import { useI18n } from "@/contexts/i18n_context";
import { API_BASE } from "@/services/api_core";
import { userAvatarColor, userAvatarInitial } from "@/utils/user_avatar";
import type { ContentProject } from "@/types/publishing";

export default function OpinionProjectCard({ project, accountCount }: {
  project: ContentProject;
  accountCount: number;
}) {
  const { t } = useI18n();
  const name = project.title || t("未命名项目", "Untitled project");
  return <article className="amp-project-card">
    <Link className="amp-project-card-open" href={`/opinion_tracking?project=${encodeURIComponent(project.id)}`}
      aria-label={t("查看项目 {name} 的监测总览", "View monitoring overview for {name}", { name })}>
      <span className="amp-project-avatar amp-project-custom-avatar"
        style={{ backgroundColor: project.avatar_color || "#bfdbfe" }}>
        <span className="amp-project-avatar-emoji">{project.avatar_icon || "💡"}</span>
      </span>
      <span className="amp-project-card-copy">
        <strong title={name}>{name}</strong>
        <span className="amp-project-card-description">{project.notes || t("暂无项目描述", "No project description")}</span>
        <span className="amp-project-card-members"
          aria-label={t("{count} 位项目成员", "{count} project members", { count: project.member_count })}>
          {project.members.slice(0, 4).map((member, index) => (
            <span key={member.user_id}
              className={`amp-project-card-member-avatar text-white ${member.avatar_url ? "" : userAvatarColor(member.user_id)}`}
              style={{ zIndex: project.members.length - index }} title={member.nickname || member.username}>
              {member.avatar_url ? <Image
                src={member.avatar_url.startsWith("http") ? member.avatar_url : `${API_BASE}${member.avatar_url}`}
                alt="" width={34} height={34} unoptimized />
                : userAvatarInitial(member.nickname || member.username)}
            </span>
          ))}
          {project.member_count > 4 && <span className="amp-project-card-member-avatar amp-project-card-member-more"
            title={t("更多成员", "More members")}>...</span>}
        </span>
        <span className="amp-project-card-meta">
          {t("{count} 个账号", "{count} accounts", { count: accountCount })}
          <span aria-hidden="true"> · </span>{t("监测总览", "Monitoring overview")}
        </span>
      </span>
    </Link>
  </article>;
}
