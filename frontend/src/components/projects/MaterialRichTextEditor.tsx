"use client";

import { GuardedButton, useBlockedInteraction } from "@/components/redesign/GuardedControls";

import { useEffect } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useI18n } from "@/contexts/i18n_context";
import InlineIcon from "@/components/redesign/InlineIcon";

export default function MaterialRichTextEditor({
  content,
  disabled,
  blockedReason,
  onChange,
}: {
  content: string;
  disabled: boolean;
  blockedReason: string;
  onChange: (html: string, text: string) => void;
}) {
  const { t } = useI18n();
  const blockedInteraction = useBlockedInteraction(disabled, blockedReason);
  const editor = useEditor({
    extensions: [StarterKit.configure({
      heading: { levels: [2, 3] },
      code: false,
      codeBlock: false,
      horizontalRule: false,
      link: false,
    })],
    immediatelyRender: false,
    content,
    editable: !disabled,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": t("文案正文", "Copy content"),
        "aria-multiline": "true",
        "aria-readonly": String(disabled),
        tabindex: "0",
        class: "amp-material-rich-content",
      },
    },
    onCreate: ({ editor: created }) => onChange(created.getHTML(), created.getText()),
    onUpdate: ({ editor: updated }) => onChange(updated.getHTML(), updated.getText()),
  });
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold") ?? false,
      italic: current?.isActive("italic") ?? false,
      underline: current?.isActive("underline") ?? false,
      bulletList: current?.isActive("bulletList") ?? false,
      orderedList: current?.isActive("orderedList") ?? false,
      blockquote: current?.isActive("blockquote") ?? false,
      heading: current?.isActive("heading", { level: 2 }) ?? false,
      undo: current?.can().undo() ?? false,
      redo: current?.can().redo() ?? false,
    }),
  });

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  return (
    <div className="amp-material-rich-editor">
      <div className="amp-material-rich-toolbar" role="group" aria-label={t("文本格式", "Text formatting")}>
        <GuardedButton type="button" disabled={disabled || !editor} blockedReason={disabled ? blockedReason : t("编辑器正在初始化，请稍候。", "The editor is initializing.")} aria-pressed={active?.heading}
          aria-label={t("标题", "Heading")} title={t("标题", "Heading")}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
          <InlineIcon name="heading" />
        </GuardedButton>
        <GuardedButton type="button" disabled={disabled || !editor} blockedReason={disabled ? blockedReason : t("编辑器正在初始化，请稍候。", "The editor is initializing.")} aria-pressed={active?.bold}
          aria-label={t("加粗", "Bold")} title={t("加粗", "Bold")}
          onClick={() => editor?.chain().focus().toggleBold().run()}>
          <InlineIcon name="bold" />
        </GuardedButton>
        <GuardedButton type="button" disabled={disabled || !editor} blockedReason={disabled ? blockedReason : t("编辑器正在初始化，请稍候。", "The editor is initializing.")} aria-pressed={active?.italic}
          aria-label={t("斜体", "Italic")} title={t("斜体", "Italic")}
          onClick={() => editor?.chain().focus().toggleItalic().run()}>
          <InlineIcon name="italic" />
        </GuardedButton>
        <GuardedButton type="button" disabled={disabled || !editor} blockedReason={disabled ? blockedReason : t("编辑器正在初始化，请稍候。", "The editor is initializing.")} aria-pressed={active?.underline}
          aria-label={t("下划线", "Underline")} title={t("下划线", "Underline")}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}>
          <InlineIcon name="underline" />
        </GuardedButton>
        <GuardedButton type="button" disabled={disabled || !editor} blockedReason={disabled ? blockedReason : t("编辑器正在初始化，请稍候。", "The editor is initializing.")} aria-pressed={active?.bulletList}
          aria-label={t("无序列表", "Bullet list")} title={t("无序列表", "Bullet list")}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          <InlineIcon name="listBullet" />
        </GuardedButton>
        <GuardedButton type="button" disabled={disabled || !editor} blockedReason={disabled ? blockedReason : t("编辑器正在初始化，请稍候。", "The editor is initializing.")} aria-pressed={active?.orderedList}
          aria-label={t("有序列表", "Numbered list")} title={t("有序列表", "Numbered list")}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
          <InlineIcon name="listOrdered" />
        </GuardedButton>
        <GuardedButton type="button" disabled={disabled || !editor} blockedReason={disabled ? blockedReason : t("编辑器正在初始化，请稍候。", "The editor is initializing.")} aria-pressed={active?.blockquote}
          aria-label={t("引用", "Quote")} title={t("引用", "Quote")}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
          <InlineIcon name="quote" />
        </GuardedButton>
        <GuardedButton type="button" disabled={disabled || !active?.undo} blockedReason={disabled ? blockedReason : !editor ? t("编辑器正在初始化，请稍候。", "The editor is initializing.") : t("没有可以撤销的编辑。", "Nothing to undo.")}
          aria-label={t("撤销", "Undo")} title={t("撤销", "Undo")}
          onClick={() => editor?.chain().focus().undo().run()}>
          <InlineIcon name="undo" />
        </GuardedButton>
        <GuardedButton type="button" disabled={disabled || !active?.redo} blockedReason={disabled ? blockedReason : !editor ? t("编辑器正在初始化，请稍候。", "The editor is initializing.") : t("没有可以重做的编辑。", "Nothing to redo.")}
          aria-label={t("重做", "Redo")} title={t("重做", "Redo")}
          onClick={() => editor?.chain().focus().redo().run()}>
          <InlineIcon name="redo" />
        </GuardedButton>
      </div>
      <EditorContent editor={editor}
        data-blocked-action={disabled || undefined}
        onBeforeInputCapture={blockedInteraction.guard}
        onPasteCapture={blockedInteraction.guard}
        onCutCapture={blockedInteraction.guard}
        onDropCapture={blockedInteraction.guard}
        onKeyDownCapture={(event) => {
          const editShortcut = (event.ctrlKey || event.metaKey)
            && ["b", "i", "u", "z", "y", "x", "v"].includes(event.key.toLowerCase());
          if (editShortcut || (!event.ctrlKey && !event.metaKey && !event.altKey
            && (event.key.length === 1 || ["Enter", "Backspace", "Delete"].includes(event.key)))) {
            blockedInteraction.guard(event);
          }
        }} />
    </div>
  );
}
