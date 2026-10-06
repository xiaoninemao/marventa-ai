"use client";

import Link from "next/link";
import Image from "next/image";
import { useI18n } from "@/contexts/i18n_context";
import { leadTrackingEntityHref } from "@/utils/lead_tracking";
import type { LeadTrackingEntity } from "@/utils/lead_tracking";

export default function LeadTrackingEntityCard({ entity, selectedProjectId = "" }: {
  entity: LeadTrackingEntity;
  selectedProjectId?: string;
}) {
  const { t } = useI18n();
  const channel = entity.platform === "douyin"
    ? { name: t("抖音", "Douyin"), logo: "/images/channels/douyin.jpg" }
    : { name: t("小红书", "Xiaohongshu"), logo: "/images/channels/xiaohongshu.jpg" };
  const projects = entity.bindings.map((binding) => binding.project_title);
  const projectNames = projects.join("、");
  return (
    <article className="amp-insight-card amp-lead-tracking-card">
      <Link href={leadTrackingEntityHref(entity, selectedProjectId)} className="amp-insight-card-link"
        aria-label={t("分析线索：{account}，项目：{projects}", "Analyze leads: {account}; projects: {projects}",
          { account: entity.account_name, projects: projectNames })}>
        <span className="amp-lead-tracking-logo" aria-hidden="true">
          <Image src={channel.logo} alt="" width={40} height={40} />
        </span>
        <span className="amp-lead-tracking-copy">
          <span className="amp-lead-tracking-name">
            <strong title={entity.account_name}>{entity.account_name}</strong>
          </span>
          <span className="amp-lead-tracking-context" title={`${channel.name} · ${projectNames}`}>
            {channel.name}<span aria-hidden="true">·</span>
            <span className="amp-lead-tracking-projects">{projectNames}</span>
          </span>
        </span>
      </Link>
    </article>
  );
}
