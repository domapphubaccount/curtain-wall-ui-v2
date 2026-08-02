import { useState } from "react";
import { useAuth } from "../auth";
import type { AuthUser } from "../types";
import { Modal } from "./common";

export default function AccountModal({ onSaved, onClose }: {
  onSaved(user: AuthUser): void;
  onClose(): void;
}) {
  const { user, updateAccount } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const passwordMismatch = !!newPassword && newPassword !== confirmPassword;
  const invalidPassword = !!newPassword && newPassword.length < 8;

  async function save() {
    if (!name.trim() || !email.trim() || passwordMismatch || invalidPassword || (newPassword && !currentPassword)) return;
    setSaving(true);
    setError("");
    try {
      const updated = await updateAccount({
        name: name.trim(),
        email: email.trim(),
        ...(newPassword ? { currentPassword, newPassword } : {}),
      });
      onSaved(updated);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not update account");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="My account" onClose={onClose} narrow>
      {error && <div className="form-error">{error}</div>}
      <div className="form-field"><label>Name</label><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></div>
      <div className="form-field"><label>Email</label><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></div>
      <div className="form-section-label">Change password (optional)</div>
      <div className="form-field"><label>Current password</label><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></div>
      <div className="form-field"><label>New password</label><input type="password" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><small>At least 8 characters.</small></div>
      <div className="form-field"><label>Confirm new password</label><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />{passwordMismatch && <small>Passwords do not match.</small>}</div>
      <div className="modal-actions"><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => void save()} disabled={saving || !name.trim() || !email.trim() || passwordMismatch || invalidPassword || (!!newPassword && !currentPassword)}>{saving ? "Saving…" : "Save changes"}</button></div>
    </Modal>
  );
}
