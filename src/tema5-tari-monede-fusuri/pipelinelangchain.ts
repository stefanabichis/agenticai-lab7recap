// src/tema5-tari-monede-fusuri/pipelinelangchain.ts
//
// DETERMINISTIC — same fixed flow as pipeline.ts, but built with plain
// LangChain (LCEL) instead of a LangGraph graph.
// RunnableSequence chains the steps in a fixed order: extractCountry ->
// lookupCountry -> composeAnswer. No graph, no tool-calling loop, no
// branching, and (same as pipeline.ts) no path that ever reaches
// convertCurrency or localTime.

import "dotenv/config";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { countryInfo } from "./tools.js";

type State = {
  userQuestion: string;
  country?: string;
  countryRaw?: string;
  answer?: string;
};

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" });

// Step 1 — pull the country name out of the question (structured output).
async function extractCountry(s: State): Promise<State> {
  const structured = model.withStructuredOutput(
    z.object({ country: z.string() }),
  );
  const res = await structured.invoke([
    {
      role: "system",
      content:
        "Extract the country name from the question, in Romanian. A " +
        "single country.",
    },
    { role: "user", content: s.userQuestion },
  ]);
  return { ...s, country: res.country };
}

// Step 2 — always call countryInfo once, for that country.
async function lookupCountry(s: State): Promise<State> {
  return { ...s, countryRaw: await countryInfo.invoke({ country: s.country! }) };
}

// Step 3 — turn the raw data into a natural answer.
async function composeAnswer(s: State): Promise<State> {
  const res = await model.invoke([
    { role: "system", content: "Write a short, natural answer in English." },
    {
      role: "user",
      content: `Question: ${s.userQuestion}\nCountry data: ${s.countryRaw}`,
    },
  ]);
  return { ...s, answer: res.content as string };
}

// LCEL chain: steps run in this fixed order every time.
const chain = RunnableSequence.from([
  extractCountry,
  lookupCountry,
  composeAnswer,
]);

async function main() {
  const question =
    process.argv.slice(2).join(" ") || "Care e capitala Japoniei?";
  console.log(`\n> Question: ${question}\n`);

  const result = await chain.invoke({ userQuestion: question });

  console.log(`  Extracted country: ${result.country}`);
  console.log(`  Raw data:          ${result.countryRaw}`);
  console.log(`< Answer:            ${result.answer}\n`);
}

main().catch(console.error);
