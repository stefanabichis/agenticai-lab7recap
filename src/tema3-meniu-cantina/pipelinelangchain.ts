// src/tema3-meniu-cantina/pipelinelangchain.ts
//
// DETERMINISTIC — same fixed flow as pipeline.ts, but built with plain
// LangChain (LCEL) instead of a LangGraph graph.
// RunnableSequence chains the steps in a fixed order: readMenu ->
// takeFirstDish -> composeAnswer. No graph, no tool-calling loop, no
// branching, and no adaptation to the menu's length.

import "dotenv/config";
import { RunnableSequence } from "@langchain/core/runnables";
import { ChatAnthropic } from "@langchain/anthropic";
import { todayMenu } from "./tools.js";

type State = {
  userQuestion: string;
  menuRaw?: string;
  firstDish?: string;
  answer?: string;
};

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" });

// Step 1 — always call todayMenu once.
async function readMenu(s: State): Promise<State> {
  return { ...s, menuRaw: await todayMenu.invoke({}) };
}

// Step 2 — pick the first dish, deterministically (plain string parsing,
// no LLM, no second tool call).
async function takeFirstDish(s: State): Promise<State> {
  const firstLine = s.menuRaw!.split("\n")[0] ?? "";
  return { ...s, firstDish: firstLine };
}

// Step 3 — turn the raw data into a natural answer.
async function composeAnswer(s: State): Promise<State> {
  const res = await model.invoke([
    { role: "system", content: "Write a short, natural answer in English." },
    {
      role: "user",
      content: `Question: ${s.userQuestion}\nToday's first dish: ${s.firstDish}`,
    },
  ]);
  return { ...s, answer: res.content as string };
}

// LCEL chain: steps run in this fixed order every time.
const chain = RunnableSequence.from([
  readMenu,
  takeFirstDish,
  composeAnswer,
]);

async function main() {
  const question =
    process.argv.slice(2).join(" ") || "Ce se găsește azi la meniu?";
  console.log(`\n> Question: ${question}\n`);

  const result = await chain.invoke({ userQuestion: question });

  console.log(`  Menu:\n${result.menuRaw}`);
  console.log(`  First dish: ${result.firstDish}`);
  console.log(`< Answer:     ${result.answer}\n`);
}

main().catch(console.error);
