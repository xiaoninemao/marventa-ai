"use client";

import { Fragment, type ReactNode } from "react";
import { useI18n } from "@/contexts/i18n_context";
import type { AgentProgress } from "@/types/content_generator";
import InlineIcon from "@/components/redesign/InlineIcon";

function inlineText(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(part);
    return link ? <a key={index} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a> : part;
  });
}

export function AgentText({ content }: { content: string }) {
  const blocks = content.split(/\n\s*\n/).filter(Boolean);
  return <div className="amp-agent-conversation-text">
    {blocks.map((block, index) => {
      const lines = block.split("\n");
      if (/^#{1,4}\s/.test(block)) return <h4 key={index}>{inlineText(block.replace(/^#{1,4}\s+/, ""))}</h4>;
      if (lines.every(line => /^[-*]\s+/.test(line))) return <ul key={index}>
        {lines.map((line, item) => <li key={item}>{inlineText(line.replace(/^[-*]\s+/, ""))}</li>)}
      </ul>;
      if (lines.every(line => /^\d+[.)]\s+/.test(line))) return <ol key={index}>
        {lines.map((line, item) => <li key={item}>{inlineText(line.replace(/^\d+[.)]\s+/, ""))}</li>)}
      </ol>;
      return <p key={index}>{inlineText(block)}</p>;
    })}
  </div>;
}

export default function AgentConversation({ events, finalReply = "", running = false }: {
  events: AgentProgress["events"]; finalReply?: string; running?: boolean;
}) {
  const { t } = useI18n();
  const sections: Record<string, string> = {
    brand: t("读取品牌规范", "Reading brand guidelines"),
    insights: t("读取市场洞察", "Reading market insights"),
    cases: t("读取案例", "Reading cases"),
    materials: t("读取素材", "Reading materials"),
    plans: t("读取创作方案", "Reading creation plans"),
    previous_deliverable: t("读取当前作品", "Reading the current work"),
  };
  const tools = {
    read_context: t("读取上下文", "Reading context"),
    list_materials: t("查找项目素材", "Finding project materials"),
    import_material: t("导入素材", "Importing material"),
    generate_image: t("生成图片", "Generating image"),
    compose_work: t("更新作品", "Updating work"),
  };
  let finalIndex = -1;
  events.forEach((event, index) => {
    if (event.type === "message" && finalReply && event.content.trim() === finalReply.trim()) finalIndex = index;
  });
  return <div className="amp-agent-conversation">
    {events.map((event, index) => {
      if (index === finalIndex) return null;
      if (event.type === "message") return <AgentText key={event.id || `message-${index}`} content={event.content} />;
      if (event.type === "status") return null;
      const active = event.status === "running" && running;
      const label = event.tool === "read_context" ? sections[event.section || ""] || tools.read_context : tools[event.tool];
      const details = event.details?.join(" · ");
      return <div key={event.id} className={`amp-agent-tool-activity${active ? " is-active" : ""}`}
        role={active ? "status" : undefined}>
        {active ? <span className="amp-agent-working-dot" aria-hidden="true" /> : <InlineIcon
          name={event.status === "failed" ? "alert" : event.status === "completed" ? "check" : "stop"} />}
        <span>{label}{details && <Fragment>：<span title={details}>{details}</span></Fragment>}</span>
      </div>;
    })}
    {finalReply && <AgentText content={finalReply} />}
  </div>;
}
