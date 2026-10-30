import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import multer from "multer";
import {
  randomBytes,
  randomUUID,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Capability, Proposal, Purchase } from "../shared/model.js";
import { factKeys } from "../shared/model.js";
import { scoreProposal } from "../shared/scoring.js";
import { type Config } from "./config.js";
import { LocalStore, SupabaseStore, type Store } from "./store.js";
import { AIService } from "./ai.js";
import { PayPal, simulatedInvoice } from "./paypal.js";
import { AppError, ensure } from "./errors.js";
import {
  approveAward,
  commitBrief,
  confirmProposal,
  freezeAssessment,
  mutable,
  proposalById,
  publicPurchase,
  record,
  revealIdentities,
} from "./commands.js";
import { blankFacts, createPurchase } from "./reference.js";
import { hash, maskIdentity } from "./evidence.js";
import { Documents, parsePDF } from "./documents.js";

const idSchema = z.string().uuid();
interface Session {
  owner: string;
  csrf: string;
}
const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
function cookies(req: Request) {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .filter((x) => x.includes("="))
      .map((x) => {
        const at = x.indexOf("=");
        try {
          return [x.slice(0, at).trim(), decodeURIComponent(x.slice(at + 1))];
        } catch {
          return [x.slice(0, at).trim(), ""];
        }
      }),
  );
}
export function referencePDF(pages: Proposal["originalPages"]): Buffer {
  const objects: string[] = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const pageIds: number[] = [];
  for (const page of pages) {
    const pageId = objects.length + 1,
      streamId = pageId + 1,
      fontId = 3 + pages.length * 2;
    pageIds.push(pageId);
    const lines = page.text
      .split("\n")
      .flatMap((line) => line.match(/.{1,85}(?:\s|$)/g) || [line]);
    const stream = `BT /F1 11 Tf 48 790 Td 16 TL ${lines.map((line) => `(${line.replace(/[^\x20-\x7E]/g, "-").replace(/[\\()]/g, "\\$&")}) Tj T*`).join("\n")} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let result = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(result));
    result += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${n.toString().padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(result);
}

export function createApp(
  config: Config,
  injectedStore?: Store,
  request: typeof fetch = fetch,
) {
  const store =
    injectedStore ||
    (config.STORAGE_MODE === "supabase"
      ? new SupabaseStore(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
      : new LocalStore(resolve(config.DATA_DIR, "bidcairn.sqlite")));
  const ai = new AIService(config, store, request),
    paypal = new PayPal(config, request);
  const documents = new Documents(
    config,
    store instanceof SupabaseStore ? store : undefined,
  );
  async function cleanupDocuments() {
    let pending = 0;
    for (const job of await store.pendingDocumentDeletes()) {
      try {
        await documents.remove(job.id, job.workspace);
        await store.completeDocumentDelete(job.id);
      } catch {
        pending++;
      }
    }
    return pending;
  }
  const app = express();
  app.disable("x-powered-by");
  if (config.production) app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          connectSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          upgradeInsecureRequests: config.production ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      strictTransportSecurity: config.production ? undefined : false,
    }),
  );
  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.setHeader("X-Request-ID", requestId);
    res.setHeader("Cache-Control", "no-store");
    const started = Date.now();
    res.on("finish", () => {
      if (req.path.startsWith("/api/"))
        console.log(
          JSON.stringify({
            requestId,
            method: req.method,
            status: res.statusCode,
            durationMs: Date.now() - started,
          }),
        );
    });
    next();
  });
  const limits = new Map<string, { count: number; until: number }>();
  app.use("/api", (req, _res, next) => {
    if (req.path === "/health") return next();
    const now = Date.now(),
      key = req.ip || "local";
    if (limits.size > 2000)
      for (const [id, entry] of limits)
        if (entry.until < now) limits.delete(id);
    const entry = limits.get(key);
    if (!entry || entry.until < now)
      limits.set(key, { count: 1, until: now + 60000 });
    else if (++entry.count > 120)
      return next(
        new AppError(429, "Too many requests. Please wait a minute."),
      );
    next();
  });
  app.get("/api/health", async (_req, res) => {
    await store.list("00000000-0000-0000-0000-000000000000");
    res.json({ status: "ok", application: "Bidcairn" });
  });

  app.post(
    "/api/webhooks/paypal/:vendorId",
    express.json({ limit: "256kb" }),
    async (req, res) => {
      const vendorId = z.enum(["A", "B", "C"]).parse(req.params.vendorId);
      const event = z
        .object({
          id: z.string().min(1).max(160),
          event_type: z.string(),
          resource: z
            .object({
              id: z.string().optional(),
              invoice_id: z.string().optional(),
              invoice: z.object({ id: z.string() }).optional(),
            })
            .passthrough(),
        })
        .passthrough()
        .parse(req.body);
      await paypal.verifyWebhook(
        vendorId,
        req.headers as Record<string, string | undefined>,
        req.body,
      );
      const invoiceId = event.resource.id?.startsWith("INV2-")
        ? event.resource.id
        : event.resource.invoice_id || event.resource.invoice?.id;
      if (!event.event_type.startsWith("INVOICING.INVOICE.") || !invoiceId)
        return void res.status(200).json({ ignored: true });
      const p = await store.findInvoice(invoiceId);
      if (!p?.invoice || p.invoice.provider !== "paypal-sandbox")
        return void res.status(200).json({ ignored: true });
      ensure(
        proposalById(p, p.invoice.proposalId).vendorId === vendorId,
        "Webhook merchant context does not match.",
        400,
      );
      if (p.events.some((e) => e.id === `paypal:${event.id}`))
        return void res.json({ duplicate: true });
      p.invoice = await paypal.read(p, vendorId, p.invoice);
      p.events.push({
        id: `paypal:${event.id}`,
        type: "invoice.webhook_verified",
        actor: "paypal",
        at: new Date().toISOString(),
        version: p.version + 1,
        detail: `${event.event_type}; authoritative invoice state: ${p.invoice.state}.`,
      });
      const expected = p.version;
      p.version++;
      await store.save(p, expected);
      await store.registerWebhook(event.id);
      res.json({ received: true });
    },
  );
  app.use("/api", (req, _res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    const allowed =
      origin === config.APP_ORIGIN ||
      (!config.production &&
        [
          "http://localhost:5173",
          "http://127.0.0.1:5173",
          "http://127.0.0.1:3000",
        ].includes(origin || ""));
    if (!allowed)
      return next(new AppError(403, "The request origin is not allowed."));
    next();
  });
  app.use(express.json({ limit: "128kb" }));
  const sign = (value: string) =>
    createHmac("sha256", config.SESSION_SECRET).update(value).digest("hex");
  const setCookie = (
    res: Response,
    name: string,
    value: string,
    maxAge = 24 * 3600 * 1000,
  ) =>
    res.cookie(name, value, {
      httpOnly: true,
      sameSite: "strict",
      secure: config.production,
      path: "/",
      maxAge,
    });
  app.post("/api/session", async (req, res) => {
    const body = z
      .object({
        email: z.string().email().optional(),
        password: z.string().max(200).optional(),
      })
      .strict()
      .parse(req.body || {});
    if (config.STORAGE_MODE === "supabase") {
      const client = createClient(
        config.SUPABASE_URL,
        config.SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data, error } =
        body.email && body.password
          ? await client.auth.signInWithPassword({
              email: body.email,
              password: body.password,
            })
          : await client.auth.signInAnonymously();
      ensure(
        !error && data.session && data.user,
        "Sign-in could not be completed. Check the hosted authentication configuration.",
        401,
      );
      setCookie(res, "bc_token", data.session.access_token);
      setCookie(res, "bc_refresh", data.session.refresh_token);
      res.json({ csrf: sign(data.user.id), mode: "supabase" });
    } else {
      const existing = cookies(req).bc_session;
      const owner = existing ? await store.session(hash(existing)) : null;
      if (owner) return void res.json({ csrf: sign(owner), mode: "local" });
      const token = randomBytes(32).toString("hex"),
        id = randomUUID();
      await store.addSession(hash(token), id);
      setCookie(res, "bc_session", token);
      res.json({ csrf: sign(id), mode: "local" });
    }
  });
  app.use("/api", async (req, res, next) => {
    const cookie = cookies(req);
    let owner: string | null = null;
    if (config.STORAGE_MODE === "supabase") {
      const client = createClient(
        config.SUPABASE_URL,
        config.SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      if (cookie.bc_token) {
        const result = await client.auth.getUser(cookie.bc_token);
        owner = result.data.user?.id || null;
      }
      if (!owner && cookie.bc_refresh) {
        const result = await client.auth.refreshSession({
          refresh_token: cookie.bc_refresh,
        });
        if (result.data.session && result.data.user) {
          owner = result.data.user.id;
          setCookie(res, "bc_token", result.data.session.access_token);
          setCookie(res, "bc_refresh", result.data.session.refresh_token);
        }
      }
    } else if (cookie.bc_session)
      owner = await store.session(hash(cookie.bc_session));
    ensure(owner, "Start a workspace session to continue.", 401);
    res.locals.session = { owner, csrf: sign(owner) } satisfies Session;
    if (!["GET", "HEAD"].includes(req.method))
      ensure(
        equal(req.get("x-csrf-token") || "", sign(owner)),
        "The session token is missing or expired.",
        403,
      );
    next();
  });
  const owner = (res: Response) => (res.locals.session as Session).owner;
  async function get(req: Request, res: Response) {
    const p = await store.get(idSchema.parse(req.params.id), owner(res));
    const role = await store.role(p.workspaceId, owner(res));
    ensure(role, "Purchase not found.", 404);
    res.locals.role = role;
    if (!["GET", "HEAD"].includes(req.method) && role !== "owner") {
      const route = String(req.route.path);
      const allowed =
        req.method === "DELETE"
          ? []
          : /\/(reveal|award|invoice|merchant)(\/|$)/.test(route)
            ? ["approver"]
            : /\/(confirm|freeze|explain)$/.test(route)
              ? ["reviewer"]
              : /\/(brief|proposals|analyze)$/.test(route)
                ? ["curator"]
                : [];
      ensure(
        allowed.includes(role),
        "Your workspace role does not allow this action.",
        403,
      );
    }
    return p;
  }
  async function save(p: Purchase, old: number) {
    p.version = old + 1;
    await store.save(p, old);
  }
  function version(req: Request, p: Purchase) {
    const parsed = z.coerce
      .number()
      .int()
      .positive()
      .safeParse(req.get("if-match"));
    ensure(
      parsed.success && parsed.data === p.version,
      "This purchase changed. Refresh and review before continuing.",
      409,
    );
  }
  const respond = (res: Response, p: Purchase) =>
    res.json({ ...publicPurchase(p), accessRole: res.locals.role || "owner" });
  app.get("/api/session", (_req, res) =>
    res.json({
      csrf: (res.locals.session as Session).csrf,
      mode: config.STORAGE_MODE,
      userId: owner(res),
    }),
  );
  app.get("/api/capabilities", (_req, res) =>
    res.json({
      mode: config.STORAGE_MODE,
      ai: ai.capabilities(),
      paypal: {
        configuredVendors: Object.keys(config.vendors),
        qualified: false,
      },
      syntheticOnly: true,
    } satisfies Capability),
  );
  app.get("/api/purchases", async (_req, res) =>
    res.json(
      (await store.list(owner(res))).map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        createdAt: p.createdAt,
      })),
    ),
  );
  app.post("/api/purchases", async (req, res) => {
    const body = z
      .object({ reference: z.boolean().default(true) })
      .strict()
      .parse(req.body);
    ensure(
      (await store.list(owner(res))).length < 20,
      "This workspace has reached its purchase limit.",
      429,
    );
    const p = createPurchase(owner(res), body.reference);
    await store.save(p, null);
    respond(res, p);
  });
  app.get("/api/purchases/:id", async (req, res) =>
    respond(res, await get(req, res)),
  );
  app.delete("/api/purchases/:id", async (req, res) => {
    const p = await get(req, res);
    version(req, p);
    z.object({ confirm: z.literal("DELETE") })
      .strict()
      .parse(req.body);
    await store.remove(p, p.version);
    const pending = await cleanupDocuments().catch(() => 1);
    res.json({ deleted: true, documentCleanupPending: pending > 0 });
  });
  app.post("/api/purchases/:id/brief", async (req, res) => {
    const p = await get(req, res);
    version(req, p);
    commitBrief(p, req.body, owner(res));
    await save(p, p.version);
    respond(res, p);
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
      fields: 5,
      fieldSize: 2000,
    },
  });
  let uploadBusy = false;
  app.post(
    "/api/purchases/:id/proposals",
    (_req, res, next) => {
      if (uploadBusy)
        return next(
          new AppError(429, "Another PDF is being prepared. Retry shortly."),
        );
      uploadBusy = true;
      const release = () => {
        uploadBusy = false;
      };
      res.once("finish", release);
      res.once("close", release);
      next();
    },
    upload.single("file"),
    async (req, res) => {
      const p = await get(req, res);
      version(req, p);
      mutable(p);
      ensure(
        p.rubricCommitted,
        "Commit the rubric before uploading proposals.",
      );
      ensure(
        p.proposals.length < 3,
        "This purchase already contains three proposals.",
      );
      ensure(req.file, "Choose a PDF.", 422);
      const body = z
        .object({
          supplierName: z.string().trim().min(2).max(120),
          supplierEmail: z.string().email(),
          identityTerms: z.string().max(1000).default(""),
          synthetic: z.literal("true"),
        })
        .strict()
        .parse(req.body);
      const originalPages = await parsePDF(req.file.buffer),
        id = randomUUID();
      const proposal: Proposal = {
        id,
        alias: `Proposal ${String.fromCharCode(65 + p.proposals.length)}`,
        vendorId: "",
        identity: {
          name: body.supplierName,
          email: body.supplierEmail,
          filename: req.file.originalname.slice(0, 200),
        },
        originalPages,
        pages: originalPages.map((page) => ({
          ...page,
          text: maskIdentity(page.text, [
            body.supplierName,
            ...body.identityTerms
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
          ]),
        })),
        documentHash: hash(req.file.buffer.toString("base64")),
        documentId: await documents.put(p.workspaceId, req.file.buffer),
        provenance: "uploaded",
        facts: blankFacts(),
        requirements: p.rubric.requirements.map((r) => ({
          requirementId: r.id,
          status: "unclear",
          evidence: null,
          confirmed: false,
        })),
        risks: [],
        status: "unanalysed",
        priorIdentityExposure: true,
      };
      p.proposals.push(proposal);
      p.status = "review";
      p.assessment = undefined;
      p.explanation = undefined;
      record(
        p,
        owner(res),
        "proposal.uploaded",
        `${proposal.alias}: synthetic PDF uploaded by a curator with prior identity exposure.`,
      );
      try {
        await save(p, p.version);
      } catch (error) {
        await store.queueDocumentDelete(proposal.documentId!, p.workspaceId);
        await cleanupDocuments();
        throw error;
      }
      respond(res, p);
    },
  );
  app.post(
    "/api/purchases/:id/proposals/:proposalId/analyze",
    async (req, res) => {
      const p = await get(req, res);
      version(req, p);
      mutable(p);
      const proposal = proposalById(p, idSchema.parse(req.params.proposalId));
      if (proposal.analysis && proposal.status === "ready")
        return void respond(res, p);
      ensure(
        proposal.provenance !== "reference",
        "Reference facts are already curated; they are not a runtime AI analysis.",
      );
      const result = await ai.analyze(p, proposal);
      proposal.facts = Object.fromEntries(
        factKeys.map((key) => [
          key,
          { ...result.extraction.facts[key], confirmed: false },
        ]),
      ) as Proposal["facts"];
      proposal.requirements = result.extraction.requirements.map((r) => ({
        ...r,
        confirmed: false,
      }));
      proposal.risks = result.extraction.risks;
      proposal.analysis = result.analysis;
      proposal.status = "ready";
      p.explanation = undefined;
      record(
        p,
        owner(res),
        "analysis.completed",
        `${proposal.alias}: ${result.analysis.provider}/${result.analysis.model}; source quotations validated. Human review still required.`,
      );
      await save(p, p.version);
      respond(res, p);
    },
  );
  app.post(
    "/api/purchases/:id/proposals/:proposalId/confirm",
    async (req, res) => {
      const p = await get(req, res);
      version(req, p);
      confirmProposal(
        p,
        idSchema.parse(req.params.proposalId),
        req.body,
        owner(res),
      );
      await save(p, p.version);
      respond(res, p);
    },
  );
  app.get(
    "/api/purchases/:id/proposals/:proposalId/document",
    async (req, res) => {
      const p = await get(req, res);
      ensure(
        ["revealed", "awarded"].includes(p.status),
        "Original documents are restricted until the identity reveal.",
        403,
      );
      const proposal = proposalById(p, idSchema.parse(req.params.proposalId));
      const bytes = proposal.documentId
        ? await documents.get(proposal.documentId, p.workspaceId)
        : referencePDF(proposal.originalPages);
      res
        .type("application/pdf")
        .setHeader(
          "Content-Disposition",
          'attachment; filename="proposal.pdf"',
        );
      res.send(bytes);
    },
  );
  app.post("/api/purchases/:id/freeze", async (req, res) => {
    const p = await get(req, res);
    version(req, p);
    freezeAssessment(p, req.body, owner(res));
    await save(p, p.version);
    respond(res, p);
  });
  app.post("/api/purchases/:id/explain", async (req, res) => {
    const p = await get(req, res);
    version(req, p);
    const explanation = await ai.explain(p);
    if (p.explanation === explanation) return void respond(res, p);
    p.explanation = explanation;
    record(
      p,
      owner(res),
      "tradeoffs.explained",
      `${explanation.analysis.provider}/${explanation.analysis.model}; cited source IDs checked. Prose requires human review.`,
    );
    await save(p, p.version);
    respond(res, p);
  });
  app.post("/api/purchases/:id/reveal", async (req, res) => {
    const p = await get(req, res);
    version(req, p);
    revealIdentities(p, owner(res));
    await save(p, p.version);
    respond(res, p);
  });
  app.post("/api/purchases/:id/award", async (req, res) => {
    const p = await get(req, res);
    version(req, p);
    approveAward(p, req.body, owner(res));
    await save(p, p.version);
    respond(res, p);
  });
  app.post("/api/purchases/:id/invoice", async (req, res) => {
    const p = await get(req, res);
    version(req, p);
    ensure(p.award, "A human-approved award is required.");
    ensure(
      p.award.depositCents > 0,
      "No deposit is due under this award. No deposit invoice is required.",
    );
    const body = z
      .object({
        mode: z.enum(["simulation", "paypal-sandbox"]),
        mismatch: z.boolean().default(false),
      })
      .strict()
      .parse(req.body);
    if (p.invoice) return void respond(res, p);
    if (body.mode === "simulation") {
      ensure(
        p.synthetic,
        "Simulation is only available for synthetic purchases.",
      );
      ensure(
        !p.invoiceAttempt,
        "A real invoice attempt exists; simulation cannot replace it.",
      );
      p.invoice = simulatedInvoice(p, body.mismatch);
      record(
        p,
        owner(res),
        "simulation.invoice_created",
        "Synthetic invoice scenario. No PayPal call or payment has occurred.",
      );
      await save(p, p.version);
    } else {
      const vendor = proposalById(p, p.award.proposalId);
      ensure(
        config.vendors[vendor.vendorId],
        "No configured sandbox connection exists for this supplier.",
        503,
      );
      const newAttempt = !p.invoiceAttempt;
      if (newAttempt) {
        p.invoiceAttempt = {
          requestId: randomUUID(),
          requestedCents: body.mismatch
            ? Math.round(p.award.totalCents / 2)
            : p.award.depositCents,
          state: "pending",
        };
        record(
          p,
          owner(res),
          "invoice.attempt_started",
          "Durable supplier sandbox invoice request recorded before contacting PayPal.",
        );
        await save(p, p.version);
      }
      const attempt = p.invoiceAttempt!;
      try {
        p.invoice = newAttempt
          ? await paypal.draft(
              p,
              vendor.vendorId,
              attempt.requestId,
              attempt.requestedCents,
            )
          : await paypal.recoverDraft(
              p,
              vendor.vendorId,
              attempt.requestedCents,
            );
      } catch (error) {
        attempt.state = "uncertain";
        record(
          p,
          owner(res),
          "invoice.uncertain",
          "Upstream result is uncertain. Recover by the recorded award and invoice number; no new invoice will be created on retry.",
        );
        await save(p, p.version);
        throw error;
      }
      attempt.state = "complete";
      record(
        p,
        owner(res),
        "invoice.identity_recorded",
        "Supplier invoice identity persisted before authoritative reconciliation.",
      );
      await save(p, p.version);
      try {
        p.invoice = await paypal.read(p, vendor.vendorId, p.invoice);
      } catch {
        // The persisted unknown state is safe to display and recover with a GET.
        // Never repeat creation because a subsequent read was unavailable.
        return void respond(res, p);
      }
      record(
        p,
        owner(res),
        "invoice.created",
        "Supplier sandbox invoice retrieved and checked against the approved award.",
      );
      await save(p, p.version);
    }
    respond(res, p);
  });
  app.post("/api/purchases/:id/merchant", async (req, res) => {
    const p = await get(req, res);
    version(req, p);
    ensure(
      p.award && !p.invoice && !p.invoiceAttempt,
      "Bind the supplier after award approval and before any invoice attempt.",
    );
    const { vendorId } = z
      .object({ vendorId: z.enum(["A", "B", "C"]) })
      .strict()
      .parse(req.body);
    const merchant = config.vendors[vendorId];
    ensure(
      merchant,
      "That sandbox merchant connection is not configured.",
      422,
    );
    const proposal = proposalById(p, p.award.proposalId);
    ensure(
      proposal.provenance === "uploaded",
      "Reference suppliers already have fixed sandbox connection bindings.",
    );
    ensure(
      proposal.identity.email.toLowerCase() === merchant.email.toLowerCase(),
      "The reviewed supplier email must match the configured sandbox merchant email.",
      422,
    );
    proposal.vendorId = vendorId;
    record(
      p,
      owner(res),
      "merchant.bound",
      `${proposal.alias}: reviewed supplier email matched sandbox connection ${vendorId}.`,
    );
    await save(p, p.version);
    respond(res, p);
  });
  app.post("/api/purchases/:id/invoice/:action", async (req, res) => {
    const p = await get(req, res);
    version(req, p);
    ensure(p.invoice && p.award, "Create the supplier invoice first.");
    const action = z
      .enum(["correct", "send", "refresh", "pay-link"])
      .parse(req.params.action);
    const invoice = p.invoice;
    if (invoice.provider === "simulation") {
      ensure(
        p.synthetic,
        "Simulation is restricted to the synthetic reference pack.",
      );
      if (action === "correct") {
        ensure(
          ["draft", "mismatch"].includes(invoice.state),
          "Only an unpublished supplier draft can be corrected.",
        );
        invoice.requestedCents = invoice.expectedCents;
        invoice.mismatch = [];
        invoice.state = "draft";
      }
      if (action === "send") {
        ensure(
          !invoice.mismatch.length && invoice.state === "draft",
          "Invoice mismatch: publication is blocked.",
        );
        invoice.state = "sent";
      }
      ensure(
        action !== "pay-link",
        "Simulation cannot produce a PayPal payment or a paid receipt.",
        422,
      );
      invoice.lastReconciledAt = new Date().toISOString();
      record(
        p,
        owner(res),
        `simulation.invoice_${action}`,
        "Local invoice scenario only. No PayPal transaction occurred.",
      );
    } else {
      const vendor = proposalById(p, invoice.proposalId);
      p.invoice =
        action === "correct"
          ? await paypal.correct(p, vendor.vendorId, invoice)
          : action === "send"
            ? await paypal.send(p, vendor.vendorId, invoice)
            : await paypal.read(p, vendor.vendorId, invoice);
      record(
        p,
        owner(res),
        `invoice.${action}`,
        `Authoritative PayPal invoice state: ${p.invoice.state}.`,
      );
    }
    await save(p, p.version);
    if (action === "pay-link") {
      ensure(
        p.invoice.state === "sent" &&
          !p.invoice.mismatch.length &&
          p.invoice.payerUrl,
        "No safe payable invoice link is available.",
      );
      return void res.json({ url: p.invoice.payerUrl });
    }
    respond(res, p);
  });
  app.get("/api/purchases/:id/export", async (req, res) => {
    const p = await get(req, res),
      visible = publicPurchase(p);
    const payload = {
      application: "Bidcairn",
      exportedAt: new Date().toISOString(),
      warning:
        "Application audit record, not tamper-proof or legal certification. Reference facts and simulated invoices are explicitly labeled.",
      purchase: visible,
      scores: p.proposals.map((proposal) => ({
        proposalId: proposal.id,
        ...scoreProposal(proposal, p.rubric),
      })),
    };
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="bidcairn-decision-record.json"',
    );
    res.json({ ...payload, contentHash: hash(payload) });
  });
  app.use("/api", (_req, _res, next) =>
    next(new AppError(404, "API endpoint not found.")),
  );
  const clientDir = resolve("dist/client");
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir, { etag: true, maxAge: "1h" }));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve(clientDir, "index.html")),
    );
  }
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        ["entity.parse.failed", "entity.too.large"].includes(String(error.type))
      )
        return void res
          .status(error.type === "entity.too.large" ? 413 : 400)
          .json({
            error: "The request body is invalid or too large.",
            code: "INVALID_BODY",
          });
      if (error instanceof z.ZodError)
        return void res.status(422).json({
          error: error.issues[0]?.message || "Invalid request.",
          code: "VALIDATION_FAILED",
        });
      if (error instanceof AppError)
        return void res
          .status(error.status)
          .json({ error: error.message, code: error.code });
      if (error instanceof multer.MulterError)
        return void res.status(422).json({
          error: "Upload one PDF up to 10 MB.",
          code: "INVALID_UPLOAD",
        });
      console.error(
        JSON.stringify({
          errorType: error instanceof Error ? error.name : "UnknownError",
        }),
      );
      res.status(500).json({
        error:
          "The operation could not be completed. Saved state has not been replaced.",
        code: "INTERNAL_ERROR",
      });
    },
  );
  return { app, store, ai, paypal, cleanupDocuments };
}
