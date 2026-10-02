import type { Translate } from "@/i18n/locale";
import type { ContentCard } from "@/types/content_generator";

type DetailProfile = {
  format: string;
  core: string;
  platforms: string;
  tone: string;
};

type ContentFormat = "short_video" | "image_text";

const FIXED_DISPLAY_TITLES: Record<Exclude<ContentCard["card_type"], "script">, readonly [string, string]> = {
  title: ["标题文案", "Headline options"],
  copy: ["发布文案", "Post copy"],
  hashtags: ["话题标签", "Hashtags"],
  visual: ["视觉方案", "Visual plan"],
};

export function get_card_display_title(
  card: Pick<ContentCard, "card_type" | "title">,
  t: Translate,
): string {
  const normalized = card.title.trim().toLowerCase();
  const titles = card.card_type === "script"
    ? normalized === "视频分镜脚本" || normalized === "video storyboard"
      ? ["视频分镜脚本", "Video storyboard"] as const
      : ["图文发布计划", "Image-text publishing plan"] as const
    : FIXED_DISPLAY_TITLES[card.card_type];
  if (!titles || !titles.some((title) => title.toLowerCase() === normalized)) return card.title;
  return t(titles[0], titles[1]);
}

export function get_card_content_format(card: ContentCard): ContentFormat {
  const title = card.title.trim().toLowerCase();
  if (title === "视频分镜脚本" || title === "video storyboard") return "short_video";
  if (title === "图文发布计划" || title === "image-text publishing plan") return "image_text";
  const evidence = `${card.title}\n${card.preview}\n${card.content}`.toLowerCase();
  const videoTerms = [
    "短视频", "分镜", "镜头", "口播", "时长", "前3秒",
    "short video", "storyboard", "voiceover", "shot list", "video script",
  ];
  const imageTextTerms = [
    "图文", "图片", "正文", "排版", "封面图", "小红书",
    "image-text", "carousel", "post copy", "cover image",
  ];
  const videoScore = videoTerms.reduce((score, term) => score + evidence.split(term).length - 1, 0);
  const imageTextScore = imageTextTerms.reduce((score, term) => score + evidence.split(term).length - 1, 0);
  return videoScore > imageTextScore ? "short_video" : "image_text";
}

export const get_card_detail_profile = (
  t: Translate,
  contentFormat: ContentFormat = "image_text",
): Record<ContentCard["card_type"], DetailProfile> => ({
  title: {
    format: t("图文方案", "Image post plan"),
    core: t("痛点切入 → 卖点承接 → 信任建立 → 行动号召", "Pain point → Selling point → Build trust → Call to action"),
    platforms: t("小红书、公众号、微博、抖音图文", "Xiaohongshu, WeChat Official Accounts, Weibo, Douyin image posts"),
    tone: t("真诚自然、利益明确、轻转化导向", "Authentic and natural, clear benefits, gentle conversion focus"),
  },
  script: contentFormat === "short_video"
    ? {
        format: t("视频方案", "Video plan"),
        core: t("开场钩子 → 分镜推进 → 字幕文案 → 产品露出 → 行动号召", "Opening hook → Storyboard → Captions → Product placement → Call to action"),
        platforms: t("抖音、快手、视频号、B站", "Douyin, Kuaishou, WeChat Channels, Bilibili"),
        tone: t("节奏清晰、画面感强、口语化转化", "Clear pacing, vivid imagery, conversational conversion"),
      }
    : {
        format: t("图文方案", "Image post plan"),
        core: t("封面钩子 → 图片顺序 → 图文正文 → 卖点展开 → 互动引导", "Cover hook → Image sequence → Post copy → Selling points → Engagement prompt"),
        platforms: t("小红书、公众号、微博、抖音图文", "Xiaohongshu, WeChat Official Accounts, Weibo, Douyin image posts"),
        tone: t("信息清晰、视觉连贯、适合阅读停留", "Clear information, coherent visuals, designed for engaged reading"),
      },
  copy: {
    format: t("图文方案", "Image post plan"),
    core: t("用户场景 → 问题放大 → 方案说明 → 体验证明 → 转化提示", "User scenario → Highlight the problem → Explain the solution → Show results → Conversion prompt"),
    platforms: t("小红书、公众号、微博", "Xiaohongshu, WeChat Official Accounts, Weibo"),
    tone: t("专业可信、细节充分、适合阅读停留", "Professional and credible, detailed, designed for engaged reading"),
  },
  hashtags: {
    format: t("话题组合", "Hashtag set"),
    core: t("核心品类词 → 场景需求词 → 功效卖点词 → 人群转化词", "Core category → Scenario needs → Benefits → Audience conversion"),
    platforms: t("小红书、微博、抖音图文", "Xiaohongshu, Weibo, Douyin image posts"),
    tone: t("搜索友好、分类明确、兼顾曝光与转化", "Search-friendly, clearly categorized, balancing reach and conversion"),
  },
  visual: {
    format: t("封面视觉方案", "Cover visual plan"),
    core: t("第一视觉锚点 → 信息主标题 → 产品/场景证明 → 点击理由", "Visual focal point → Main headline → Product/scenario evidence → Reason to click"),
    platforms: t("小红书、抖音图文、公众号封面、微博", "Xiaohongshu, Douyin image posts, WeChat covers, Weibo"),
    tone: t("清爽正式、重点突出、便于快速识别", "Clean and professional, focused, easy to recognize"),
  },
});

export function get_card_preview_content(card: ContentCard): string {
  if (card.content.trim()) return card.content;
  return card.preview.trim() ? card.preview : "";
}
