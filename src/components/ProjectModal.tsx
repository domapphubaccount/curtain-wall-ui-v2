import { useEffect, useState } from "react";
import { apiListUsers } from "../api";
import { uid, useStore } from "../store";
import type { Member, SystemUser } from "../types";
import { Modal } from "./common";

interface Props {
  mode: "create" | "settings";
  onClose: () => void;
}

function suggestKey(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const key = words.length === 1 ? words[0].slice(0, 4) : words.map((word) => word[0]).join("").slice(0, 5);
  return key.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export default function ProjectModal({ mode, onClose }: Props) {
  const { state, project, dispatch } = useStore();
  const editing = mode === "settings";
  const [name, setName] = useState(editing ? project.name : "");
  const [key, setKey] = useState(editing ? project.key : "");
  const [keyTouched, setKeyTouched] = useState(editing);
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState(() => new Set(editing ? project.members.map((member) => member.userId) : []));
  const [error, setError] = useState("");

  useEffect(() => {
    apiListUsers().then(setUsers).catch((requestError: Error) => setError(requestError.message));
  }, []);

  function toggleUser(userId: string) {
    setSelectedUserIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  function save() {
    if (!name.trim() || !key.trim()) return;
    const members: Member[] = users
      .filter((user) => user.active && selectedUserIds.has(user.id))
      .map((user) => {
        const existing = project.members.find((member) => member.userId === user.id);
        return {
          id: existing?.id ?? uid(),
          userId: user.id,
          name: user.name,
          role: user.jobTitle,
          email: user.email,
          color: user.color,
          invitedAt: existing?.invitedAt ?? new Date().toISOString(),
        };
      });
    if (editing) {
      dispatch({ type: "project/update", patch: { name: name.trim(), key: key.trim().toUpperCase(), members } });
    } else {
      dispatch({ type: "project/add", name: name.trim(), key: key.trim().toUpperCase(), members });
    }
    onClose();
  }

  return (
    <Modal title={editing ? "Project settings" : "New project"} onClose={onClose}>
      {error && <div className="form-error">{error}</div>}
      <div className="form-grid">
        <div className="form-field">
          <label>Project name</label>
          <input autoFocus={!editing} value={name} placeholder="e.g. Mobile App" onChange={(event) => {
            setName(event.target.value);
            if (!keyTouched) setKey(suggestKey(event.target.value));
          }} />
        </div>
        <div className="form-field">
          <label>Key (issue prefix)</label>
          <input value={key} placeholder="e.g. MOB" maxLength={6} onChange={(event) => {
            setKeyTouched(true);
            setKey(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
          }} />
        </div>
      </div>
      <div className="form-field">
        <label>Project team</label>
        <div className="user-check-list">
          {users.filter((user) => user.active).map((user) => (
            <label className="user-check-row" key={user.id}>
              <input type="checkbox" checked={selectedUserIds.has(user.id)} onChange={() => toggleUser(user.id)} />
              <span className="avatar" style={{ background: user.color }}>{user.name.slice(0, 2).toUpperCase()}</span>
              <span><strong>{user.name}</strong><small>{user.jobTitle} · {user.email}</small></span>
              {user.role === "ADMIN" && <span className="status-pill status-review">Admin</span>}
            </label>
          ))}
          {users.length === 0 && <p className="hint-text">Create company users from the Team page first.</p>}
        </div>
      </div>
      <div className="modal-actions">
        {editing && (
          <button className="btn btn-danger left" disabled={state.projects.length <= 1} onClick={() => {
            if (confirm(`Delete project "${project.name}" and all its items? This cannot be undone.`)) {
              dispatch({ type: "project/delete", id: project.id });
              onClose();
            }
          }}>Delete project</button>
        )}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!name.trim() || !key.trim()}>
          {editing ? "Save changes" : "Create project"}
        </button>
      </div>
    </Modal>
  );
}
