// src/tema4-livrari/tools.ts
//
// ═══════════════════════════════════════════════════════════════════════
// TEMA 4 · LIVRĂRI — TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════
//
// Data source: FAKE — all data below is hardcoded in this file (in-memory
// objects), there is no real courier system behind it.
//
// Three tools, chained the way the assignment describes:
//   trackParcel(awb)              -> where the parcel currently is.
//   findPickupPoint(oraș)         -> pickup points available in a city.
//   changeDelivery(awb, punct)    -> redirect a parcel to a pickup point.
//                                    IRREVERSIBLE — see the preconditions
//                                    spelled out in its description below.
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
// FAKE DATA
// ─────────────────────────────────────────────────────────────────────────

type Parcel = {
  status: "In Transit" | "Out for Delivery" | "Delivered" | "Redirected";
  location: string;
  destinationCity: string;
};

// Keyed by AWB (tracking number).
const PARCELS: Record<string, Parcel> = {
  "12345": {
    status: "In Transit",
    location: "Depozit de sortare Cluj-Napoca",
    destinationCity: "Cluj-Napoca",
  },
  "67890": {
    status: "Delivered",
    location: "Livrat la adresă",
    destinationCity: "București",
  },
  "11111": {
    status: "Out for Delivery",
    location: "Curier în oraș",
    destinationCity: "Iași",
  },
};

// Keyed by canonical city name.
const PICKUP_POINTS: Record<string, string[]> = {
  "Cluj-Napoca": ["Locker Iulius Mall", "Locker VIVO", "Punct Poștă Centrală"],
  "București": ["Locker Mega Mall", "Locker AFI Cotroceni"],
  "Iași": ["Locker Palas Mall"],
};

// Accepts city names typed without diacritics ("Cluj", "Bucuresti") and
// maps them to the canonical key used in PICKUP_POINTS above.
function stripDiacritics(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const CITY_ALIASES: Record<string, string> = {
  cluj: "Cluj-Napoca",
  "cluj-napoca": "Cluj-Napoca",
  bucuresti: "București",
  iasi: "Iași",
};

function resolveCity(input: string): string | null {
  const key = stripDiacritics(input);
  return CITY_ALIASES[key] ?? null;
}

function pickupPointsFor(city: string): string[] {
  return PICKUP_POINTS[city] ?? [];
}

// ─────────────────────────────────────────────────────────────────────────
// TOOL 1 — trackParcel(awb)
// ─────────────────────────────────────────────────────────────────────────
export const trackParcel = tool(
  async ({ awb }: { awb: string }) => {
    const normalized = awb.trim();
    if (!/^\d{4,8}$/.test(normalized)) {
      return (
        `"${awb}" is not a valid AWB. An AWB is 4-8 digits, e.g. "12345".`
      );
    }

    const parcel = PARCELS[normalized];
    if (!parcel) {
      return (
        `No parcel found with AWB "${normalized}". Known example AWBs: ` +
        `"12345", "67890", "11111".`
      );
    }

    return (
      `Parcel ${normalized}: status=${parcel.status}, ` +
      `location=${parcel.location}, destination city=${parcel.destinationCity}.`
    );
  },
  {
    name: "trackParcel",
    description:
      "Look up where a parcel currently is, by AWB (tracking number). " +
      "Call this FIRST whenever the user mentions a tracking number, and " +
      "before changeDelivery — you need the parcel's status and " +
      "destination city from here before redirecting it anywhere.\n" +
      'Example input: { "awb": "12345" }\n' +
      'Example output: Parcel 12345: status=In Transit, location=Depozit ' +
      "de sortare Cluj-Napoca, destination city=Cluj-Napoca.",
    schema: z.object({
      awb: z
        .string()
        .describe('AWB / tracking number, 4-8 digits, e.g. "12345".'),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────
// TOOL 2 — findPickupPoint(oraș)
// ─────────────────────────────────────────────────────────────────────────
export const findPickupPoint = tool(
  async ({ city }: { city: string }) => {
    const resolved = resolveCity(city);
    if (!resolved) {
      return (
        `Unknown city "${city}". Known cities: ` +
        `${Object.keys(PICKUP_POINTS).join(", ")}.`
      );
    }

    const points = pickupPointsFor(resolved);
    return `Pickup points in ${resolved}: ${points.join(", ")}.`;
  },
  {
    name: "findPickupPoint",
    description:
      "List the pickup points (lockers, post office counters) available " +
      "in a city. Call this when the user wants to pick up a parcel " +
      "instead of home delivery, and BEFORE changeDelivery — you need an " +
      "exact pickup point name from here (matching the parcel's " +
      "destination city) before redirecting a parcel to it.\n" +
      'Example input: { "city": "Cluj" }\n' +
      "Example output: Pickup points in Cluj-Napoca: Locker Iulius Mall, " +
      "Locker VIVO, Punct Poștă Centrală.",
    schema: z.object({
      city: z
        .string()
        .describe(
          'City name, with or without diacritics, e.g. "Cluj", ' +
            '"Cluj-Napoca", "Bucuresti", "Iasi".',
        ),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────
// TOOL 3 — changeDelivery(awb, punct)
// IRREVERSIBLE — permanently changes where the parcel will be delivered.
// The preconditions below are enforced BOTH in the description (so the
// model knows to check them) AND in the function body (so a model that
// skips the checks still can't cause an inconsistent state).
// ─────────────────────────────────────────────────────────────────────────
export const changeDelivery = tool(
  async ({ awb, point }: { awb: string; point: string }) => {
    const normalizedAwb = awb.trim();
    if (!/^\d{4,8}$/.test(normalizedAwb)) {
      return (
        `"${awb}" is not a valid AWB. An AWB is 4-8 digits, e.g. "12345". ` +
        `Call trackParcel first to confirm it exists.`
      );
    }

    const parcel = PARCELS[normalizedAwb];
    if (!parcel) {
      return (
        `No parcel found with AWB "${normalizedAwb}". Call trackParcel ` +
        `first — known example AWBs: "12345", "67890", "11111".`
      );
    }

    // Precondition: an already-delivered parcel cannot be redirected.
    if (parcel.status === "Delivered") {
      return (
        `Parcel ${normalizedAwb} was already delivered — it cannot be ` +
        `redirected anymore. Nothing was changed.`
      );
    }

    // Precondition: the pickup point must be a REAL point for THIS
    // parcel's destination city, i.e. one findPickupPoint would return.
    const validPoints = pickupPointsFor(parcel.destinationCity);
    const match = validPoints.find(
      (p) => stripDiacritics(p) === stripDiacritics(point),
    );
    if (!match) {
      return (
        `"${point}" is not a valid pickup point for ${parcel.destinationCity} ` +
        `(parcel ${normalizedAwb}'s destination city). Call findPickupPoint ` +
        `for "${parcel.destinationCity}" first — valid points there: ` +
        `${validPoints.length ? validPoints.join(", ") : "none available"}.`
      );
    }

    // All preconditions met — perform the (fake, in-memory) irreversible
    // change.
    parcel.status = "Redirected";
    parcel.location = `Va fi livrat la punctul de ridicare: ${match} (${parcel.destinationCity})`;

    return (
      `Done — parcel ${normalizedAwb} was PERMANENTLY redirected to ` +
      `"${match}" in ${parcel.destinationCity}. This cannot be undone by ` +
      `calling this tool again with the old destination.`
    );
  },
  {
    name: "changeDelivery",
    description:
      "Redirect a parcel's delivery to a pickup point instead of its " +
      "original destination. THIS ACTION IS IRREVERSIBLE — it permanently " +
      "overwrites the parcel's delivery destination, there is no undo " +
      "tool. Before calling it, ALL of these must be true:\n" +
      "  1. You already called trackParcel(awb) for this AWB, and its " +
      "status is NOT \"Delivered\" (a delivered parcel can't be " +
      "redirected).\n" +
      "  2. You already called findPickupPoint for the parcel's " +
      "destination city, and the `point` you pass here is EXACTLY one of " +
      "the names it returned — do not guess or invent a pickup point " +
      "name.\n" +
      "  3. The user has clearly asked for the parcel to be redirected — " +
      "do not call this speculatively just because it exists.\n" +
      'Example input: { "awb": "12345", "point": "Locker VIVO" }\n' +
      'Example output: Done — parcel 12345 was PERMANENTLY redirected to ' +
      '"Locker VIVO" in Cluj-Napoca. This cannot be undone by calling this ' +
      "tool again with the old destination.",
    schema: z.object({
      awb: z
        .string()
        .describe(
          'AWB / tracking number, 4-8 digits, e.g. "12345". Must already ' +
            "have been looked up with trackParcel.",
        ),
      point: z
        .string()
        .describe(
          'Exact pickup point name as returned by findPickupPoint, e.g. ' +
            '"Locker VIVO". Not a city name.',
        ),
    }),
  },
);

// All tools, ready to hand to the model.
export const deliveryTools = [trackParcel, findPickupPoint, changeDelivery];
