// src/tema4-livrari/pipelinelangchain.ts
//
// DETERMINISTIC — same fixed flow as pipeline.ts, but built with plain
// LangChain (LCEL) instead of a LangGraph graph.
// RunnableSequence chains the steps in a fixed order: extractAwb ->
// trackTheParcel -> composeAnswer. No graph, no tool-calling loop, no
// branching, and (same as pipeline.ts) no path that ever reaches the
// irreversible changeDelivery tool.

import "dotenv/config";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { trackParcel } from "./tools.js";

type State = {
  userQuestion: string;
  awb?: string;
  parcelRaw?: string;
  answer?: string;
};

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" });

// Step 1 — pull the AWB out of the question (structured output).
async function extractAwb(s: State): Promise<State> {
  const structured = model.withStructuredOutput(z.object({ awb: z.string() }));
  const res = await structured.invoke([
    {
      role: "system",
      content:
        "Extract the parcel AWB / tracking number from the question, as " +
        "digits only. A single AWB.",
    },
    { role: "user", content: s.userQuestion },
  ]);
  return { ...s, awb: res.awb };
}

// Step 2 — always call trackParcel once, for that AWB.
async function trackTheParcel(s: State): Promise<State> {
  return { ...s, parcelRaw: await trackParcel.invoke({ awb: s.awb! }) };
}

// Step 3 — turn the raw data into a natural answer.
async function composeAnswer(s: State): Promise<State> {
  const res = await model.invoke([
    { role: "system", content: "Write a short, natural answer in English." },
    {
      role: "user",
      content: `Question: ${s.userQuestion}\nParcel data: ${s.parcelRaw}`,
    },
  ]);
  return { ...s, answer: res.content as string };
}

// LCEL chain: steps run in this fixed order every time.
const chain = RunnableSequence.from([
  extractAwb,
  trackTheParcel,
  composeAnswer,
]);

async function main() {
  const question =
    process.argv.slice(2).join(" ") || "Coletul 12345 unde e?";
  console.log(`\n> Question: ${question}\n`);

  const result = await chain.invoke({ userQuestion: question });

  console.log(`  Extracted AWB: ${result.awb}`);
  console.log(`  Raw data:      ${result.parcelRaw}`);
  console.log(`< Answer:        ${result.answer}\n`);
}

main().catch(console.error);
