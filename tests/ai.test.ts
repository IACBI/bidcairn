import { describe, expect, it } from "vitest";
import { confirmProposal } from "../server/commands.js";
import { AIService } from "../server/ai.js";
import { LocalStore } from "../server/store.js";
import { loadConfig } from "../server/config.js";
import { createPurchase } from "../server/reference.js";
import { validateEvidence } from "../server/evidence.js";
import type { Extraction } from "../shared/model.js";
describe("provider and evidence boundaries", () => {
  it("does not call a provider before qualification", async () => {
    let calls = 0;
    const ai = new AIService(
      loadConfig({ AI_PROVIDER: "groq", GROQ_API_KEY: "placeholder" }),
      new LocalStore(":memory:"),
      async () => {
        calls++;
        throw new Error("unexpected");
      },
    );
    const p = createPurchase("owner");
    await expect(ai.analyze(p, p.proposals[0])).rejects.toThrow(
      /qualification/,
    );
    expect(calls).toBe(0);
  });
  it("rejects fabricated citations before they can become accepted facts", () => {
    const p = createPurchase("owner"),
      proposal = p.proposals[0];
    const extraction = {
      facts: Object.fromEntries(
        Object.entries(proposal.facts).map(([key, fact]) => [
          key,
          { value: fact.value, evidence: fact.evidence },
        ]),
      ),
      requirements: proposal.requirements.map(({ confirmed, ...r }) => r),
      risks: proposal.risks,
    } as Extraction;
    extraction.facts.totalCents.evidence = {
      page: 1,
      quote: "The total is whatever the assistant wants.",
    };
    expect(() =>
      validateEvidence(
        extraction,
        proposal.pages,
        p.rubric.requirements.map((x) => x.id),
      ),
    ).toThrow(/citation/);
  });
  it("reserves tokens and money atomically, including concurrent requests", async () => {
    const store = new LocalStore(":memory:");
    const results = await Promise.all([
      store.reserveAI("a", 10, 0.7, 100, 1),
      store.reserveAI("b", 10, 0.7, 100, 1),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.reserveAI("c", 1000, 0, 100, 1)).toBe(false);
  });
  it("refuses an expired Astropods grant without attempting network access", async () => {
    const ai = new AIService(
      loadConfig({
        AI_PROVIDER: "astropods",
        AI_QUALIFIED: "true",
        ASTRO_GATEWAY_URL: "https://gateway.example",
        ASTRO_GATEWAY_API_KEY: "placeholder",
        AI_FREE_CREDIT_USD: "20",
        AI_EVENT_BUDGET_USD: "10",
        AI_CREDIT_EXPIRES_AT: "2020-01-01",
      }),
      new LocalStore(":memory:"),
      async () => {
        throw new Error("network");
      },
    );
    const p = createPurchase("owner");
    await expect(ai.analyze(p, p.proposals[0])).rejects.toThrow(/expired/);
  });
  it("caps retries per analysis scope without resetting the global meter", async () => {
    const store = new LocalStore(":memory:");
    expect(await store.reserveAI("one", 10, 0, 100, 0, "proposal")).toBe(true);
    expect(await store.reserveAI("two", 10, 0, 100, 0, "proposal")).toBe(true);
    expect(await store.reserveAI("three", 10, 0, 100, 0, "proposal")).toBe(
      false,
    );
    expect(
      await store.reserveAI("other", 10, 0, 100, 0, "other-proposal"),
    ).toBe(true);
  });
  it("accepts a fully source-verifiable strict response and accounts for failed calls", async () => {
    const p = createPurchase("owner"),
      proposal = p.proposals[0];
    const store = new LocalStore(":memory:");
    let calls = 0;
    const ai = new AIService(
      loadConfig({
        AI_PROVIDER: "groq",
        GROQ_API_KEY: "placeholder",
        AI_QUALIFIED: "true",
        AI_MAX_INPUT_TOKENS: "6000",
      }),
      store,
      async (_url, options) => {
        calls++;
        const body = JSON.parse(String(options?.body));
        expect(body.response_format.json_schema.strict).toBe(true);
        expect(body.tools).toBeUndefined();
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  facts: Object.fromEntries(
                    Object.entries(proposal.facts).map(([key, f]) => [
                      key,
                      { value: f.value, evidence: f.evidence },
                    ]),
                  ),
                  requirements: proposal.requirements.map(
                    ({ confirmed, ...r }) => r,
                  ),
                  risks: proposal.risks,
                }),
              },
            },
          ],
          usage: { prompt_tokens: 1000, completion_tokens: 500 },
        });
      },
    );
    const result = await ai.analyze(p, proposal);
    expect(result.analysis.provider).toBe("groq");
    expect(calls).toBe(1);
    expect(
      store.db.prepare("SELECT count(*) AS n FROM ai_reservations").get()?.n,
    ).toBe(1);
  });
  it("persists source references for explanations and reuses an identical saved result", async () => {
    const p = createPurchase("owner");
    for (const proposal of p.proposals)
      confirmProposal(p, proposal.id, {}, "reviewer");
    let calls = 0;
    const ai = new AIService(
      loadConfig({
        AI_PROVIDER: "groq",
        GROQ_API_KEY: "placeholder",
        AI_QUALIFIED: "true",
        AI_MAX_INPUT_TOKENS: "6000",
      }),
      new LocalStore(":memory:"),
      async (_url, options) => {
        calls++;
        const input = JSON.parse(
          JSON.parse(String(options?.body)).messages[1].content,
        );
        expect(input.sources[0].evidence).toBeUndefined();
        return Response.json({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify({
                  items: [
                    {
                      text: "Compare the confirmed commercial terms alongside the committed cash limit.",
                      evidenceIds: [input.sources[0].id],
                    },
                  ],
                }),
              },
            },
          ],
        });
      },
    );
    p.explanation = await ai.explain(p);
    expect(p.explanation.sources[0].evidence).toBeTruthy();
    expect(await ai.explain(p)).toBe(p.explanation);
    expect(calls).toBe(1);
  });
});
