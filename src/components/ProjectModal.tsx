import { useState } from "react";
import { uid, useStore } from "../store";
import { MEMBER_COLORS } from "../data";
import { Modal } from "./common";
import type { Member } from "../types";

interface Props {
  mode: "create" | "settings";
  onClose: () => void;
}

function suggestKey(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const key = words.length === 1 ? words[0].slice(0, 4) : words.map((w) => w[0]).join("").slice(0, 5);
  return key.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export default function ProjectModal({ mode, onClose }: Props) {
  const { state, project, dispatch } = useStore();
  const editing = mode === "settings";

  const [name, setName] = useState(editing ? project.name : "");
  const [key, setKey] = useState(editing ? project.key : "");
  const [keyTouched, setKeyTouched] = useState(editing);
  const [members, setMembers] = useState<Member[]>(editing ? project.members : []);

  function addMember() {
    setMembers([
      ...members,
      { id: uid(), name: "", role: "", email: "", color: MEMBER_COLORS[members.length % MEMBER_COLORS.length], invitedAt: null },
    ]);
  }

  function patchMember(id: string, patch: Partial<Member>) {
    setMembers(members.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function save() {
    const cleanMembers = members
      .map((m) => ({ ...m, name: m.name.trim(), role: m.role.trim() || "Team member" }))
      .filter((m) => m.name);
    if (!name.trim() || !key.trim()) return;
    if (editing) {
      dispatch({
        type: "project/update",
        patch: { name: name.trim(), key: key.trim().toUpperCase(), members: cleanMembers },
      });
    } else {
      dispatch({
        type: "project/add",
        name: name.trim(),
        key: key.trim().toUpperCase(),
        members: cleanMembers,
      });
    }
    onClose();
  }

  return (
    <Modal title={editing ? "Project settings" : "New project"} onClose={onClose}>
      <div className="form-grid">
        <div className="form-field">
          <label>Project name</label>
          <input
            autoFocus={!editing}
            value={name}
            placeholder="e.g. Mobile App"
            onChange={(e) => {
              setName(e.target.value);
              if (!keyTouched) setKey(suggestKey(e.target.value));
            }}
          />
        </div>
        <div className="form-field">
          <label>Key (issue prefix)</label>
          <input
            value={key}
            placeholder="e.g. MOB"
            maxLength={6}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""));
            }}
          />
        </div>
      </div>
      <div className="form-field">
        <label>Team</label>
        <div className="ac-list">
          {members.map((m) => (
            <div className="ac-item" key={m.id}>
              <span className="avatar" style={{ background: m.color }}>
                {m.name
                  .split(" ")
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join("") || "?"}
              </span>
              <input
                type="text"
                value={m.name}
                placeholder="Name"
                onChange={(e) => patchMember(m.id, { name: e.target.value })}
              />
              <input
                type="text"
                value={m.role}
                placeholder="Role (e.g. Frontend Dev)"
                onChange={(e) => patchMember(m.id, { role: e.target.value })}
              />
              <button
                className="remove"
                title="Remove member"
                onClick={() => setMembers(members.filter((x) => x.id !== m.id))}
              >
                ✕
              </button>
            </div>
          ))}
          <div>
            <button className="btn btn-sm" onClick={addMember}>+ Add member</button>
          </div>
        </div>
      </div>
      <div className="modal-actions">
        {editing && (
          <button
            className="btn btn-danger left"
            disabled={state.projects.length <= 1}
            title={state.projects.length <= 1 ? "You need at least one project" : undefined}
            onClick={() => {
              if (
                confirm(
                  `Delete project "${project.name}" and all its items? This cannot be undone.`
                )
              ) {
                dispatch({ type: "project/delete", id: project.id });
                onClose();
              }
            }}
          >
            Delete project
          </button>
        )}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={!name.trim() || !key.trim()}>
          {editing ? "Save changes" : "Create project"}
        </button>
      </div>
    </Modal>
  );
}
