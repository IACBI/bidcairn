import { test, expect } from "@playwright/test";
test("reference purchase retains human authority and rejects mismatched invoice publication", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /Explore the reference purchase/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Website migration partner" }),
  ).toBeVisible();
  await expect(
    page.getByText("Curated reference facts · no runtime AI inference"),
  ).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await page
      .getByRole("button", { name: "Review evidence", exact: true })
      .nth(i)
      .click();
    await page
      .getByRole("button", { name: "Confirm reviewed evidence" })
      .click();
    await expect(page.getByRole("dialog")).not.toBeVisible();
  }
  await page
    .getByRole("button", { name: "Review & record a decision" })
    .click();
  const eligible = page
    .locator(".award-option")
    .filter({ hasText: "$2,200 deposit" });
  await eligible.locator("input").check();
  await page
    .getByRole("textbox", { name: /Provisional blind assessment/ })
    .fill(
      "The lower deposit and longer warranty are valuable for our migration.",
    );
  await page.getByRole("button", { name: "Freeze blind assessment" }).click();
  await page
    .getByRole("button", { name: "Reveal supplier identities" })
    .click();
  await page.getByLabel(/I checked the supplier identity/).check();
  await page
    .getByRole("textbox", { name: /Final award rationale/ })
    .fill(
      "Identity checked; the scope and payment terms fit our requirements.",
    );
  await page.getByRole("button", { name: "Approve this award" }).click();
  await page
    .getByRole("button", { name: "Check the supplier invoice" })
    .click();
  await page.getByRole("button", { name: "Load mismatch simulation" }).click();
  await expect(page.getByText("Payment action blocked")).toBeVisible();
  await page.getByRole("button", { name: "Correct supplier draft" }).click();
  await expect(
    page.getByText("Invoice terms match the approved deposit."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Simulate invoice publication" })
    .click();
  await expect(page.getByText("Nothing has been paid.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review & pay on PayPal" }),
  ).toHaveCount(0);
});

test("a purchasing brief supports explicit scope edits without triggering inference", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New purchase", exact: true }).click();
  await page
    .getByRole("button", { name: "Commit brief & rubric", exact: true })
    .click();
  await page
    .getByLabel("Purchase title", { exact: true })
    .fill("Accessibility migration review");
  await page
    .getByRole("button", { name: "Add deliverable", exact: true })
    .click();
  await page
    .getByLabel("Deliverable 6", { exact: true })
    .fill("Provide an accessibility acceptance checklist");
  await page
    .getByRole("button", { name: "Commit rubric v2", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Accessibility migration review",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Provide an accessibility acceptance checklist" }),
  ).toBeVisible();
  await expect(
    page.getByText("No runtime analysis yet", { exact: true }),
  ).toBeVisible();
});

test("mobile workflow remains visible and evidence dialogs work with keyboard dismissal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: /Explore the reference purchase/ })
    .click();
  const payment = page.getByRole("button", { name: /^Payment(?: 05)?$/ });
  await expect(payment).toBeInViewport();
  await page
    .getByRole("button", { name: "Review evidence", exact: true })
    .first()
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const dimensions = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
});
