import type { ReactNode, SVGProps } from "react";

export type InlineIconName =
  | "alert"
  | "arrowLeft"
  | "bell"
  | "bold"
  | "briefcase"
  | "case"
  | "calendar"
  | "chart"
  | "check"
  | "chevronRight"
  | "close"
  | "clock"
  | "collection"
  | "copy"
  | "download"
  | "edit"
  | "eye"
  | "eyeOff"
  | "file"
  | "folder"
  | "heading"
  | "heart"
  | "history"
  | "home"
  | "image"
  | "imageFile"
  | "insight"
  | "italic"
  | "listBullet"
  | "listOrdered"
  | "lock"
  | "mail"
  | "media"
  | "menu"
  | "message"
  | "moon"
  | "more"
  | "organization"
  | "panelLeftClose"
  | "panelLeftOpen"
  | "pen"
  | "portfolio"
  | "quote"
  | "redo"
  | "refresh"
  | "search"
  | "send"
  | "share"
  | "settings"
  | "sparkle"
  | "star"
  | "sun"
  | "trash"
  | "underline"
  | "undo"
  | "upload"
  | "user"
  | "video"
  | "videoFile"
  | "wand";

interface InlineIconProps extends SVGProps<SVGSVGElement> {
  name: InlineIconName;
  title?: string;
}

const paths: Record<InlineIconName, ReactNode> = {
  alert: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v4M12 17h.01" /></>,
  arrowLeft: <path d="m15 18-6-6 6-6" />,
  bold: <path strokeWidth="2.5" d="M6 12h8a4 4 0 0 1 0 8H6V4h7a4 4 0 0 1 0 8" />,
  heading: <path d="M5 4v16M19 4v16M5 12h14M3 4h4M17 4h4M3 20h4M17 20h4" />,
  italic: <path d="M11 4h9M4 20h9M16 4 8 20" />,
  listBullet: <><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" /></>,
  listOrdered: <><path d="M10 6h11M10 12h11M10 18h11" /><path strokeWidth="1.5" d="m3 4 2-1v6M3 9h4M3 15a2 2 0 0 1 4 0c0 1-1 2-4 5h4" /></>,
  quote: <path d="M10 5H3v7h6c0 3-2 5-5 6M21 5h-7v7h6c0 3-2 5-5 6" />,
  redo: <path d="m16 4 5 5-5 5M21 9H9a6 6 0 0 0 0 12h3" />,
  underline: <path d="M6 3v8a6 6 0 0 0 12 0V3M4 21h16" />,
  undo: <path d="m8 4-5 5 5 5M3 9h12a6 6 0 0 1 0 12h-3" />,
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-4 12a2 2 0 0 1-4 0" />,
  briefcase: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" /></>,
  case: <path d="M7 3.5h10A1.5 1.5 0 0 1 18.5 5v16L12 17l-6.5 4V5A1.5 1.5 0 0 1 7 3.5Z" />,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
  chart: <path d="M4 16.5 8.6 12l3.4 3.2 6.8-7.4M4 20h16" />,
  check: <path d="m5 12 4 4L19 6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  collection: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M5 17v4h14v-4" /></>,
  edit: <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3Zm11-12 3 3" />,
  eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /></>,
  eyeOff: <><path d="m3 3 18 18" /><path d="M10.6 10.6A2 2 0 0 0 13.4 13.4" /><path d="M9.5 5.4A10.7 10.7 0 0 1 12 5c6 0 9.5 7 9.5 7a16.8 16.8 0 0 1-2.1 3.1" /><path d="M6.2 6.8C3.8 8.4 2.5 12 2.5 12s3.5 7 9.5 7c1.4 0 2.7-.4 3.8-1" /></>,
  file: <><path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h4M9 13h6M9 17h5" /></>,
  folder: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" />,
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  home: <path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z" />,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m21 15-5-5L6 20" /></>,
  imageFile: <><path d="M6 2.5h7.5L19 8v13.5H6a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2Z" /><path d="M13.5 2.5V8H19" /><rect x="7" y="11" width="9" height="7" rx="1" /><circle cx="9.5" cy="13.5" r=".8" /><path d="m7 17 2.7-2.5 1.7 1.4 2-2 2.6 2.5" /></>,
  insight: <><path d="M8.6 15.5A7 7 0 1 1 15.4 15.5c-.9.7-1.4 1.5-1.4 2.5h-4c0-1-.5-1.8-1.4-2.5Z" /><path d="M9 18h6M10 22h4" /></>,
  lock: <path d="M7 10V8a5 5 0 0 1 10 0v2m-11 0h12v10H6V10Zm6 4v3" />,
  mail: <><path d="M3 5h18v14H3V5Z" /><path d="m4 7 8 6 8-6" /></>,
  media: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m10 8 6 4-6 4V8Z" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  message: <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />,
  moon: <path d="M20.8 15.1A9 9 0 0 1 8.9 3.2 9 9 0 1 0 20.8 15.1Z" />,
  more: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
  organization: <><path d="M5 21V5l7-2v18M12 8h7v13M3 21h18M8 7v1M8 11v1M8 15v1M15 12h1M15 16h1" /></>,
  panelLeftClose: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path d="m16 15-3-3 3-3" /></>,
  panelLeftOpen: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /><path d="m13 9 3 3-3 3" /></>,
  pen: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5Z" /><path d="m15 5 3 3" /></>,
  portfolio: <><path d="M3.75 7.5A2.25 2.25 0 0 1 6 5.25h4.15c.55 0 1.07.2 1.48.56l1.34 1.19H18a2.25 2.25 0 0 1 2.25 2.25v7.5A2.25 2.25 0 0 1 18 19H6a2.25 2.25 0 0 1-2.25-2.25V7.5Z" /><path d="M8 10.5h8M8 13.5h6M8 16.5h4" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.9-4M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14.9 4M20 20v-5h-5" /></>,
  search: <path d="m21 21-4.3-4.3M10.8 18a7.2 7.2 0 1 1 0-14.4 7.2 7.2 0 0 1 0 14.4Z" />,
  send: <><path d="m22 2-7 20-4-9-9-4 20-7Z" /><path d="M22 2 11 13" /></>,
  share: <><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" /></>,
  settings: <><path d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z" /><path d="M19.4 13.5c.1-.5.1-1 .1-1.5s0-1-.1-1.5l2-1.5-2-3.5-2.4 1a8.1 8.1 0 0 0-2.6-1.5L14 2h-4l-.4 2.5A8.1 8.1 0 0 0 7 6L4.6 5l-2 3.5 2 1.5c-.1.5-.1 1-.1 1.5s0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a8.1 8.1 0 0 0 2.6 1.5L10 22h4l.4-2.5A8.1 8.1 0 0 0 17 18l2.4 1 2-3.5-2-1.5Z" /></>,
  sparkle: <path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9L12 3Zm6 12 .7 2.3L21 18l-2.3.7L18 21l-.7-2.3L15 18l2.3-.7L18 15Z" />,
  star: <path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.2-5.6-2.9L6.4 20l1.1-6.2-4.6-4.4 6.3-.9L12 2.8Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  upload: <path d="M12 16V4m0 0 5 5m-5-5-5 5M5 20h14" />,
  user: <><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  video: <><rect x="3" y="6" width="13" height="12" rx="2" /><path d="m16 10 5-3v10l-5-3v-4Z" /></>,
  videoFile: <><path d="M6 2.5h7.5L19 8v13.5H6a2 2 0 0 1-2-2v-15a2 2 0 0 1 2-2Z" /><path d="M13.5 2.5V8H19" /><rect x="7" y="11" width="9" height="7" rx="1" /><path d="m10.5 13 3 1.5-3 1.5v-3Z" /></>,
  wand: <><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.21 1.21 0 0 0 1.72 0L21.64 5.36a1.21 1.21 0 0 0 0-1.72Z" /><path d="m14 7 3 3M5 6v4M3 8h4M19 14v4M17 16h4M10 2v2M9 3h2" /></>,
};

export default function InlineIcon({
  className = "",
  name,
  title,
  ...props
}: InlineIconProps) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      className={className}
      fill="none"
      focusable="false"
      role={title ? "img" : undefined}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      viewBox="0 0 24 24"
      {...props}
    >
      {title && <title>{title}</title>}
      {paths[name]}
    </svg>
  );
}
