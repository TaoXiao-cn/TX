import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { Button, Space, Upload } from "antd";
import {
  BoldOutlined,
  ItalicOutlined,
  OrderedListOutlined,
  UnorderedListOutlined,
  PictureOutlined,
} from "@ant-design/icons";

/** 空文档常量：避免父组件每次 render 传入新对象字面量 */
export const EMPTY_DOC = {
  type: "doc",
  content: [{ type: "paragraph" }],
} as const;

type Props = {
  /** 仅在挂载时作为初始内容；切换条目请用 key 强制重挂载，勿在输入时改写 */
  initialJson?: unknown;
  placeholder?: string;
  onChange?: (json: unknown, html: string) => void;
  onUploadImage?: (file: File) => Promise<string | null>;
};

export function RichEditor({
  initialJson,
  placeholder = "记录今天的进展…",
  onChange,
  onUploadImage,
}: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
    ],
    // 初始内容只读一次；父级 onChange → setState 不得再 setContent，否则会清空刚输入的字
    content: (initialJson as object) || EMPTY_DOC,
    onUpdate: ({ editor: ed }) => {
      onChange?.(ed.getJSON(), ed.getHTML());
    },
  });

  if (!editor) return null;

  return (
    <div className="editor-shell">
      <div className="editor-toolbar">
        <Space wrap size={4}>
          <Button
            size="small"
            type={editor.isActive("bold") ? "primary" : "default"}
            icon={<BoldOutlined />}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <Button
            size="small"
            type={editor.isActive("italic") ? "primary" : "default"}
            icon={<ItalicOutlined />}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <Button
            size="small"
            type={editor.isActive("bulletList") ? "primary" : "default"}
            icon={<UnorderedListOutlined />}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <Button
            size="small"
            type={editor.isActive("orderedList") ? "primary" : "default"}
            icon={<OrderedListOutlined />}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <Upload
            showUploadList={false}
            accept="image/*"
            beforeUpload={async (file) => {
              if (onUploadImage) {
                const url = await onUploadImage(file);
                if (url) {
                  editor.chain().focus().setImage({ src: url }).run();
                }
              } else {
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result === "string") {
                    editor
                      .chain()
                      .focus()
                      .setImage({ src: reader.result })
                      .run();
                  }
                };
                reader.readAsDataURL(file);
              }
              return false;
            }}
          >
            <Button size="small" icon={<PictureOutlined />}>
              图片
            </Button>
          </Upload>
        </Space>
      </div>
      <div className="editor-body">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export function getEditorSnapshot(editorJson: unknown, editorHtml: string) {
  return { contentJson: editorJson, contentHtml: editorHtml };
}
