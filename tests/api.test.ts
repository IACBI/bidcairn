import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, referencePDF } from "../server/app.js";
import { parsePDF } from "../server/documents.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../server/config.js";
import { LocalStore } from "../server/store.js";
import type { Purchase } from "../shared/model.js";

const origin = "http://localhost:3000";
describe("HTTP authority and workspace isolation", () => {
  let app: ReturnType<typeof createApp>["app"];
  let store: LocalStore;
  beforeEach(() => {
    store = new LocalStore(":memory:");
    app = createApp(loadConfig({ DATA_DIR: ".data/test-uploads" }), store).app;
  });
  async function user() {
    const agent = request.agent(app);
    const result = await agent
      .post("/api/session")
      .set("Origin", origin)
      .send({});
    return { agent, csrf: result.body.csrf as string };
  }
  async function purchase(client: Awaited<ReturnType<typeof user>>) {
    const result = await client.agent
      .post("/api/purchases")
      .set("Origin", origin)
      .set("x-csrf-token", client.csrf)
      .send({ reference: true });
    expect(result.status).toBe(200);
    return result.body as Purchase;
  }
  it("requires a session and rejects cross-origin session creation", async () => {
    expect((await request(app).get("/api/purchases")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/session")
          .set("Origin", "https://attacker.example")
          .send({})
      ).status,
    ).toBe(403);
  });
  it("rejects malformed input without an internal error", async () => {
    const a = await user();
    expect(
      (
        await a.agent
          .post("/api/purchases")
          .set("Origin", origin)
          .set("x-csrf-token", "é".repeat(64))
          .send({ reference: true })
      ).status,
    ).toBe(403);
    expect(
      (
        await a.agent
          .post("/api/purchases")
          .set("Origin", origin)
          .set("Content-Type", "application/json")
          .send("{broken")
      ).status,
    ).toBe(400);
    expect(
      (await request(app).get("/api/purchases").set("Cookie", "bc_session=%ZZ"))
        .status,
    ).toBe(401);
  });
  it("isolates purchases and exports between two sessions", async () => {
    const a = await user(),
      b = await user(),
      p = await purchase(a);
    expect((await b.agent.get(`/api/purchases/${p.id}`)).status).toBe(404);
    expect((await b.agent.get(`/api/purchases/${p.id}/export`)).status).toBe(
      404,
    );
    expect((await b.agent.get("/api/purchases")).body).toEqual([]);
  });
  it("rejects missing CSRF and stale version writes", async () => {
    const a = await user(),
      p = await purchase(a);
    const route = `/api/purchases/${p.id}/brief`;
    expect(
      (
        await a.agent
          .post(route)
          .set("Origin", origin)
          .set("If-Match", "1")
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await a.agent
          .post(route)
          .set("Origin", origin)
          .set("x-csrf-token", a.csrf)
          .set("If-Match", "99")
          .send({})
      ).status,
    ).toBe(409);
  });
  it("restricts originals before the identity reveal and labels references honestly", async () => {
    const a = await user(),
      p = await purchase(a);
    expect(
      p.proposals.every((x) => x.provenance === "reference" && !x.analysis),
    ).toBe(true);
    expect(
      (
        await a.agent.get(
          `/api/purchases/${p.id}/proposals/${p.proposals[0].id}/document`,
        )
      ).status,
    ).toBe(403);
  });
  it("never creates an invoice before human approval", async () => {
    const a = await user(),
      p = await purchase(a);
    const result = await a.agent
      .post(`/api/purchases/${p.id}/invoice`)
      .set("Origin", origin)
      .set("x-csrf-token", a.csrf)
      .set("If-Match", "1")
      .send({ mode: "simulation" });
    expect(result.status).toBe(409);
  });
  it("does not expose configured secrets in capabilities", async () => {
    const a = await user();
    const result = await a.agent.get("/api/capabilities");
    expect(result.body.ai.qualified).toBe(false);
    expect(JSON.stringify(result.body)).not.toMatch(/KEY|SECRET|service_role/);
  });
  it("enforces team roles and hides existence from nonmembers", async () => {
    const a = await user(),
      b = await user(),
      outsider = await user(),
      p = await purchase(a);
    const userId = (await b.agent.get("/api/session")).body.userId;
    store.db
      .prepare("INSERT INTO workspace_members VALUES (?, ?, ?)")
      .run(p.workspaceId, userId, "reviewer");
    expect((await b.agent.get(`/api/purchases/${p.id}`)).body.accessRole).toBe(
      "reviewer",
    );
    expect((await b.agent.get("/api/purchases")).body).toHaveLength(1);
    expect((await outsider.agent.get(`/api/purchases/${p.id}`)).status).toBe(
      404,
    );
    const mutate = (path: string, body: Record<string, unknown> = {}) =>
      b.agent
        .post(`/api/purchases/${p.id}${path}`)
        .set("Origin", origin)
        .set("x-csrf-token", b.csrf)
        .set("If-Match", String(p.version))
        .send(body);
    expect(
      (
        await mutate("/brief", {
          title: p.title,
          buyerEmail: p.buyerEmail,
          rubric: p.rubric,
        })
      ).status,
    ).toBe(403);
    expect((await mutate("/award")).status).toBe(403);
    expect((await mutate("/invoice", { mode: "simulation" })).status).toBe(403);
    expect(
      (await mutate(`/proposals/${p.proposals[0].id}/confirm`)).status,
    ).toBe(200);
    expect(
      (
        await b.agent
          .delete(`/api/purchases/${p.id}`)
          .set("Origin", origin)
          .set("x-csrf-token", b.csrf)
          .set("If-Match", "2")
          .send({ confirm: "DELETE" })
      ).status,
    ).toBe(403);
  });
  it("deletes only the owner-selected revision and keeps usage reservations", async () => {
    const a = await user(),
      p = await purchase(a);
    await store.reserveAI("retain-meter", 10, 0, 100, 0);
    const remove = (version: string, confirm: string) =>
      a.agent
        .delete(`/api/purchases/${p.id}`)
        .set("Origin", origin)
        .set("x-csrf-token", a.csrf)
        .set("If-Match", version)
        .send({ confirm });
    expect((await remove("99", "DELETE")).status).toBe(409);
    expect((await remove("1", "wrong")).status).toBe(422);
    expect((await remove("1", "DELETE")).body.deleted).toBe(true);
    expect((await a.agent.get(`/api/purchases/${p.id}`)).status).toBe(404);
    expect(
      store.db.prepare("SELECT count(*) AS n FROM ai_reservations").get()?.n,
    ).toBe(1);
  });
  it("extracts a text PDF in the bounded worker and rejects arbitrary bytes", async () => {
    const bytes = referencePDF([
      {
        page: 1,
        text: "Synthetic service proposal for a website migration. All-inclusive USD 1000. Delivery in 20 days. Defect warranty lasts 30 days.",
      },
    ]);
    const pages = await parsePDF(bytes);
    expect(pages[0].text).toContain("All-inclusive USD 1000");
    await expect(
      parsePDF(Buffer.from("<html>not a PDF</html>")),
    ).rejects.toThrow(/valid PDF/);
  });
  it("stores uploaded PDFs privately, masks identity and deletes their bytes with the purchase", async () => {
    const a = await user();
    let response = await a.agent.post("/api/purchases").set("Origin",origin).set("x-csrf-token",a.csrf).send({reference:false});
    let p = response.body as Purchase;
    expect(p.synthetic).toBe(true);
    response = await a.agent.post(`/api/purchases/${p.id}/brief`).set("Origin",origin).set("x-csrf-token",a.csrf).set("If-Match",String(p.version)).send({title:p.title,buyerEmail:p.buyerEmail,rubric:p.rubric});
    p=response.body;
    const bytes=referencePDF([{page:1,text:"Synthetic Cedar Supplier. Contact: cedar@example.com. All-inclusive USD 1000. Delivery in 20 calendar days. Defect warranty lasts 30 days."}]);
    response = await a.agent.post(`/api/purchases/${p.id}/proposals`).set("Origin",origin).set("x-csrf-token",a.csrf).set("If-Match",String(p.version))
      .field("supplierName","Cedar Supplier").field("supplierEmail","cedar@example.com").field("synthetic","true").attach("file",bytes,{filename:"cedar.pdf",contentType:"application/pdf"});
    expect(response.status).toBe(200);
    p=response.body;
    expect(JSON.stringify(p.proposals[0].pages)).not.toContain("Cedar Supplier");
    expect(p.proposals[0].identity.name).toBe("");
    expect(p.proposals[0].analysis).toBeUndefined();
    const path=resolve(".data/test-uploads/documents",p.proposals[0].documentId!);
    expect(await readFile(path)).toEqual(bytes);
    const removed = await a.agent.delete(`/api/purchases/${p.id}`).set("Origin",origin).set("x-csrf-token",a.csrf).set("If-Match",String(p.version)).send({confirm:"DELETE"});
    expect(removed.body).toEqual({deleted:true,documentCleanupPending:false});
    await expect(readFile(path)).rejects.toMatchObject({code:"ENOENT"});
    expect(await store.pendingDocumentDeletes()).toEqual([]);
  });
});
