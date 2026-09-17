// src/tema5-tari-monede-fusuri/tools.ts
//
// ═══════════════════════════════════════════════════════════════════════
// TEMA 5 · ȚĂRI, MONEDE ȘI FUSURI ORARE — TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════
//
// Data sources:
//   - countryInfo: FAKE — a hardcoded table of 9 countries (in-memory).
//   - convertCurrency: REAL — Frankfurter (https://api.frankfurter.dev),
//     free, public, no API key required.
//   - localTime: no external API — computed locally with Intl.
//
// Three tools, chained the way the assignment describes:
//   countryInfo(tara)              -> capitala, moneda (cod ISO), fus orar
//   convertCurrency(suma, din, in) -> curs valutar real, prin Frankfurter
//   localTime(fus)                 -> ora locală, cu Intl.DateTimeFormat
//
// HARD DEPENDENCY CHAIN (the assignment's extra requirement #1):
//   convertCurrency and localTime CANNOT be called correctly until
//   countryInfo has returned — the model has no way to know "Japonia" ->
//   moneda "JPY" or fus "Asia/Tokyo" without asking first. There is no
//   shortcut: an agent that tries to skip straight to
//   convertCurrency(500, "RON", "JPY") is only right by coincidence of
//   already knowing JPY; for any country it hasn't memorized, guessing
//   fails or silently returns the wrong rate. See agent.ts / workflow.ts /
//   workflowlangchain.ts, which log the ORDER of tool calls so you can
//   check whether countryInfo really was called first.
//
// NAMING MISMATCH the model must bridge (the assignment's extra
// requirement #2): countryInfo takes a country NAME in Romanian, but
// convertCurrency and localTime need the ISO currency code / IANA
// timezone STRING that countryInfo's own output already contains — not a
// value the model should invent from the country name itself. Both tool
// descriptions below spell this out explicitly, and the field is even
// labelled "(cod ISO)" / IANA in countryInfo's own return string, so a
// model reading the tool result has no excuse to guess.
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
// FAKE DATA — 9 countries. Keys are lowercase, no diacritics.
// ─────────────────────────────────────────────────────────────────────────
type CountryInfo = { capitala: string; moneda: string; fus: string };

const TARI: Record<string, CountryInfo> = {
  japonia: { capitala: "Tokyo", moneda: "JPY", fus: "Asia/Tokyo" },
  romania: { capitala: "București", moneda: "RON", fus: "Europe/Bucharest" },
  brazilia: { capitala: "Brasília", moneda: "BRL", fus: "America/Sao_Paulo" },
  germania: { capitala: "Berlin", moneda: "EUR", fus: "Europe/Berlin" },
  franta: { capitala: "Paris", moneda: "EUR", fus: "Europe/Paris" },
  "marea britanie": {
    capitala: "Londra",
    moneda: "GBP",
    fus: "Europe/London",
  },
  "statele unite": {
    capitala: "Washington D.C.",
    moneda: "USD",
    fus: "America/New_York",
  },
  china: { capitala: "Beijing", moneda: "CNY", fus: "Asia/Shanghai" },
  india: { capitala: "New Delhi", moneda: "INR", fus: "Asia/Kolkata" },
};

// User-friendly variants that map to the canonical keys above.
const COUNTRY_ALIASES: Record<string, string> = {
  anglia: "marea britanie",
  "regatul unit": "marea britanie",
  uk: "marea britanie",
  sua: "statele unite",
  america: "statele unite",
  usa: "statele unite",
};

function normalizeCountry(input: string): string {
  const key = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  return COUNTRY_ALIASES[key] ?? key;
}

// ─────────────────────────────────────────────────────────────────────────
// TOOL 1 — countryInfo(tara)
// ─────────────────────────────────────────────────────────────────────────
export const countryInfo = tool(
  async ({ country }: { country: string }) => {
    const key = normalizeCountry(country);
    const info = TARI[key];
    if (!info) {
      return (
        `No data for country "${country}". Known countries: ` +
        `${Object.keys(TARI).join(", ")}.`
      );
    }

    return (
      `${country}: capitala=${info.capitala}, moneda=${info.moneda} ` +
      `(cod ISO, 3 litere), fus orar=${info.fus} (IANA).`
    );
  },
  {
    name: "countryInfo",
    description:
      "Look up a country's capital, currency, and timezone from a fixed " +
      "table. Call this FIRST whenever the user names a country and " +
      "before convertCurrency or localTime — those two need the exact " +
      "`moneda` (ISO currency code) and `fus` (IANA timezone) strings " +
      "this tool returns. Do NOT guess a currency code or timezone from " +
      "the country name yourself; always read them from this tool's " +
      "output first.\n" +
      'Example input: { "country": "Japonia" }\n' +
      "Example output: Japonia: capitala=Tokyo, moneda=JPY (cod ISO, 3 " +
      "litere), fus orar=Asia/Tokyo (IANA).",
    schema: z.object({
      country: z
        .string()
        .describe(
          'Country name in Romanian, e.g. "Japonia", "România", ' +
            '"Brazilia". Known countries: Japonia, România, Brazilia, ' +
            "Germania, Franța, Marea Britanie (or Anglia/UK), Statele " +
            "Unite (or SUA/America), China, India.",
        ),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────
// TOOL 2 — convertCurrency(suma, din, in)
// Real exchange rate via Frankfurter (https://api.frankfurter.dev).
// ─────────────────────────────────────────────────────────────────────────
export const convertCurrency = tool(
  async ({
    amount,
    from,
    to,
  }: {
    amount: number;
    from: string;
    to: string;
  }) => {
    const fromCode = from.trim().toUpperCase();
    const toCode = to.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(fromCode) || !/^[A-Z]{3}$/.test(toCode)) {
      return (
        `"${from}" / "${to}" must be 3-letter ISO currency codes (e.g. ` +
        `"RON", "JPY", "EUR"), not country names. If you only know the ` +
        `country, call countryInfo first and use its "moneda" field.`
      );
    }

    try {
      const res = await fetch(
        `https://api.frankfurter.dev/v1/latest?amount=${amount}&from=${fromCode}&to=${toCode}`,
      );
      const data = await res.json();
      const result = data?.rates?.[toCode];
      if (result == null) {
        return (
          `Could not convert ${fromCode}→${toCode}. Double-check both are ` +
          `valid ISO currency codes (from countryInfo, not invented).`
        );
      }
      return `${amount} ${fromCode} = ${result} ${toCode} (today's rate).`;
    } catch {
      return `Could not get the rate ${fromCode}→${toCode} (network error).`;
    }
  },
  {
    name: "convertCurrency",
    description:
      "Convert an amount from one currency to another, at TODAY's real " +
      "exchange rate. Takes 3-LETTER ISO CURRENCY CODES for `from`/`to` " +
      "(e.g. \"RON\", \"JPY\") — NEVER a country name. If you know a " +
      "currency only by its country (e.g. \"Japan's currency\"), call " +
      "countryInfo FIRST and use the exact `moneda` code it returns; do " +
      "not invent an ISO code yourself.\n" +
      'Example input: { "amount": 500, "from": "RON", "to": "JPY" }\n' +
      "Example output: 500 RON = 16994 JPY (today's rate).",
    schema: z.object({
      amount: z.number().describe("The amount to convert, e.g. 500."),
      from: z
        .string()
        .describe(
          '3-letter ISO source currency code, e.g. "RON". Get this from ' +
            "countryInfo's `moneda` field if you only know the country.",
        ),
      to: z
        .string()
        .describe(
          '3-letter ISO target currency code, e.g. "JPY". Get this from ' +
            "countryInfo's `moneda` field if you only know the country.",
        ),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────
// TOOL 3 — localTime(fus)
// No external API — computed locally with Intl.DateTimeFormat.
// ─────────────────────────────────────────────────────────────────────────
export const localTime = tool(
  async ({ zone }: { zone: string }) => {
    try {
      const now = new Intl.DateTimeFormat("ro-RO", {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        weekday: "long",
      }).format(new Date());
      return `Ora locală în ${zone}: ${now}.`;
    } catch {
      return (
        `Unknown timezone "${zone}". Use IANA format, e.g. "Asia/Tokyo". ` +
        `If you only know the country, call countryInfo first and use ` +
        `its "fus" field.`
      );
    }
  },
  {
    name: "localTime",
    description:
      "Return the current local time for an IANA timezone (e.g. " +
      '"Asia/Tokyo", "Europe/Bucharest"). Call this when the user asks ' +
      "what time it is somewhere. If you only know the country, call " +
      "countryInfo FIRST and use the exact `fus` string it returns; do " +
      "not guess a timezone from the country name yourself.\n" +
      'Example input: { "zone": "Asia/Tokyo" }\n' +
      'Example output: Ora locală în Asia/Tokyo: luni, 14:32.',
    schema: z.object({
      zone: z
        .string()
        .describe(
          'IANA timezone, e.g. "Asia/Tokyo". Get this from countryInfo\'s ' +
            "`fus` field if you only know the country.",
        ),
    }),
  },
);

// All tools, ready to hand to the model.
export const countryTools = [countryInfo, convertCurrency, localTime];
