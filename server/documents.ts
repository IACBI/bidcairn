import { Worker } from "node:worker_threads";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import type { SupabaseStore } from "./store.js";
import { AppError } from "./errors.js";
import type { Proposal } from "../shared/model.js";
let parserBusy = false;
export async function parsePDF(bytes: Buffer): Promise<Proposal["pages"]> {
  if (
    bytes.length > 10 * 1024 * 1024 ||
    bytes.subarray(0, 5).toString() !== "%PDF-"
  )
    throw new AppError(422, "Upload a valid PDF smaller than 10 MB.");
  if (parserBusy)
    throw new AppError(429, "The PDF parser is busy. Retry shortly.");
  parserBusy = true;
  try {
    return await new Promise<Proposal["pages"]>((resolve, reject) => {
      const worker = new Worker(new URL("./pdf-worker.mjs", import.meta.url), {
        workerData: bytes,
        resourceLimits: { maxOldGenerationSizeMb: 192 },
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new AppError(422, "PDF parsing exceeded its safe time limit."));
      }, 15000);
      worker.once(
        "message",
        (result: { pages: Proposal["pages"]; error?: string }) => {
          clearTimeout(timer);
          void worker.terminate();
          if (result.error) reject(new AppError(422, result.error));
          else resolve(result.pages);
        },
      );
      worker.once("error", () => {
        clearTimeout(timer);
        reject(new AppError(422, "The PDF could not be safely parsed."));
      });
      worker.once("exit", (code) => {
        clearTimeout(timer);
        if (code !== 0) reject(new AppError(422, "The PDF parser stopped."));
      });
    });
  } finally {
    parserBusy = false;
  }
}
export class Documents {
  constructor(
    private config: Config,
    private remote?: SupabaseStore,
  ) {}
  private validId(id: string, owner: string) {
    if (
      !/^[0-9a-f-]{36}$/.test(owner) ||
      !new RegExp(`^${owner}/[0-9a-f-]{36}\\.pdf$`).test(id)
    )
      throw new AppError(404, "Document not found.");
  }
  async remove(id: string, owner: string) {
    this.validId(id, owner);
    if (this.remote) {
      const { error } = await this.remote.client.storage
        .from(this.config.SUPABASE_STORAGE_BUCKET)
        .remove([id]);
      if (error)
        throw new AppError(503, "Private document cleanup is pending.");
    } else
      await rm(join(this.config.DATA_DIR, "documents", id), { force: true });
  }
  async put(owner: string, bytes: Buffer) {
    const id = `${owner}/${randomUUID()}.pdf`;
    if (this.remote) {
      const { error } = await this.remote.client.storage
        .from(this.config.SUPABASE_STORAGE_BUCKET)
        .upload(id, bytes, { contentType: "application/pdf", upsert: false });
      if (error)
        throw new AppError(503, "The proposal could not be stored privately.");
    } else {
      const folder = join(this.config.DATA_DIR, "documents", owner);
      await mkdir(folder, { recursive: true });
      await writeFile(join(this.config.DATA_DIR, "documents", id), bytes, {
        flag: "wx",
      });
    }
    return id;
  }
  async get(id: string, owner: string) {
    this.validId(id, owner);
    if (this.remote) {
      const { data, error } = await this.remote.client.storage
        .from(this.config.SUPABASE_STORAGE_BUCKET)
        .download(id);
      if (error) throw new AppError(404, "Document not found.");
      return Buffer.from(await data.arrayBuffer());
    }
    return readFile(join(this.config.DATA_DIR, "documents", id));
  }
}
