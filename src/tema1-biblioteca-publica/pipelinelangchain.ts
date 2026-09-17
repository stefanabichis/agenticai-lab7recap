// src/tema1-biblioteca-publica/pipelinelangchain.ts
//
// DETERMINISTIC — same fixed flow as pipeline.ts, but built with plain
// LangChain (LCEL) instead of a LangGraph graph.
// RunnableSequence chains the steps in a fixed order: extractTitles ->
// searchTheBooks -> composeAnswer. No graph, no tool-calling loop, no
// branching. searchBook accepts an ARRAY of titles, so several books named
// in one question resolve in that single call.

import "dotenv/config";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { searchBook } from "./tools.js";

type State = {
  userQuestion: string;
  titles?: string[];
  bookRaw?: string;
  answer?: string;
};

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" });

// Step 1 — pull EVERY book title out of the question (structured output).
async function extractTitles(s: State): Promise<State> {
  // No .min(1): the question may name zero books ("Ce oră e în Tokyo?"),
  // and the model should be able to say so with an empty array instead of
  // being forced by the schema to invent a title.
  const structured = model.withStructuredOutput(
    z.object({ titles: z.array(z.string()) }),
  );
  const res = await structured.invoke([
    {
      role: "system",
      content:
        "Extract every book title mentioned in the question, in their " +
        "original language. The question may name one book, several, or " +
        "none — return one array entry per title, in the order mentioned, " +
        "or an empty array if no book title is mentioned at all.",
    },
    { role: "user", content: s.userQuestion },
  ]);
  return { ...s, titles: res.titles };
}

// Step 2 — always call searchBook once, for all the extracted titles.
async function searchTheBooks(s: State): Promise<State> {
  return { ...s, bookRaw: await searchBook.invoke({ titles: s.titles! }) };
}

// Step 3 — turn the raw data into a natural answer.
async function composeAnswer(s: State): Promise<State> {
  const res = await model.invoke([
    { role: "system", content: "Write a short, natural answer in English." },
    {
      role: "user",
      content: `Question: ${s.userQuestion}\nBook data:\n${s.bookRaw}`,
    },
  ]);
  return { ...s, answer: res.content as string };
}

// LCEL chain: steps run in this fixed order every time.
const chain = RunnableSequence.from([
  extractTitles,
  searchTheBooks,
  composeAnswer,
]);

async function main() {
  const question =
    process.argv.slice(2).join(" ") || "Cine a scris Dune?";
  console.log(`\n> Question: ${question}\n`);

  const result = await chain.invoke({ userQuestion: question });

  console.log(`  Extracted titles: ${result.titles!.join(", ")}`);
  console.log(`  Raw data:\n${result.bookRaw}`);
  console.log(`< Answer:          ${result.answer}\n`);
}

main().catch(console.error);
