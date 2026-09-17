// src/tema3-meniu-cantina/tools.ts
//
// ═══════════════════════════════════════════════════════════════════════
// TEMA 3 · MENIUL DE LA CANTINĂ — TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════
//
// Data source: FAKE — all data below is hardcoded in this file (in-memory
// array), there is no real canteen system behind it.
//
// Three tools, chained the way the assignment describes:
//   todayMenu()          -> today's dishes, each with an ID. Takes NO
//                           arguments — the menu is the same for everyone.
//   dishAllergens(id)    -> the allergens of ONE dish (single ID on
//                           purpose — see below).
//   calculateBill(ids[]) -> total price for a list of dish IDs.
//
// dishAllergens takes a SINGLE id (unlike tema1's searchBook/authorWorks,
// which take arrays) precisely so the agentic variant is FORCED to make
// one call per dish — that's what the assignment's extra requirement is
// testing: "numărul de apeluri trebuie să depindă de câte feluri întoarce
// todayMenu()". With N dishes on the menu, answering "what can I eat if
// I'm allergic to X" costs 1 (todayMenu) + N (dishAllergens) tool calls.
//
// All 5 variants in this folder (agent.ts, workflow.ts, workflowlangchain.ts,
// pipeline.ts, pipelinelangchain.ts) import these SAME tools, unchanged.
//
// Each tool follows the lab's rules:
//   1. Invalid input -> a readable message that includes valid examples.
//   2. description = what it does + when to call it + argument format +
//      one example input/output.
//   3. Every zod field has .describe().

import { tool } from "@langchain/core/tools";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────
// FAKE DATA — today's menu. Change the length of this array and every
// agentic variant automatically makes a different number of dishAllergens
// calls; the pipeline variants don't care, they only ever look at [0].
// ─────────────────────────────────────────────────────────────────────────
type Dish = {
  id: string;
  name: string;
  price: number; // RON
  allergens: string[]; // empty array = no known allergens
};

const MENU: Dish[] = [
  { id: "F1", name: "Ciorbă de legume", price: 12, allergens: [] },
  {
    id: "F2",
    name: "Șnițel de pui cu cartofi",
    price: 22,
    allergens: ["gluten", "ou"],
  },
  {
    id: "F3",
    name: "Salată Caesar",
    price: 18,
    allergens: ["lactoză", "ou", "gluten"],
  },
  {
    id: "F4",
    name: "Paste Carbonara",
    price: 20,
    allergens: ["lactoză", "gluten", "ou"],
  },
  {
    id: "F5",
    name: "Supă cremă de ciuperci",
    price: 14,
    allergens: ["lactoză", "gluten"],
  },
];

const dishById = new Map(MENU.map((d) => [d.id, d]));

// ─────────────────────────────────────────────────────────────────────────
// TOOL 1 — todayMenu()
// No arguments — today's menu is the same for every call.
// ─────────────────────────────────────────────────────────────────────────
export const todayMenu = tool(
  async () => {
    return MENU.map((d) => `${d.id}: ${d.name} — ${d.price} RON`).join("\n");
  },
  {
    name: "todayMenu",
    description:
      "List today's dishes, each with its ID and price. Call this FIRST " +
      "whenever the user asks what's on the menu, or before dishAllergens " +
      "/ calculateBill (which both need dish IDs this tool returns). Takes " +
      "no arguments.\n" +
      "Example input: {}\n" +
      "Example output:\n" +
      "F1: Ciorbă de legume — 12 RON\n" +
      "F2: Șnițel de pui cu cartofi — 22 RON",
    schema: z.object({}),
  },
);

// ─────────────────────────────────────────────────────────────────────────
// TOOL 2 — dishAllergens(id)
// Deliberately takes a SINGLE id — see the note at the top of the file.
// ─────────────────────────────────────────────────────────────────────────
export const dishAllergens = tool(
  async ({ id }: { id: string }) => {
    const normalized = id.trim().toUpperCase();
    if (!/^F\d+$/.test(normalized)) {
      return (
        `"${id}" is not a valid dish ID. Dish IDs look like "F1" (the ` +
        `letter "F" followed by a number). Call todayMenu first to see ` +
        `the valid IDs.`
      );
    }

    const dish = dishById.get(normalized);
    if (!dish) {
      return (
        `No dish found with ID "${normalized}". Known IDs today: ` +
        `${MENU.map((d) => d.id).join(", ")}.`
      );
    }

    return dish.allergens.length
      ? `${dish.name} (${dish.id}) contains: ${dish.allergens.join(", ")}.`
      : `${dish.name} (${dish.id}) has no known allergens.`;
  },
  {
    name: "dishAllergens",
    description:
      "Return the allergens of ONE dish, by ID. Call this AFTER " +
      "todayMenu, once PER dish you need to check — this tool takes a " +
      "single ID, not a list, so checking every dish on the menu takes " +
      "one call per dish.\n" +
      'Example input: { "id": "F3" }\n' +
      'Example output: Salată Caesar (F3) contains: lactoză, ou, gluten.',
    schema: z.object({
      id: z
        .string()
        .describe(
          'Dish ID in the format "F1" (letter "F" + a number), as ' +
            "returned by todayMenu. Case-insensitive.",
        ),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────
// TOOL 3 — calculateBill(ids[])
// ─────────────────────────────────────────────────────────────────────────
export const calculateBill = tool(
  async ({ ids }: { ids: string[] }) => {
    if (!ids?.length) {
      return (
        'No dish IDs given. Provide at least one, e.g. ' +
        '{ "ids": ["F1", "F2"] }.'
      );
    }

    const lines: string[] = [];
    let total = 0;
    for (const rawId of ids) {
      const normalized = rawId.trim().toUpperCase();
      const dish = dishById.get(normalized);
      if (!dish) {
        lines.push(`- "${rawId}": unknown dish ID, skipped.`);
        continue;
      }
      lines.push(`- ${dish.name} (${dish.id}): ${dish.price} RON`);
      total += dish.price;
    }

    return `${lines.join("\n")}\nTotal: ${total} RON`;
  },
  {
    name: "calculateBill",
    description:
      "Compute the total price for a list of dish IDs. Call this when " +
      "the user asks how much a set of dishes costs, using IDs returned " +
      "by todayMenu.\n" +
      'Example input: { "ids": ["F1", "F2"] }\n' +
      "Example output:\n" +
      "- Ciorbă de legume (F1): 12 RON\n" +
      "- Șnițel de pui cu cartofi (F2): 22 RON\n" +
      "Total: 34 RON",
    schema: z.object({
      ids: z
        .array(z.string())
        .describe(
          'One or more dish IDs, e.g. ["F1", "F2"], as returned by ' +
            "todayMenu.",
        ),
    }),
  },
);

// All tools, ready to hand to the model.
export const canteenTools = [todayMenu, dishAllergens, calculateBill];
