import { useEffect, useState } from "react";
import {
  changeMyPassword,
  createDatabaseBackup,
  createEmployee,
  getDatabaseBackups,
  getEmployees,
  resetEmployeePassword,
  restoreDatabaseBackup,
  updateEmployee,
  type DatabaseBackup,
} from "../lib/api";
import type { EmployeeAccount } from "../types/domain";

function AccountSecurity({
  currentUser,
  notify,
  onPasswordChanged,
}: {
  currentUser: EmployeeAccount;
  notify: (message: string) => void;
  onPasswordChanged: (user: EmployeeAccount) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      notify("两次输入的新密码不一致");
      return;
    }
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      notify("新密码至少 10 位，并且同时包含字母和数字");
      return;
    }
    setSaving(true);
    try {
      const result = await changeMyPassword(currentPassword, newPassword);
      onPasswordChanged(result.user);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      notify("密码已更新，其他设备上的登录会话已退出");
    } catch (error) {
      notify(error instanceof Error ? error.message : "密码修改失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel security-panel">
      {currentUser.mustChangePassword && (
        <div className="password-required-banner">
          <span>!</span>
          <div><b>请先设置你自己的密码</b><p>这是首次登录或管理员刚刚重置了密码。完成修改后，才能进入其他业务页面。</p></div>
        </div>
      )}
      <div className="panel-head">
        <div><span className="eyebrow">ACCOUNT SECURITY</span><h3>账号安全</h3></div>
        <span className="security-status">● 已启用安全登录</span>
      </div>
      <div className="security-layout">
        <div className="security-account">
          <i>{currentUser.name[0]}</i>
          <div><b>{currentUser.name}</b><span>@{currentUser.username}</span></div>
          <small>{currentUser.department} · {currentUser.role}</small>
          <p>修改密码后，本设备会保持登录，其他设备会自动退出。</p>
        </div>
        <form className="security-form" onSubmit={submit}>
          <label>当前密码<input required type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
          <label>新密码<input required type="password" minLength={10} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
          <label>确认新密码<input required type="password" minLength={10} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
          <div className="security-form-foot">
            <span>至少 10 位，包含字母和数字</span>
            <button className="primary-button" disabled={saving}>{saving ? "正在保存…" : "更新密码"}</button>
          </div>
        </form>
      </div>
    </section>
  );
}

export default function SettingsPage({
  currentUser,
  notify,
  onUserUpdated,
}: {
  currentUser: EmployeeAccount;
  notify: (message: string) => void;
  onUserUpdated: (user: EmployeeAccount) => void;
}) {
  const [employees, setEmployees] = useState<EmployeeAccount[]>([]);
  const [backups, setBackups] = useState<DatabaseBackup[]>([]);
  const [backingUp, setBackingUp] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [resetTarget, setResetTarget] = useState<EmployeeAccount | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetting, setResetting] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<DatabaseBackup | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [form, setForm] = useState({
    username: "",
    password: "",
    name: "",
    department: "Amazon 运营",
    role: "运营" as EmployeeAccount["role"],
  });

  useEffect(() => {
    if (currentUser.role === "管理员" && !currentUser.mustChangePassword) {
      Promise.all([getEmployees(), getDatabaseBackups()])
        .then(([accounts, savedBackups]) => {
          setEmployees(accounts);
          setBackups(savedBackups);
        })
        .catch((error) => notify(error.message));
    }
  }, [currentUser.role, currentUser.mustChangePassword]);

  if (currentUser.role !== "管理员" || currentUser.mustChangePassword) {
    return (
      <div className="settings-stack">
        <AccountSecurity currentUser={currentUser} notify={notify} onPasswordChanged={onUserUpdated} />
      </div>
    );
  }

  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const employee = await createEmployee(form);
      setEmployees((current) => [...current, employee]);
      setShowForm(false);
      setForm({ username: "", password: "", name: "", department: "Amazon 运营", role: "运营" });
      notify("员工账号已创建");
    } catch (error) {
      notify(error instanceof Error ? error.message : "创建失败");
    }
  };

  const toggle = async (employee: EmployeeAccount) => {
    try {
      const updated = await updateEmployee(employee.id, { active: !employee.active });
      setEmployees((current) => current.map((item) => item.id === updated.id ? updated : item));
      notify(updated.active ? "账号已启用" : "账号已停用并注销全部会话");
    } catch (error) {
      notify(error instanceof Error ? error.message : "操作失败");
    }
  };

  const backupNow = async () => {
    if (backingUp) return;
    setBackingUp(true);
    try {
      const backup = await createDatabaseBackup();
      setBackups((current) => [backup, ...current]);
      notify("共享数据库备份已创建");
    } catch (error) {
      notify(error instanceof Error ? error.message : "备份创建失败");
    } finally {
      setBackingUp(false);
    }
  };

  const submitPasswordReset = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!resetTarget || resetting) return;
    if (resetPassword !== resetConfirm) {
      notify("两次输入的新密码不一致");
      return;
    }
    if (resetPassword.length < 10 || !/[A-Za-z]/.test(resetPassword) || !/\d/.test(resetPassword)) {
      notify("新密码至少 10 位，并且同时包含字母和数字");
      return;
    }
    setResetting(true);
    try {
      await resetEmployeePassword(resetTarget.id, resetPassword);
      notify(`${resetTarget.name} 的密码已重置，原有登录会话已全部退出`);
      setResetTarget(null);
      setResetPassword("");
      setResetConfirm("");
    } catch (error) {
      notify(error instanceof Error ? error.message : "密码重置失败");
    } finally {
      setResetting(false);
    }
  };

  const closePasswordReset = () => {
    if (resetting) return;
    setResetTarget(null);
    setResetPassword("");
    setResetConfirm("");
  };

  const restoreBackup = async () => {
    if (!restoreTarget || restoreConfirm !== "恢复" || restoring) return;
    setRestoring(true);
    try {
      const result = await restoreDatabaseBackup(restoreTarget.name);
      notify(result.assetsRestored ? "数据与图片已恢复，正在重新载入工作区" : "数据库已恢复；该旧备份不包含图片快照");
      window.setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      notify(error instanceof Error ? error.message : "备份恢复失败");
      setRestoring(false);
    }
  };

  return (
    <div className="settings-stack">
      <AccountSecurity currentUser={currentUser} notify={notify} onPasswordChanged={onUserUpdated} />
      <section className="panel account-admin">
      <div className="panel-head">
        <div><span className="eyebrow">ACCESS CONTROL</span><h3>员工账号与权限</h3></div>
        <button className="primary-button" onClick={() => setShowForm((value) => !value)}>＋ 新增员工</button>
      </div>
      {showForm && (
        <form className="employee-form" onSubmit={add}>
          <label>用户名<input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} /></label>
          <label>姓名<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>部门<input required value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} /></label>
          <label>角色<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as EmployeeAccount["role"] })}><option>运营</option><option>设计</option><option>审核</option><option>管理员</option></select></label>
          <label>初始密码<input required type="password" minLength={10} pattern="(?=.*[A-Za-z])(?=.*\d).{10,}" title="至少 10 位，并且同时包含字母和数字" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          <button className="primary-button">创建账号</button>
        </form>
      )}
      <div className="account-row account-header"><span>员工</span><span>用户名</span><span>部门</span><span>角色</span><span>状态</span><span>操作</span></div>
      {employees.map((employee) => (
        <div className="account-row" key={employee.id}>
          <span className="employee-cell"><i>{employee.name[0]}</i><b>{employee.name}</b></span>
          <code>{employee.username}</code>
          <span>{employee.department}</span>
          <select value={employee.role} disabled={employee.id === currentUser.id} onChange={async (event) => {
            const updated = await updateEmployee(employee.id, { role: event.target.value as EmployeeAccount["role"] });
            setEmployees((current) => current.map((item) => item.id === updated.id ? updated : item));
          }}><option>管理员</option><option>运营</option><option>设计</option><option>审核</option></select>
          <span className={`account-state ${employee.active ? "active" : ""}`}>{employee.active ? "启用" : "停用"}</span>
          <span className="account-actions">
            <button className="text-button" disabled={employee.id === currentUser.id} onClick={() => setResetTarget(employee)}>重置密码</button>
            <button className="secondary-button" disabled={employee.id === currentUser.id} onClick={() => toggle(employee)}>{employee.active ? "停用" : "启用"}</button>
          </span>
        </div>
      ))}
      </section>
      <section className="panel backup-admin">
        <div className="panel-head">
          <div><span className="eyebrow">DATA SAFETY</span><h3>共享数据库备份</h3></div>
          <button className="primary-button" disabled={backingUp} onClick={backupNow}>{backingUp ? "正在备份…" : "立即备份"}</button>
        </div>
        <p className="backup-note">系统每天自动保留一份本地备份；重大批量操作前建议手动创建快照。</p>
        <div className="backup-list">
          {backups.length ? backups.slice(0, 8).map((backup) => (
            <article key={backup.name}>
              <span>▤</span>
              <div><b>{new Date(backup.createdAt).toLocaleString("zh-CN")}</b><small>{backup.name} · {backup.assetsIncluded ? "含图片" : "仅数据库"}</small></div>
              <em>{Math.max(1, Math.round(backup.size / 1024))} KB</em>
              <button className="text-button" onClick={() => { setRestoreTarget(backup); setRestoreConfirm(""); }}>恢复</button>
            </article>
          )) : <div className="backup-empty">暂无备份，点击“立即备份”创建第一份快照。</div>}
        </div>
      </section>
      {resetTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closePasswordReset();
        }}>
          <form className="modal password-reset-dialog" onSubmit={submitPasswordReset}>
            <div className="modal-head">
              <div><span className="eyebrow">RESET PASSWORD</span><h3>重置员工密码</h3></div>
              <button type="button" aria-label="关闭" onClick={closePasswordReset}>×</button>
            </div>
            <div className="reset-employee">
              <i>{resetTarget.name[0]}</i>
              <div><b>{resetTarget.name}</b><span>@{resetTarget.username} · {resetTarget.role}</span></div>
            </div>
            <p className="reset-warning">保存后，该员工在所有设备上的登录会话都会立即退出，需要使用新密码重新登录。</p>
            <label>新密码<input autoFocus required type="password" minLength={10} pattern="(?=.*[A-Za-z])(?=.*\d).{10,}" title="至少 10 位，并且同时包含字母和数字" autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></label>
            <label>确认新密码<input required type="password" minLength={10} autoComplete="new-password" value={resetConfirm} onChange={(event) => setResetConfirm(event.target.value)} /></label>
            <small className="password-rule">至少 10 位，并且同时包含字母和数字</small>
            <div className="modal-actions">
              <button type="button" className="secondary-button" disabled={resetting} onClick={closePasswordReset}>取消</button>
              <button className="danger-button" disabled={resetting}>{resetting ? "正在重置…" : "确认重置密码"}</button>
            </div>
          </form>
        </div>
      )}
      {restoreTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !restoring) setRestoreTarget(null);
        }}>
          <section className="modal restore-dialog">
            <div className="restore-icon">↶</div>
            <span className="eyebrow">RESTORE SNAPSHOT</span>
            <h3>恢复这份工作区快照？</h3>
            <p>商品、任务、Listing、素材记录和通知将回到备份时状态。系统会先自动保存当前状态，账号与密码不会回滚。</p>
            {!restoreTarget.assetsIncluded && <div className="restore-warning">这是一份旧版备份，只包含数据库记录，不保证已删除的图片能够恢复。</div>}
            <label>输入“恢复”确认
              <input autoFocus value={restoreConfirm} onChange={(event) => setRestoreConfirm(event.target.value)} placeholder="恢复" />
            </label>
            <div className="modal-actions">
              <button className="secondary-button" disabled={restoring} onClick={() => setRestoreTarget(null)}>取消</button>
              <button className="danger-button" disabled={restoring || restoreConfirm !== "恢复"} onClick={restoreBackup}>{restoring ? "正在恢复…" : "确认恢复"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
