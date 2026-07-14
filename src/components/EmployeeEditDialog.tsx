import { useState } from "react";
import type { EmployeeAccount } from "../types/domain";

interface EmployeeEditDialogProps {
  employee: EmployeeAccount;
  isCurrentUser: boolean;
  onClose: () => void;
  onSave: (input: Pick<EmployeeAccount, "username" | "name" | "department" | "role">) => Promise<void>;
}

export default function EmployeeEditDialog({
  employee,
  isCurrentUser,
  onClose,
  onSave,
}: EmployeeEditDialogProps) {
  const [form, setForm] = useState({
    username: employee.username,
    name: employee.name,
    department: employee.department,
    role: employee.role,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(form);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "员工资料保存失败");
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => !saving && onClose()}>
      <form className="modal employee-edit-dialog" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><span className="eyebrow">EDIT EMPLOYEE</span><h3>编辑员工资料</h3></div>
          <button type="button" aria-label="关闭" disabled={saving} onClick={onClose}>×</button>
        </div>
        <div className="edit-employee-summary">
          <i>{employee.name[0]}</i>
          <div><b>{employee.name}</b><span>{employee.active ? "启用中" : "已停用"} · @{employee.username}</span></div>
        </div>
        <label>用户名
          <input
            required
            minLength={3}
            maxLength={40}
            pattern="[A-Za-z0-9._-]{3,40}"
            title="3–40 位字母、数字、点、下划线或短横线"
            autoComplete="off"
            value={form.username}
            onChange={(event) => setForm({ ...form, username: event.target.value })}
          />
          <small>修改后，员工下次登录需要使用新用户名。</small>
        </label>
        <div className="form-grid">
          <label>姓名<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>部门<input required value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} /></label>
        </div>
        <label>角色
          <select disabled={isCurrentUser} value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as EmployeeAccount["role"] })}>
            <option>管理员</option><option>运营</option><option>设计</option><option>审核</option>
          </select>
          {isCurrentUser && <small>不能在当前登录会话中移除自己的管理员角色。</small>}
        </label>
        {error && <div className="import-error" role="alert">! {error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" disabled={saving} onClick={onClose}>取消</button>
          <button className="primary-button" disabled={saving}>{saving ? "正在保存…" : "保存员工资料"}</button>
        </div>
      </form>
    </div>
  );
}
