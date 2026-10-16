import { App, Button, Form, Input, Tabs } from "antd";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function LoginPage() {
  const { user, login, register } = useAuth();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);

  if (user) return <Navigate to="/" replace />;

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>课题进度</h1>
        <p>个人科研进度云同步 · 记录 · 导出</p>
        <Tabs
          items={[
            {
              key: "login",
              label: "登录",
              children: (
                <Form
                  layout="vertical"
                  onFinish={async (values) => {
                    setLoading(true);
                    try {
                      await login(values.email, values.password);
                      message.success("登录成功");
                    } catch (err) {
                      message.error(
                        err instanceof Error ? err.message : "登录失败",
                      );
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  <Form.Item
                    name="email"
                    label="邮箱"
                    rules={[{ required: true, type: "email" }]}
                  >
                    <Input placeholder="demo@example.com" />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    label="密码"
                    rules={[{ required: true }]}
                  >
                    <Input.Password placeholder="demo123456" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={loading}>
                    登录
                  </Button>
                </Form>
              ),
            },
            {
              key: "register",
              label: "注册",
              children: (
                <Form
                  layout="vertical"
                  onFinish={async (values) => {
                    setLoading(true);
                    try {
                      await register(
                        values.email,
                        values.password,
                        values.displayName,
                      );
                      message.success("注册成功");
                    } catch (err) {
                      message.error(
                        err instanceof Error ? err.message : "注册失败",
                      );
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  <Form.Item name="displayName" label="昵称">
                    <Input placeholder="可选" />
                  </Form.Item>
                  <Form.Item
                    name="email"
                    label="邮箱"
                    rules={[{ required: true, type: "email" }]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    label="密码"
                    rules={[{ required: true, min: 6 }]}
                  >
                    <Input.Password />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={loading}>
                    注册
                  </Button>
                </Form>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
