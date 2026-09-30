"use client";

import { useEffect } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useI18n } from "@/contexts/i18n_context";
import InlineIcon from "@/components/redesign/InlineIcon";

export default function MaterialRichTextEditor({
  content,
  disabled,
  onChange,
}: {
  content: string;
  disabled: boolean;
  onChange: (html: string, text: string) => void;
}) {
  const { t } = useI18n();
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
        <button type="button" disabled={disabled || !editor} aria-pressed={active?.heading}
          aria-label={t("标题", "Heading")} title={t("标题", "Heading")}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
          <InlineIcon name="heading" />
        </button>
        <button type="button" disabled={disabled || !editor} aria-pressed={active?.bold}
          aria-label={t("加粗", "Bold")} title={t("加粗", "Bold")}
          onClick={() => editor?.chain().focus().toggleBold().run()}>
          <InlineIcon name="bold" />
        </button>
        <button type="button" disabled={disabled || !editor} aria-pressed={active?.italic}
          aria-label={t("斜体", "Italic")} title={t("斜体", "Italic")}
          onClick={() => editor?.chain().focus().toggleItalic().run()}>
          <InlineIcon name="italic" />
        </button>
        <button type="button" disabled={disabled || !editor} aria-pressed={active?.underline}
          aria-label={t("下划线", "Underline")} title={t("下划线", "Underline")}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}>
          <InlineIcon name="underline" />
        </button>
        <button type="button" disabled={disabled || !editor} aria-pressed={active?.bulletList}
          aria-label={t("无序列表", "Bullet list")} title={t("无序列表", "Bullet list")}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}>
          <InlineIcon name="listBullet" />
        </button>
        <button type="button" disabled={disabled || !editor} aria-pressed={active?.orderedList}
          aria-label={t("有序列表", "Numbered list")} title={t("有序列表", "Numbered list")}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
          <InlineIcon name="listOrdered" />
        </button>
        <button type="button" disabled={disabled || !editor} aria-pressed={active?.blockquote}
          aria-label={t("引用", "Quote")} title={t("引用", "Quote")}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
          <InlineIcon name="quote" />
        </button>
        <button type="button" disabled={disabled || !active?.undo}
          aria-label={t("撤销", "Undo")} title={t("撤销", "Undo")}
          onClick={() => editor?.chain().focus().undo().run()}>
          <InlineIcon name="undo" />
        </button>
        <button type="button" disabled={disabled || !active?.redo}
          aria-label={t("重做", "Redo")} title={t("重做", "Redo")}
          onClick={() => editor?.chain().focus().redo().run()}>
          <InlineIcon name="redo" />
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
