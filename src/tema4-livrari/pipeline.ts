// src/tema4-livrari/pipeline.ts
//
// DETERMINISTIC — fixed flow, the model never decides the path.
// Always: extractAwb -> trackTheParcel -> composeAnswer, in this exact
// order, with exactly one trackParcel call. No tool-calling loop, no
// branching — and, importantly, NO WAY to ever reach changeDelivery: a
// fixed 3-step pipeline has nowhere to plug in a step that depends on
// checking two other tools first and on the user's actual intent. The
// irreversible tool is only reachable from the agentic variants, which is
// exactly why they're the ones that need the precondition checks written
// into changeDelivery's description (see tools.ts).

import "dotenv/config";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { trackParcel } from "./tools.js";

const StateAnnotation = Annotation.Root({
  userQuestion: Annotation<string>(),
  awb: Annotation<string>(),
  parcelRaw: Annotation<string>(),
  answer: Annotation<string>(),
});

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" });

// Step 1 — pull the AWB out of the question (structured output).
async function extractAwb(s: typeof StateAnnotation.State) {
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
  return { awb: res.awb };
}

// Step 2 — always call trackParcel once, for that AWB.
async function trackTheParcel(s: typeof StateAnnotation.State) {
  return { parcelRaw: await trackParcel.invoke({ awb: s.awb }) };
}

// Step 3 — turn the raw data into a natural answer.
async function composeAnswer(s: typeof StateAnnotation.State) {
  const res = await model.invoke([
    { role: "system", content: "Write a short, natural answer in English." },
    {
      role: "user",
      content: `Question: ${s.userQuestion}\nParcel data: ${s.parcelRaw}`,
    },
  ]);
  return { answer: res.content as string };
}

// Linear graph: no conditional edges, so the path is fixed every run.
const graph = new StateGraph(StateAnnotation)
  .addNode("extractAwb", extractAwb)
  .addNode("trackTheParcel", trackTheParcel)
  .addNode("composeAnswer", composeAnswer)
  .addEdge(START, "extractAwb")
  .addEdge("extractAwb", "trackTheParcel")
  .addEdge("trackTheParcel", "composeAnswer")
  .addEdge("composeAnswer", END)
  .compile();

async function main() {
  const question =
    process.argv.slice(2).join(" ") || "Coletul 12345 unde e?";
  console.log(`\n> Question: ${question}\n`);

  const result = await graph.invoke({ userQuestion: question });

  console.log(`  Extracted AWB: ${result.awb}`);
  console.log(`  Raw data:      ${result.parcelRaw}`);
  console.log(`< Answer:        ${result.answer}\n`);
}

main().catch(console.error);

/*
Test „lucru degeaba": `npm run tema4:pipeline -- "Cât costă livrarea în
Germania?"`.

Întrebarea nu conține niciun AWB — modelul poate returna un string vid sau
inventat pentru "awb", pipeline-ul îl caută degeaba cu trackParcel (care
răspunde cu mesajul lui lizibil de "not a valid AWB" / "not found"), iar
composeAnswer trebuie să compună un răspuns despre costul livrării în
Germania folosind DOAR cunoștințele generale ale modelului — tool-ul
trackParcel nu a ajutat cu nimic. Pasul e NEAPĂRAT executat, chiar dacă e
degeaba: pipeline-ul nu are cum să decidă "nu urmăresc niciun colet de data
asta". Observă și că, indiferent de întrebare, acest pipeline nu poate
NICIODATĂ să ajungă la changeDelivery — tool-ul ireversibil e complet
inaccesibil dintr-un flux fix cu 3 pași ficși.
*/
