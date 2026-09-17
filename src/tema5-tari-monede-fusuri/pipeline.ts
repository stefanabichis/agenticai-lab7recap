// src/tema5-tari-monede-fusuri/pipeline.ts
//
// DETERMINISTIC — fixed flow, the model never decides the path.
// Always: extractCountry -> lookupCountry -> composeAnswer, in this exact
// order, with exactly one countryInfo call. No tool-calling loop, no
// branching — and no way to ever reach convertCurrency or localTime: a
// fixed 3-step pipeline has nowhere to plug in a step that depends on
// reading the PREVIOUS tool's output before deciding the next call's
// arguments. (Contrast with agent.ts / workflow.ts / workflowlangchain.ts,
// where exactly that dependency chain is the whole point.)

import "dotenv/config";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { countryInfo } from "./tools.js";

const StateAnnotation = Annotation.Root({
  userQuestion: Annotation<string>(),
  country: Annotation<string>(),
  countryRaw: Annotation<string>(),
  answer: Annotation<string>(),
});

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" });

// Step 1 — pull the country name out of the question (structured output).
async function extractCountry(s: typeof StateAnnotation.State) {
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
  return { country: res.country };
}

// Step 2 — always call countryInfo once, for that country.
async function lookupCountry(s: typeof StateAnnotation.State) {
  return { countryRaw: await countryInfo.invoke({ country: s.country }) };
}

// Step 3 — turn the raw data into a natural answer.
async function composeAnswer(s: typeof StateAnnotation.State) {
  const res = await model.invoke([
    { role: "system", content: "Write a short, natural answer in English." },
    {
      role: "user",
      content: `Question: ${s.userQuestion}\nCountry data: ${s.countryRaw}`,
    },
  ]);
  return { answer: res.content as string };
}

// Linear graph: no conditional edges, so the path is fixed every run.
const graph = new StateGraph(StateAnnotation)
  .addNode("extractCountry", extractCountry)
  .addNode("lookupCountry", lookupCountry)
  .addNode("composeAnswer", composeAnswer)
  .addEdge(START, "extractCountry")
  .addEdge("extractCountry", "lookupCountry")
  .addEdge("lookupCountry", "composeAnswer")
  .addEdge("composeAnswer", END)
  .compile();

async function main() {
  const question =
    process.argv.slice(2).join(" ") || "Care e capitala Japoniei?";
  console.log(`\n> Question: ${question}\n`);

  const result = await graph.invoke({ userQuestion: question });

  console.log(`  Extracted country: ${result.country}`);
  console.log(`  Raw data:          ${result.countryRaw}`);
  console.log(`< Answer:            ${result.answer}\n`);
}

main().catch(console.error);

/*
Test „posibil problematic": `npm run tema5:pipeline -- "Care e cea mai
populată țară din lume?"`.

Întrebarea NU are un răspuns fix — depinde de an și de sursă (India a
depășit China în populație în 2023) — și, mai important, niciunul din
tool-urile noastre nu știe populații. Totuși, extractCountry tot extrage O
țară (de exemplu "India" sau "China"), pipeline-ul o caută cu countryInfo
și — spre deosebire de „Ce oră e în Tokyo?" din tema 1, unde tool-ul nu
găsea nimic relevant — aici countryInfo CHIAR găsește țara în tabelul
nostru și întoarce date reale (capitală, monedă, fus). composeAnswer
primește date corecte, dar complet irelevante pentru întrebare, și trebuie
să decidă singur, din cunoștințele generale ale modelului, care e cea mai
populată țară — rezultat care poate arăta încrezător și structurat, deși
tool-ul nu a contribuit cu nimic la răspunsul de fapt cerut.
*/
