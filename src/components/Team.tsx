import { useEffect, useMemo, useState } from "react";
import { apiCreateUser, apiListUsers } from "../api";
import { useAuth } from "../auth";
import { MEMBER_COLORS } from "../data";
import { uid, useStore } from "../store";
import type { SystemRole, SystemUser } from "../types";
import { Modal } from "./common";

function initials(name: string): string {
  return name.split(" ").map((part) => part[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

export default function Team() {
  const { project, dispatch } = useStore();
  const { user } = useAuth();
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState("");
  const isAdmin = user?.role === "ADMIN";

  function refreshUsers() {
    if (!isAdmin) return;
    apiListUsers().then(setUsers).catch((requestError: Error) => setError(requestError.message));
  }

  useEffect(refreshUsers, [isAdmin]);

  return (
    <>
      <div className="view-header">
        <div><h1>Team</h1><div className="sub">People assigned to {project.name}.</div></div>
        {isAdmin && <div className="actions"><button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add user</button></div>}
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="panel team-list">
        <div className="team-row team-row-head"><span>Member</span><span>Role</span><span>Email</span><span>Access</span><span /></div>
        {project.members.map((member) => (
          <div className="team-row" key={member.id}>
            <div className="team-member-cell"><span className="avatar" style={{ background: member.color }}>{initials(member.name)}</span><strong>{member.name}</strong></div>
            <span>{member.role}</span>
            <span>{member.email}</span>
            <span className="status-pill status-done">Active</span>
            <div className="team-row-actions">
              {isAdmin && member.userId !== user?.id && (
                <button className="btn btn-sm btn-ghost" onClick={() => {
                  if (confirm(`Remove ${member.name} from this project? Their tasks will become unassigned.`)) {
                    dispatch({ type: "member/remove", id: member.id });
                  }
                }}>Remove</button>
              )}
            </div>
          </div>
        ))}
        {project.members.length === 0 && <div className="drop-hint">No users have been added to this project.</div>}
      </div>
      {showAdd && (
        <AddUserModal
          users={users}
          existingUserIds={new Set(project.members.map((member) => member.userId))}
          onAdded={(addedUser) => {
            dispatch({
              type: "member/add",
              member: {
                id: uid(), userId: addedUser.id, name: addedUser.name, role: addedUser.jobTitle,
                email: addedUser.email, color: addedUser.color, invitedAt: new Date().toISOString(),
              },
            });
            refreshUsers();
            setShowAdd(false);
          }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </>
  );
}

function AddUserModal({ users, existingUserIds, onAdded, onClose }: {
  users: SystemUser[];
  existingUserIds: Set<string>;
  onAdded(user: SystemUser): void;
  onClose(): void;
}) {
  const availableUsers = useMemo(() => users.filter((user) => user.active && !existingUserIds.has(user.id)), [users, existingUserIds]);
  const [mode, setMode] = useState<"existing" | "new">(availableUsers.length ? "existing" : "new");
  const [selectedId, setSelectedId] = useState(availableUsers[0]?.id ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<SystemRole>("USER");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setError("");
    if (mode === "existing") {
      const selected = availableUsers.find((user) => user.id === selectedId);
      if (selected) onAdded(selected);
      return;
    }
    if (!name.trim() || !email.trim() || password.length < 8) return;
    setSaving(true);
    try {
      const created = await apiCreateUser({
        name: name.trim(), email: email.trim(), password, jobTitle: jobTitle.trim() || "Team member",
        role, color: MEMBER_COLORS[users.length % MEMBER_COLORS.length],
      });
      onAdded(created);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create user");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add project user" onClose={onClose} narrow>
      <div className="mode-tabs">
        <button className={`btn btn-sm${mode === "existing" ? " btn-primary" : ""}`} onClick={() => setMode("existing")} disabled={!availableUsers.length}>Existing user</button>
        <button className={`btn btn-sm${mode === "new" ? " btn-primary" : ""}`} onClick={() => setMode("new")}>Create account</button>
      </div>
      {error && <div className="form-error">{error}</div>}
      {mode === "existing" ? (
        <div className="form-field"><label>Company user</label><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          {availableUsers.map((account) => <option value={account.id} key={account.id}>{account.name} — {account.email}</option>)}
        </select></div>
      ) : (
        <>
          <div className="form-field"><label>Name</label><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div className="form-field"><label>Email</label><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
          <div className="form-field"><label>Job title</label><input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} /></div>
          <div className="form-field"><label>Temporary password</label><input type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} /><small>At least 8 characters.</small></div>
          <div className="form-field"><label>System access</label><select value={role} onChange={(event) => setRole(event.target.value as SystemRole)}><option value="USER">Normal user</option><option value="ADMIN">Administrator</option></select></div>
        </>
      )}
      <div className="modal-actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => void submit()} disabled={saving || (mode === "existing" ? !selectedId : !name.trim() || !email.trim() || password.length < 8)}>{saving ? "Creating…" : mode === "existing" ? "Add to project" : "Create and add"}</button></div>
    </Modal>
  );
}
