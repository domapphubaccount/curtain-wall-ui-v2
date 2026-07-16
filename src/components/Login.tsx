import { useState } from "react";
import { ApiError } from "../api";
import { useAuth } from "../auth";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo"><span className="logo-mark">⚡</span> SprintForge</div>
        <h1>Welcome back</h1>
        <p>Sign in with your company account.</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-field">
          <label>Email</label>
          <input type="email" autoComplete="username" autoFocus required value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
        <div className="form-field">
          <label>Password</label>
          <input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        </div>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
