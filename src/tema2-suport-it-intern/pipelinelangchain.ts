// src/tema2-suport-it-intern/pipelinelangchain.ts
//
// DETERMINISTIC — same fixed flow as pipeline.ts, but built with plain
// LangChain (LCEL) instead of a LangGraph graph.
// RunnableSequence chains the steps in a fixed order: extractTicketId ->
// lookupTicket -> composeAnswer. No graph, no tool-calling loop, no
// branching.

import "dotenv/config";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { findTicket } from "./tools.js";

type State = {
  userQuestion: string;
  ticketId?: string;
  ticketRaw?: string;
  answer?: string;
};

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" });

// Step 1 — pull the ticket ID out of the question (structured output).
async function extractTicketId(s: State): Promise<State> {
  const structured = model.withStructuredOutput(
    z.object({ ticketId: z.string() }),
  );
  const res = await structured.invoke([
    {
      role: "system",
      content:
        'Extract the support ticket ID from the question, in the format ' +
        '"SD-1234". A single ID.',
    },
    { role: "user", content: s.userQuestion },
  ]);
  return { ...s, ticketId: res.ticketId };
}

// Step 2 — always call findTicket once, for that ID.
async function lookupTicket(s: State): Promise<State> {
  return { ...s, ticketRaw: await findTicket.invoke({ id: s.ticketId! }) };
}

// Step 3 — turn the raw data into a natural answer.
async function composeAnswer(s: State): Promise<State> {
  const res = await model.invoke([
    { role: "system", content: "Write a short, natural answer in English." },
    {
      role: "user",
      content: `Question: ${s.userQuestion}\nTicket data: ${s.ticketRaw}`,
    },
  ]);
  return { ...s, answer: res.content as string };
}

// LCEL chain: steps run in this fixed order every time.
const chain = RunnableSequence.from([
  extractTicketId,
  lookupTicket,
  composeAnswer,
]);

async function main() {
  const question =
    process.argv.slice(2).join(" ") || "Ce status are tichetul SD-1042?";
  console.log(`\n> Question: ${question}\n`);

  const result = await chain.invoke({ userQuestion: question });

  console.log(`  Extracted ticket ID: ${result.ticketId}`);
  console.log(`  Raw data:            ${result.ticketRaw}`);
  console.log(`< Answer:              ${result.answer}\n`);
}

main().catch(console.error);
