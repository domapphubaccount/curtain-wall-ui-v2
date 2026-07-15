import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { useStore, uid } from "../store";
import { filesToAttachments, formatBytes } from "../files";

export default function Files() {
  const { project, dispatch } = useStore();
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next = await filesToAttachments(files, uid);
    if (next.length) dispatch({ type: "file/add", files: next });
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  const files = [...project.files].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  return (
    <>
      <div className="view-header">
        <div>
          <h1>Files</h1>
          <div className="sub">
            {project.name}'s shared file folder — upload once, then attach to any task from its Attachments section.
          </div>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
            ⬆ Upload files
          </button>
        </div>
      </div>

      <div
        className={`attach-drop files-drop${dragOver ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <span className="attach-drop-icon">📁</span>
        <span>Drop files or photos here, or click to browse</span>
      </div>

      {files.length === 0 ? (
        <div className="panel empty-state">
          <div className="big">🗂</div>
          <h3>No files yet</h3>
          <p>Upload files or photos above to start this project's shared folder.</p>
        </div>
      ) : (
        <div className="files-grid">
          {files.map((f) => {
            const usedIn = project.stories.filter((s) => s.attachments.some((a) => a.id === f.id));
            return (
              <div className="panel file-card" key={f.id}>
                {f.mimeType.startsWith("image/") ? (
                  <a href={f.dataUrl} target="_blank" rel="noreferrer" className="file-card-thumb">
                    <img src={f.dataUrl} alt={f.name} />
                  </a>
                ) : (
                  <a href={f.dataUrl} download={f.name} className="file-card-thumb file-card-generic">
                    <span className="attach-file-icon">📄</span>
                  </a>
                )}
                <div className="file-card-meta">
                  <span className="file-card-name" title={f.name}>{f.name}</span>
                  <span className="file-card-sub">{formatBytes(f.size)} · {new Date(f.uploadedAt).toLocaleDateString()}</span>
                  {usedIn.length > 0 && (
                    <span className="file-card-usage" title={usedIn.map((s) => `${s.key} — ${s.title}`).join("\n")}>
                      📎 used in {usedIn.length} task{usedIn.length === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <button
                  className="remove file-card-remove"
                  title="Delete from folder"
                  onClick={() => {
                    const warning = usedIn.length
                      ? ` Tasks that already attached it keep their own copy, but you won't be able to attach it again.`
                      : "";
                    if (confirm(`Delete "${f.name}" from the project folder?${warning}`)) {
                      dispatch({ type: "file/delete", id: f.id });
                    }
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
