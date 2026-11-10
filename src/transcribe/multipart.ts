export interface Part {
  readonly name: string;
  readonly value: string | ArrayBuffer;
  readonly filename?: string;
  readonly type?: string;
}

/** Build a multipart/form-data body by hand: Obsidian's requestUrl takes bytes, not FormData. */
export function encodeMultipart(parts: readonly Part[], boundary = `----muninn${Math.random().toString(16).slice(2)}`): { body: ArrayBuffer; contentType: string } {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    const file = typeof part.value !== "string";
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"` +
      (file ? `; filename="${part.filename ?? "file"}"\r\nContent-Type: ${part.type ?? "application/octet-stream"}` : "") + "\r\n\r\n";
    chunks.push(enc.encode(head), typeof part.value === "string" ? enc.encode(part.value) : new Uint8Array(part.value), enc.encode("\r\n"));
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const body = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { body.set(c, offset); offset += c.length; }
  return { body: body.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}
