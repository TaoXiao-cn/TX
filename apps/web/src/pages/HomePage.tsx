import {
  App,
  Button,
  Dropdown,
  Empty,
  Input,
  Select,
  Space,
  Typography,
} from "antd";
import {
  ExportOutlined,
  LogoutOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import dayjs from "dayjs";
import { api, type ProgressEntry, type Project } from "../api/client";
import { useAuth } from "../lib/auth";
import { RichEditor } from "../components/RichEditor";

function dayKey(iso: string) {
  return dayjs(iso).format("YYYY-MM-DD");
}

export function HomePage() {
  const { user, logout, loading } = useAuth();
  const { message, modal } = App.useApp();
  const [projects, setProjects] = useState<Project[]>([]);
  const [filter, setFilter] = useState<"active" | "archived">("active");
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [entries, setEntries] = useState<ProgressEntry[]>([]);
  const [draftJson, setDraftJson] = useState<unknown>({
    type: "doc",
    content: [{ type: "paragraph" }],
  });
  const [draftHtml, setDraftHtml] = useState("<p></p>");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<ProgressEntry | null>(null);

  const current = useMemo(
    () => projects.find((p) => p.id === currentId) ?? null,
    [projects, currentId],
  );

  const loadProjects = useCallback(async () => {
    const res = await api.listProjects(filter);
    setProjects(res.projects);
    setCurrentId((prev) => {
      if (prev && res.projects.some((p) => p.id === prev)) return prev;
      return res.projects[0]?.id ?? null;
    });
  }, [filter]);

  const loadEntries = useCallback(async (projectId: string) => {
    const res = await api.listEntries(projectId);
    setEntries(res.entries);
  }, []);

  useEffect(() => {
    if (!user) return;
    loadProjects().catch((err) =>
      message.error(err instanceof Error ? err.message : "加载课题失败"),
    );
  }, [user, loadProjects, message]);

  useEffect(() => {
    if (!currentId) {
      setEntries([]);
      return;
    }
    loadEntries(currentId).catch((err) =>
      message.error(err instanceof Error ? err.message : "加载进度失败"),
    );
  }, [currentId, loadEntries, message]);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  const grouped = entries.reduce<
    { day: string; items: ProgressEntry[] }[]
  >((acc, entry) => {
    const day = dayKey(entry.createdAt);
    const last = acc[acc.length - 1];
    if (last && last.day === day) last.items.push(entry);
    else acc.push({ day, items: [entry] });
    return acc;
  }, []);

  async function createProject() {
    let title = "";
    modal.confirm({
      title: "新建课题",
      content: (
        <Input
          placeholder="课题名称"
          onChange={(e) => {
            title = e.target.value;
          }}
        />
      ),
      okText: "创建",
      cancelText: "取消",
      onOk: async () => {
        if (!title.trim()) {
          message.warning("请输入课题名称");
          throw new Error("empty");
        }
        const res = await api.createProject(title.trim());
        message.success("已创建");
        setFilter("active");
        await loadProjects();
        setCurrentId(res.project.id);
      },
    });
  }

  async function renameProject() {
    if (!current) return;
    let title = current.title;
    modal.confirm({
      title: "重命名课题",
      content: (
        <Input
          defaultValue={current.title}
          onChange={(e) => {
            title = e.target.value;
          }}
        />
      ),
      okText: "保存",
      cancelText: "取消",
      onOk: async () => {
        if (!title.trim()) throw new Error("empty");
        await api.updateProject(current.id, { title: title.trim() });
        message.success("已重命名");
        await loadProjects();
      },
    });
  }

  async function archiveProject() {
    if (!current) return;
    await api.updateProject(current.id, {
      status: current.status === "active" ? "archived" : "active",
    });
    message.success(
      current.status === "active" ? "已归档" : "已恢复为进行中",
    );
    await loadProjects();
  }

  async function saveEntry() {
    if (!currentId) return;
    setSaving(true);
    try {
      if (editing) {
        await api.updateEntry(editing.id, draftJson, draftHtml);
        message.success("已更新（创建时间不变）");
        setEditing(null);
      } else {
        await api.createEntry(currentId, draftJson, draftHtml);
        message.success("已添加进度");
      }
      setDraftJson({ type: "doc", content: [{ type: "paragraph" }] });
      setDraftHtml("<p></p>");
      await loadEntries(currentId);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function attachToEntry(entryId: string, file: File) {
    try {
      await api.uploadAttachment(entryId, file);
      message.success("附件已上传");
      if (currentId) await loadEntries(currentId);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "上传失败");
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">课题进度</div>
        <div style={{ color: "#5d7a6d", fontSize: 13 }}>
          {user.displayName || user.email}
        </div>
        <Space style={{ width: "100%" }} direction="vertical">
          <Select
            value={filter}
            onChange={setFilter}
            style={{ width: "100%" }}
            options={[
              { value: "active", label: "进行中" },
              { value: "archived", label: "已归档" },
            ]}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            block
            onClick={createProject}
          >
            新建课题
          </Button>
        </Space>
        <div style={{ flex: 1, overflow: "auto", marginTop: 8 }}>
          {projects.length === 0 ? (
            <Empty description="暂无课题" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setCurrentId(p.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  border:
                    p.id === currentId
                      ? "1px solid #1f6f5b"
                      : "1px solid transparent",
                  background: p.id === currentId ? "#e7f3ee" : "transparent",
                  borderRadius: 10,
                  padding: "10px 12px",
                  marginBottom: 6,
                  cursor: "pointer",
                  color: "inherit",
                }}
              >
                <div style={{ fontWeight: 600 }}>{p.title}</div>
                <div style={{ fontSize: 12, color: "#688478" }}>
                  {dayjs(p.updatedAt).format("YYYY-MM-DD HH:mm")}
                </div>
              </button>
            ))
          )}
        </div>
        <Button icon={<LogoutOutlined />} onClick={logout} block>
          退出登录
        </Button>
      </aside>

      <main className="main-pane">
        {!current ? (
          <Empty description="创建或选择一个课题开始记录" />
        ) : (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 16,
                alignItems: "flex-start",
                marginBottom: 20,
              }}
            >
              <div>
                <Typography.Title level={2} style={{ margin: 0 }}>
                  {current.title}
                </Typography.Title>
                <Typography.Paragraph type="secondary" style={{ marginTop: 6 }}>
                  {current.description || "记录研究进展，按时间轴浏览与导出"}
                </Typography.Paragraph>
              </div>
              <Space wrap>
                <Button onClick={renameProject}>重命名</Button>
                <Button onClick={archiveProject}>
                  {current.status === "active" ? "归档" : "取消归档"}
                </Button>
                <Dropdown
                  menu={{
                    items: [
                      {
                        key: "md",
                        label: "导出 Markdown",
                        onClick: () =>
                          api
                            .downloadExport(current.id, "md")
                            .catch(() => message.error("导出失败")),
                      },
                      {
                        key: "docx",
                        label: "导出 DOCX",
                        onClick: () =>
                          api
                            .downloadExport(current.id, "docx")
                            .catch(() => message.error("导出失败")),
                      },
                      {
                        key: "pdf",
                        label: "导出 PDF",
                        onClick: () =>
                          api
                            .downloadExport(current.id, "pdf")
                            .catch(() => message.error("导出失败")),
                      },
                    ],
                  }}
                >
                  <Button type="primary" icon={<ExportOutlined />}>
                    导出
                  </Button>
                </Dropdown>
              </Space>
            </div>

            <div className="entry-card" style={{ marginBottom: 24 }}>
              <Typography.Text strong>
                {editing ? "编辑进度" : "写一条新进度"}
              </Typography.Text>
              <div style={{ marginTop: 10 }}>
                <RichEditor
                  key={editing?.id ?? "new"}
                  initialJson={
                    editing?.contentJson ?? {
                      type: "doc",
                      content: [{ type: "paragraph" }],
                    }
                  }
                  onChange={(json, html) => {
                    setDraftJson(json);
                    setDraftHtml(html);
                  }}
                />
              </div>
              <Space style={{ marginTop: 12 }}>
                <Button type="primary" loading={saving} onClick={saveEntry}>
                  {editing ? "保存修改" : "发布进度"}
                </Button>
                {editing && (
                  <Button
                    onClick={() => {
                      setEditing(null);
                      setDraftJson({
                        type: "doc",
                        content: [{ type: "paragraph" }],
                      });
                      setDraftHtml("<p></p>");
                    }}
                  >
                    取消编辑
                  </Button>
                )}
              </Space>
            </div>

            <div className="timeline">
              {grouped.length === 0 ? (
                <Empty description="还没有进度条目" />
              ) : (
                grouped.map((group) => (
                  <div key={group.day}>
                    <div className="day-sep">
                      {dayjs(group.day).format("YYYY年M月D日")}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                        marginTop: 12,
                      }}
                    >
                      {group.items.map((entry) => (
                        <div className="entry-card" key={entry.id}>
                          <div className="entry-meta">
                            <span>
                              创建于{" "}
                              {dayjs(entry.createdAt).format("HH:mm:ss")}
                              {entry.updatedAt !== entry.createdAt &&
                                ` · 编辑于 ${dayjs(entry.updatedAt).format("YYYY-MM-DD HH:mm")}`}
                            </span>
                            <Space size="small">
                              <Button
                                size="small"
                                type="link"
                                onClick={() => {
                                  setEditing(entry);
                                  setDraftJson(entry.contentJson);
                                  setDraftHtml(entry.contentHtml);
                                  window.scrollTo({ top: 0, behavior: "smooth" });
                                }}
                              >
                                编辑
                              </Button>
                              <Button
                                size="small"
                                type="link"
                                onClick={() => {
                                  const input = document.createElement("input");
                                  input.type = "file";
                                  input.onchange = () => {
                                    const file = input.files?.[0];
                                    if (file) void attachToEntry(entry.id, file);
                                  };
                                  input.click();
                                }}
                              >
                                附件
                              </Button>
                              <Button
                                size="small"
                                type="link"
                                danger
                                onClick={() => {
                                  modal.confirm({
                                    title: "删除这条进度？",
                                    okText: "删除",
                                    okButtonProps: { danger: true },
                                    cancelText: "取消",
                                    onOk: async () => {
                                      await api.deleteEntry(entry.id);
                                      message.success("已删除");
                                      if (currentId) await loadEntries(currentId);
                                    },
                                  });
                                }}
                              >
                                删除
                              </Button>
                            </Space>
                          </div>
                          <div
                            dangerouslySetInnerHTML={{
                              __html: entry.contentHtml || "<p>（空内容）</p>",
                            }}
                          />
                          {entry.attachments.length > 0 && (
                            <div className="attachment-list">
                              {entry.attachments.map((a) =>
                                a.mimeType.startsWith("image/") ? (
                                  <a
                                    key={a.id}
                                    className="attachment-chip"
                                    href={a.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    <img src={a.url} alt={a.fileName} />
                                    <span>{a.fileName}</span>
                                  </a>
                                ) : (
                                  <a
                                    key={a.id}
                                    className="attachment-chip"
                                    href={a.url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {a.fileName}
                                  </a>
                                ),
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
