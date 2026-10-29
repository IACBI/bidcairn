import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Purchase, WorkspaceRole } from "../shared/model.js";
import { AppError } from "./errors.js";

export interface Store {
  role(workspace: string, user: string): Promise<WorkspaceRole | null>;
  remove(purchase: Purchase, expectedVersion: number): Promise<void>;
  pendingDocumentDeletes(): Promise<{ id: string; workspace: string }[]>;
  completeDocumentDelete(id: string): Promise<void>;
  queueDocumentDelete(id: string, workspace: string): Promise<void>;
  list(owner: string): Promise<Purchase[]>;
  get(id: string, owner: string): Promise<Purchase>;
  save(purchase: Purchase, expectedVersion: number | null): Promise<void>;
  session(tokenHash: string): Promise<string | null>;
  addSession(tokenHash: string, owner: string): Promise<void>;
  reserveAI(
    id: string,
    tokens: number,
    cost: number,
    maxTokens: number,
    maxCost: number,
    scope?: string,
  ): Promise<boolean>;
  registerWebhook(id: string): Promise<boolean>;
  findInvoice(id: string): Promise<Purchase | null>;
}
export class LocalStore implements Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS purchases (id TEXT PRIMARY KEY, owner TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_reservations (id TEXT PRIMARY KEY, day TEXT NOT NULL, tokens INTEGER NOT NULL, cost REAL NOT NULL);
      CREATE TABLE IF NOT EXISTS webhooks (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS workspace_members (workspace TEXT NOT NULL, user TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('curator','reviewer','approver')), PRIMARY KEY(workspace,user));
      CREATE TABLE IF NOT EXISTS document_deletions (id TEXT PRIMARY KEY, workspace TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_attempts (scope TEXT PRIMARY KEY, attempts INTEGER NOT NULL);`);
  }
  async role(workspace: string, user: string): Promise<WorkspaceRole | null> {
    if (workspace === user) return "owner";
    const row = this.db
      .prepare(
        "SELECT role FROM workspace_members WHERE workspace = ? AND user = ?",
      )
      .get(workspace, user);
    return row ? (row.role as WorkspaceRole) : null;
  }
  async list(owner: string) {
    return this.db
      .prepare(
        "SELECT data FROM purchases WHERE owner = ? OR owner IN (SELECT workspace FROM workspace_members WHERE user = ?) ORDER BY rowid DESC",
      )
      .all(owner, owner)
      .map((row) => JSON.parse(row.data as string) as Purchase);
  }
  async get(id: string, owner: string) {
    const row = this.db
      .prepare("SELECT data, owner FROM purchases WHERE id = ?")
      .get(id);
    if (!row || !(await this.role(row.owner as string, owner)))
      throw new AppError(404, "Purchase not found.");
    return JSON.parse(row.data as string) as Purchase;
  }
  async remove(p: Purchase, expected: number) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = this.db
        .prepare(
          "DELETE FROM purchases WHERE id = ? AND owner = ? AND version = ?",
        )
        .run(p.id, p.workspaceId, expected);
      if (result.changes !== 1)
        throw new AppError(
          409,
          "This purchase changed. Refresh before deleting it.",
        );
      for (const proposal of p.proposals)
        if (proposal.documentId)
          this.db
            .prepare("INSERT OR IGNORE INTO document_deletions VALUES (?, ?)")
            .run(proposal.documentId, p.workspaceId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async pendingDocumentDeletes() {
    return this.db
      .prepare("SELECT id, workspace FROM document_deletions LIMIT 100")
      .all() as unknown as { id: string; workspace: string }[];
  }
  async completeDocumentDelete(id: string) {
    this.db.prepare("DELETE FROM document_deletions WHERE id = ?").run(id);
  }
  async queueDocumentDelete(id: string, workspace: string) {
    this.db
      .prepare("INSERT OR IGNORE INTO document_deletions VALUES (?, ?)")
      .run(id, workspace);
  }
  async save(p: Purchase, expected: number | null) {
    if (expected === null) {
      this.db
        .prepare("INSERT INTO purchases VALUES (?, ?, ?, ?)")
        .run(p.id, p.workspaceId, p.version, JSON.stringify(p));
      return;
    }
    const current = await this.get(p.id, p.workspaceId);
    if (
      JSON.stringify(p.events.slice(0, current.events.length)) !==
      JSON.stringify(current.events)
    )
      throw new AppError(409, "Existing audit events cannot be rewritten.");
    if (
      current.award &&
      JSON.stringify(current.award) !== JSON.stringify(p.award)
    )
      throw new AppError(409, "An approved award cannot be rewritten.");
    if (p.version !== expected + 1)
      throw new AppError(409, "Invalid purchase revision.");
    const result = this.db
      .prepare(
        "UPDATE purchases SET data = ?, version = ? WHERE id = ? AND owner = ? AND version = ?",
      )
      .run(JSON.stringify(p), p.version, p.id, p.workspaceId, expected);
    if (result.changes !== 1)
      throw new AppError(
        409,
        "This purchase changed. Refresh and review the latest version.",
        "STALE_VERSION",
      );
  }
  async session(tokenHash: string) {
    const row = this.db
      .prepare(
        "SELECT owner FROM sessions WHERE token_hash = ? AND expires > ?",
      )
      .get(tokenHash, Date.now());
    return row ? (row.owner as string) : null;
  }
  async addSession(tokenHash: string, owner: string) {
    this.db
      .prepare("INSERT INTO sessions VALUES (?, ?, ?)")
      .run(tokenHash, owner, Date.now() + 24 * 3600 * 1000);
  }
  async reserveAI(
    id: string,
    tokens: number,
    cost: number,
    maxTokens: number,
    maxCost: number,
    scope?: string,
  ) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const day = new Date().toISOString().slice(0, 10);
      const calls = scope
        ? this.db
            .prepare("SELECT attempts FROM ai_attempts WHERE scope = ?")
            .get(scope)
        : undefined;
      if (Number(calls?.attempts || 0) >= 2) {
        this.db.exec("ROLLBACK");
        return false;
      }
      const total = this.db
        .prepare(
          "SELECT COALESCE(SUM(cost), 0) AS cost, COALESCE(SUM(CASE WHEN day = ? THEN tokens ELSE 0 END), 0) AS tokens FROM ai_reservations",
        )
        .get(day)!;
      if (
        Number(total.cost) + cost > maxCost ||
        Number(total.tokens) + tokens > maxTokens
      ) {
        this.db.exec("ROLLBACK");
        return false;
      }
      this.db
        .prepare("INSERT INTO ai_reservations VALUES (?, ?, ?, ?)")
        .run(id, day, tokens, cost);
      if (scope)
        this.db
          .prepare(
            "INSERT INTO ai_attempts VALUES (?, 1) ON CONFLICT(scope) DO UPDATE SET attempts = attempts + 1",
          )
          .run(scope);
      this.db.exec("COMMIT");
      return true;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  async registerWebhook(id: string) {
    return (
      this.db.prepare("INSERT OR IGNORE INTO webhooks VALUES (?)").run(id)
        .changes === 1
    );
  }
  async findInvoice(id: string) {
    const row = this.db
      .prepare(
        "SELECT data FROM purchases WHERE json_extract(data, '$.invoice.id') = ?",
      )
      .get(id);
    return row ? (JSON.parse(row.data as string) as Purchase) : null;
  }
}

export class SupabaseStore implements Store {
  client: SupabaseClient;
  constructor(url: string, key: string) {
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  async role(workspace: string, user: string): Promise<WorkspaceRole | null> {
    if (workspace === user) return "owner";
    const { data, error } = await this.client
      .from("workspace_members")
      .select("role")
      .eq("workspace", workspace)
      .eq("user_id", user)
      .maybeSingle();
    if (error)
      throw new AppError(503, "Workspace permissions are unavailable.");
    return (data?.role as WorkspaceRole) || null;
  }
  async list(owner: string) {
    const membership = await this.client
      .from("workspace_members")
      .select("workspace")
      .eq("user_id", owner);
    if (membership.error)
      throw new AppError(503, "Workspace permissions are unavailable.");
    const workspaces = [
      owner,
      ...membership.data.map((row) => row.workspace as string),
    ];
    const { data, error } = await this.client
      .from("purchases")
      .select("data")
      .in("owner", workspaces)
      .order("created_at", { ascending: false });
    if (error) throw new AppError(503, "Database is unavailable.");
    return data.map((row) => row.data as Purchase);
  }
  async get(id: string, owner: string) {
    const { data, error } = await this.client
      .from("purchases")
      .select("data, owner")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new AppError(503, "Database is unavailable.");
    if (!data || !(await this.role(data.owner, owner)))
      throw new AppError(404, "Purchase not found.");
    return data.data as Purchase;
  }
  async remove(p: Purchase, expected: number) {
    const { data, error } = await this.client.rpc("delete_purchase", {
      p_id: p.id,
      p_owner: p.workspaceId,
      p_expected: expected,
    });
    if (error) throw new AppError(503, "The purchase could not be deleted.");
    if (!data)
      throw new AppError(
        409,
        "This purchase changed. Refresh before deleting it.",
      );
  }
  async pendingDocumentDeletes() {
    const { data, error } = await this.client
      .from("document_deletions")
      .select("id, workspace")
      .limit(100);
    if (error) throw new AppError(503, "Document cleanup is unavailable.");
    return data as { id: string; workspace: string }[];
  }
  async completeDocumentDelete(id: string) {
    const { error } = await this.client
      .from("document_deletions")
      .delete()
      .eq("id", id);
    if (error)
      throw new AppError(503, "Document cleanup could not be recorded.");
  }
  async queueDocumentDelete(id: string, workspace: string) {
    const { error } = await this.client
      .from("document_deletions")
      .upsert({ id, workspace });
    if (error) throw new AppError(503, "Document cleanup could not be queued.");
  }
  async save(p: Purchase, expected: number | null) {
    const { data, error } = await this.client.rpc("save_purchase", {
      p_id: p.id,
      p_owner: p.workspaceId,
      p_version: p.version,
      p_expected: expected,
      p_data: p,
    });
    if (error) throw new AppError(503, "The purchase could not be saved.");
    if (!data)
      throw new AppError(
        409,
        "This purchase changed. Refresh before continuing.",
        "STALE_VERSION",
      );
  }
  async session() {
    return null;
  }
  async addSession() {
    throw new Error("Hosted sessions use Supabase Auth.");
  }
  async reserveAI(
    id: string,
    tokens: number,
    cost: number,
    maxTokens: number,
    maxCost: number,
    scope?: string,
  ) {
    const { data, error } = await this.client.rpc("reserve_ai", {
      p_id: id,
      p_tokens: tokens,
      p_cost: cost,
      p_max_tokens: maxTokens,
      p_max_cost: maxCost,
      p_scope: scope || id,
    });
    if (error)
      throw new AppError(
        503,
        "Usage accounting is unavailable; inference is disabled.",
      );
    return data as boolean;
  }
  async registerWebhook(id: string) {
    const { error } = await this.client.from("webhook_events").insert({ id });
    if (error?.code === "23505") return false;
    if (error) throw new AppError(503, "Webhook storage is unavailable.");
    return true;
  }
  async findInvoice(id: string) {
    const { data, error } = await this.client
      .from("purchases")
      .select("data")
      .eq("data->invoice->>id", id)
      .maybeSingle();
    if (error) throw new AppError(503, "Invoice lookup is unavailable.");
    return data ? (data.data as Purchase) : null;
  }
}
