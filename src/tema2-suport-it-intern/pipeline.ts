// src/tema2-suport-it-intern/pipeline.ts
//
// DETERMINISTIC — fixed flow, the model never decides the path.
// Always: extractTicketId -> lookupTicket -> composeAnswer, in this exact
// order, with exactly one findTicket call. No tool-calling loop, no
// branching. (Contrast with agent.ts / workflow.ts / workflowlangchain.ts,
// where the model decides which tools to call and how many turns to run.)

import "dotenv/config";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { findTicket } from "./tools.js";

const StateAnnotation = Annotation.Root({
  userQuestion: Annotation<string>(),
  ticketId: Annotation<string>(),
  ticketRaw: Annotation<string>(),
  answer: Annotation<string>(),
});

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" });

// Step 1 — pull the ticket ID out of the question (structured output).
async function extractTicketId(s: typeof StateAnnotation.State) {
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
  return { ticketId: res.ticketId };
}

// Step 2 — always call findTicket once, for that ID.
async function lookupTicket(s: typeof StateAnnotation.State) {
  return { ticketRaw: await findTicket.invoke({ id: s.ticketId }) };
}

// Step 3 — turn the raw data into a natural answer.
async function composeAnswer(s: typeof StateAnnotation.State) {
  const res = await model.invoke([
    { role: "system", content: "Write a short, natural answer in English." },
    {
      role: "user",
      content: `Question: ${s.userQuestion}\nTicket data: ${s.ticketRaw}`,
    },
  ]);
  return { answer: res.content as string };
}

// Linear graph: no conditional edges, so the path is fixed every run.
const graph = new StateGraph(StateAnnotation)
  .addNode("extractTicketId", extractTicketId)
  .addNode("lookupTicket", lookupTicket)
  .addNode("composeAnswer", composeAnswer)
  .addEdge(START, "extractTicketId")
  .addEdge("extractTicketId", "lookupTicket")
  .addEdge("lookupTicket", "composeAnswer")
  .addEdge("composeAnswer", END)
  .compile();

async function main() {
  const question =
    process.argv.slice(2).join(" ") || "Ce status are tichetul SD-1042?";
  console.log(`\n> Question: ${question}\n`);

  const result = await graph.invoke({ userQuestion: question });

  console.log(`  Extracted ticket ID: ${result.ticketId}`);
  console.log(`  Raw data:            ${result.ticketRaw}`);
  console.log(`< Answer:              ${result.answer}\n`);
}

main().catch(console.error);

/*
Test „lucru degeaba": `npm run tema2:pipeline -- "Câte zile de concediu mai
am?"`.

Întrebarea nu conține niciun ID de tichet — dar `withStructuredOutput`
forțează schema { ticketId: string }, deci modelul e OBLIGAT să inventeze
ceva (de exemplu "SD-0000"). Pipeline-ul apoi caută acel ID inventat cu
findTicket, primește "No ticket found...", și compune un răspuns despre un
tichet inexistent — deși întrebarea era despre zile de concediu, ceva ce
niciun tool de-al nostru nu poate ști. Spre deosebire de variantele
agentice, aici pasul findTicket e NEAPĂRAT executat, chiar dacă e degeaba.
*/
