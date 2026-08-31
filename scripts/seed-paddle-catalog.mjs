/**
 * scripts/seed-paddle-catalog.mjs
 *
 * Creates the ONCEClic MVP Paddle Sandbox catalog:
 *   - 1 product: "ONCEClic Pro" (SaaS)
 *   - 1 price:   $49.00 USD / month recurring, 7-day free trial
 *
 * Run once: node scripts/seed-paddle-catalog.mjs
 * Requires PADDLE_SANDBOX_API_KEY in environment (or reads from mcp_config.json).
 */

import { Paddle, Environment } from "@paddle/paddle-node-sdk";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";

// ── Resolve API key ──────────────────────────────────────────────────────────
// 1. Prefer explicit env var (CI / dotenv)
// 2. Fall back to reading from mcp_config.json (local dev)
function resolveApiKey() {
  if (process.env.PADDLE_SANDBOX_API_KEY) {
    return process.env.PADDLE_SANDBOX_API_KEY;
  }
  const mcpConfigPath = join(homedir(), ".gemini", "config", "mcp_config.json");
  const config = JSON.parse(readFileSync(mcpConfigPath, "utf8"));
  const auth = config?.mcpServers?.["paddle-sandbox"]?.headers?.Authorization ?? "";
  const key = auth.replace(/^Bearer\s+/i, "").trim();
  if (!key || !key.startsWith("pdl_sdbx_")) {
    throw new Error(
      "No valid Paddle Sandbox API key found. " +
      "Set PADDLE_SANDBOX_API_KEY env var or configure mcp_config.json."
    );
  }
  return key;
}

const apiKey = resolveApiKey();
const paddle = new Paddle(apiKey, { environment: Environment.sandbox });

async function seed() {
  console.log("── ONCEClic Paddle Sandbox Catalog Seed ──\n");

  // ── Create product ────────────────────────────────────────────────────────
  console.log("Creating product: ONCEClic Pro …");
  const product = await paddle.products.create({
    name: "ONCEClic Pro",
    taxCategory: "saas",
    description:
      "ONCEClic Pro — all-in-one booking and client management platform for professionals.",
  });
  console.log(`  ✓ Product created: ${product.id}  (${product.name})\n`);

  // ── Create monthly price with 7-day trial ──────────────────────────────────
  console.log("Creating price: $49.00 USD/month, 7-day trial …");
  const price = await paddle.prices.create({
    productId: product.id,
    description: "ONCEClic Pro monthly USD",
    name: "Monthly",
    unitPrice: { amount: "4900", currencyCode: "USD" }, // 4900 cents = $49.00
    billingCycle: { interval: "month", frequency: 1 },
    trialPeriod: { interval: "day", frequency: 7 },
    quantity: { minimum: 1, maximum: 1 },
  });
  console.log(`  ✓ Price created:   ${price.id}  ($${(parseInt(price.unitPrice.amount) / 100).toFixed(2)} USD/month, 7-day trial)\n`);

  // ── Read back to verify ────────────────────────────────────────────────────
  console.log("Verifying …");
  const verifiedProduct = await paddle.products.get(product.id);
  const verifiedPrice   = await paddle.prices.get(price.id);

  const ok =
    verifiedProduct.id   === product.id &&
    verifiedPrice.id     === price.id   &&
    verifiedPrice.status === "active";

  console.log(`  Product ID : ${verifiedProduct.id}  (${verifiedProduct.name}) — ${verifiedProduct.status}`);
  console.log(`  Price ID   : ${verifiedPrice.id}  — ${verifiedPrice.status}`);
  console.log(`  Amount     : $${(parseInt(verifiedPrice.unitPrice.amount) / 100).toFixed(2)} ${verifiedPrice.unitPrice.currencyCode}`);
  console.log(`  Billing    : every ${verifiedPrice.billingCycle.frequency} ${verifiedPrice.billingCycle.interval}(s)`);
  console.log(`  Trial      : ${verifiedPrice.trialPeriod.frequency} ${verifiedPrice.trialPeriod.interval}(s)`);
  console.log(`\n  Verification: ${ok ? "PASS ✓" : "FAIL ✗"}\n`);

  // ── Final output ──────────────────────────────────────────────────────────
  console.log("══════════════════════════════════════════");
  console.log("  PADDLE_PRODUCT_ID=" + product.id);
  console.log("  PADDLE_PRICE_ID="   + price.id);
  console.log("══════════════════════════════════════════");

  return { productId: product.id, priceId: price.id };
}

seed().catch((err) => {
  console.error("\n✗ Seed failed:", err?.message ?? err);
  process.exit(1);
});
