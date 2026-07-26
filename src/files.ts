import type { Attachment } from "./types";

/** Basic deployment stores base64 in PostgreSQL JSON, so keep individual files small. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB per file

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Reads files into Attachment records, skipping (with an alert) anything over the size cap. */
export async function filesToAttachments(
  files: FileList | File[],
  uid: () => string
): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const file of Array.from(files)) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      alert(`"${file.name}" is over the 5MB limit and was skipped.`);
      continue;
    }
    const dataUrl = await readAsDataUrl(file);
    out.push({
      id: uid(),
      name: file.name,
      mimeType: file.type,
      size: file.size,
      dataUrl,
      uploadedAt: new Date().toISOString(),
    });
  }
  return out;
}
