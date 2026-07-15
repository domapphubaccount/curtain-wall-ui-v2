import { useState } from "react";
import { useStore } from "../store";
import { Modal } from "./common";
import type { Member } from "../types";

function initials(name: string): string {
  return name.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function inviteMailto(member: Member, projectName: string): string {
  const subject = encodeURIComponent(`You're invited to ${projectName} on SprintForge`);
  const body = encodeURIComponent(
    `Hi ${member.name || "there"},\n\n` +
      `You've been added to the "${projectName}" project on SprintForge as ${member.role || "a team member"}.\n\n` +
      `SprintForge is a working prototype with no server behind it yet, so there's no real sign-in link to include here — ` +
      `once it's connected to a backend, this invite will carry a real "create your account" link.\n\n` +
      `— Sent from SprintForge`
  );
  return `mailto:${encodeURIComponent(member.email)}?subject=${subject}&body=${body}`;
}

export default function Team() {
  const { project } = useStore();
  const [showAdd, setShowAdd] = useState(false);

  return (
    <>
      <div className="view-header">
        <div>
          <h1>Team</h1>
          <div className="sub">Manage who's on {project.name} and invite new teammates by email.</div>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add team member</button>
        </div>
      </div>

      <div className="panel team-notice">
        ✉ SprintForge runs entirely in your browser — there's no server to send real email or create sign-ins yet.
        "Send invite" opens a pre-written message in your own email app instead.
      </div>

      <div className="panel team-list">
        <div className="team-row team-row-head">
          <span>Member</span>
          <span>Role</span>
          <span>Email</span>
          <span>Status</span>
          <span />
        </div>
        {project.members.map((m) => (
          <TeamRow key={m.id} member={m} />
        ))}
        {project.members.length === 0 && (
          <div className="drop-hint">No team members yet — add your first one above.</div>
        )}
      </div>

      {showAdd && <AddMemberModal onClose={() => setShowAdd(false)} />}
    </>
  );
}

function TeamRow({ member }: { member: Member }) {
  const { project, dispatch } = useStore();

  function update(patch: Partial<Member>) {
    dispatch({ type: "member/update", id: member.id, patch });
  }

  const hasEmail = member.email.trim().length > 0;

  return (
    <div className="team-row">
      <div className="team-member-cell">
        <span className="avatar" style={{ background: member.color }}>{initials(member.name)}</span>
        <input
          className="team-inline-input"
          value={member.name}
          placeholder="Name"
          onChange={(e) => update({ name: e.target.value })}
        />
      </div>
      <input
        className="team-inline-input"
        value={member.role}
        placeholder="Role"
        onChange={(e) => update({ role: e.target.value })}
      />
      <input
        className="team-inline-input"
        type="email"
        value={member.email}
        placeholder="name@company.com"
        onChange={(e) => update({ email: e.target.value })}
      />
      <span>
        {member.invitedAt ? (
          <span className="status-pill status-done" title={new Date(member.invitedAt).toLocaleString()}>
            Invited {timeAgo(member.invitedAt)}
          </span>
        ) : (
          <span className="status-pill status-todo">Not invited</span>
        )}
      </span>
      <div className="team-row-actions">
        {hasEmail ? (
          <a
            className="btn btn-sm"
            href={inviteMailto(member, project.name)}
            onClick={() => dispatch({ type: "member/invite", id: member.id })}
          >
            {member.invitedAt ? "Resend invite" : "Send invite"}
          </a>
        ) : (
          <button className="btn btn-sm" disabled title="Add an email first">
            Send invite
          </button>
        )}
        <button
          className="btn btn-sm btn-ghost"
          title="Remove from team"
          onClick={() => {
            if (confirm(`Remove ${member.name || "this member"} from the team?`)) {
              dispatch({ type: "member/remove", id: member.id });
            }
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

function AddMemberModal({ onClose }: { onClose: () => void }) {
  const { dispatch } = useStore();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");

  function submit() {
    if (!name.trim()) return;
    dispatch({ type: "member/add", name: name.trim(), role: role.trim(), email: email.trim() });
    onClose();
  }

  return (
    <Modal title="Add team member" onClose={onClose} narrow>
      <div className="form-field">
        <label>Name</label>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Priya Sharma" />
      </div>
      <div className="form-field">
        <label>Role</label>
        <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. QA Engineer" />
      </div>
      <div className="form-field">
        <label>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@company.com"
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </div>
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={!name.trim()} onClick={submit}>Add member</button>
      </div>
    </Modal>
  );
}
