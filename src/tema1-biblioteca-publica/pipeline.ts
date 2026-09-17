// src/tema1-biblioteca-publica/pipeline.ts
//
// DETERMINISTIC — fixed flow, the model never decides the path.
// Always: extractTitles -> searchTheBooks -> composeAnswer, in this exact
// order, with exactly one searchBook call (which now accepts an ARRAY of
// titles, so a question naming several books resolves in that single call
// instead of the extraction step being forced to keep only one). No
// tool-calling loop, no branching. (Contrast with agent.ts / workflow.ts /
// workflowlangchain.ts, where the model decides which tools to call and how
// many turns to run.)

import "dotenv/config";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { searchBook } from "./tools.js";

const StateAnnotation = Annotation.Root({
  userQuestion: Annotation<string>(),
  titles: Annotation<string[]>(),
  bookRaw: Annotation<string>(),
  answer: Annotation<string>(),
});

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" });

// Step 1 — pull EVERY book title out of the question (structured output).
async function extractTitles(s: typeof StateAnnotation.State) {
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
  return { titles: res.titles };
}

// Step 2 — always call searchBook once, for all the extracted titles.
async function searchTheBooks(s: typeof StateAnnotation.State) {
  return { bookRaw: await searchBook.invoke({ titles: s.titles }) };
}

// Step 3 — turn the raw data into a natural answer.
async function composeAnswer(s: typeof StateAnnotation.State) {
  const res = await model.invoke([
    { role: "system", content: "Write a short, natural answer in English." },
    {
      role: "user",
      content: `Question: ${s.userQuestion}\nBook data:\n${s.bookRaw}`,
    },
  ]);
  return { answer: res.content as string };
}

// Linear graph: no conditional edges, so the path is fixed every run.
const graph = new StateGraph(StateAnnotation)
  .addNode("extractTitles", extractTitles)
  .addNode("searchTheBooks", searchTheBooks)
  .addNode("composeAnswer", composeAnswer)
  .addEdge(START, "extractTitles")
  .addEdge("extractTitles", "searchTheBooks")
  .addEdge("searchTheBooks", "composeAnswer")
  .addEdge("composeAnswer", END)
  .compile();

async function main() {
  const question =
    process.argv.slice(2).join(" ") || "Cine a scris Dune?";
  console.log(`\n> Question: ${question}\n`);

  const result = await graph.invoke({ userQuestion: question });

  console.log(`  Extracted titles: ${result.titles.join(", ")}`);
  console.log(`  Raw data:\n${result.bookRaw}`);
  console.log(`< Answer:          ${result.answer}\n`);
}

main().catch(console.error);

/*
Test „lucru degeaba sau rupe pipeline": `npm run tema1:pipeline -- "Ce oră e
în Tokyo?"`.

Întrebarea nu conține niciun titlu de carte. De obicei modelul poate
recunoaște asta și returnează `titles: []` din extractTitles — dar
searchTheBooks TOT îl cheamă pe searchBook cu acel array vid, pentru că
pasul e fix în pipeline, indiferent de conținutul lui. searchBook răspunde
cu mesajul lui lizibil ("No titles given...") — arătând regula #1 că
funcționează — dar pipeline-ul nu se oprește acolo: trece mesajul ăsta la
composeAnswer, care compune un răspuns despre ora din Tokyo folosind DOAR
cunoștințele generale ale modelului, nu vreun tool. Alteori modelul chiar
inventează un titlu (ex. ["Tokyo"]) în loc să returneze array vid, caz în
care searchBook găsește degeaba o carte fără legătură. În ambele variante,
pasul searchBook e NEAPĂRAT executat — pipeline-ul nu are cum să decidă
"nu chem tool-ul de data asta", cum poate un agent.

Test „succes aparent, eșec ascuns": `npm run tema1:pipeline -- "Cine a scris
o Scrisoare pierduta si cine a scris Baltagul?"`. Acum extractTitles ar
trebui să extragă AMBELE titluri, iar searchBook să le caute pe amândouă
într-un singur apel — spre deosebire de schema veche cu un singur `title`,
care păstra tăcut doar primul titlu, iar răspunsul final "corect" despre al
doilea venea din cunoștințele generale ale modelului, nu din tool.
*/
