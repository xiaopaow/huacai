import { useState } from "react";
import { login } from "../lib/api";
import type { EmployeeAccount } from "../types/domain";

export default function LoginPage({ onLogin }: { onLogin: (user: EmployeeAccount) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      onLogin(await login(username, password));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="login-logo"><i /><i /><i /></div>
        <span>HUACAI · AMAZON OPERATIONS</span>
        <h1>把每一次商品生产，<br />变成可追踪的成果。</h1>
        <p>商品图片、Listing 与审核流程，在同一个内部工作台完成。</p>
        <div className="login-points">
          <span>✓ 商品生产流程统一管理</span>
          <span>✓ Amazon Listing 工作流</span>
          <span>✓ 角色权限与协作记录</span>
        </div>
      </section>
      <section className="login-panel">
        <form onSubmit={submit}>
          <span className="eyebrow">INTERNAL ACCESS</span>
          <h2>登录花彩工作台</h2>
          <p>请使用管理员分配的内部账号。</p>
          <label>用户名<input autoFocus autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /></label>
          {error && <div className="login-error">{error}</div>}
          <button className="primary-button" disabled={loading || !username || !password}>
            {loading ? "正在验证…" : "登录工作台"} <span>→</span>
          </button>
          <small>首次启动管理员账号为 admin，初始密码由服务器环境变量配置。</small>
        </form>
      </section>
    </main>
  );
}
