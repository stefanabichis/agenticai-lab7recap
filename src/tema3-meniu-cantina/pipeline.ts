// src/tema3-meniu-cantina/pipeline.ts
//
// DETERMINISTIC — fixed flow, the model never decides the path.
// Always: readMenu -> takeFirstDish -> composeAnswer, in this exact order,
// with exactly one todayMenu call and ZERO dishAllergens/calculateBill
// calls, no matter what the question actually asks. "ia primul fel" is
// plain array-index-0, not something the model chooses — that's the
// point: the pipeline never looks past dish [0], and never adapts to how
// many dishes are on the menu (contrast with agent.ts / workflow.ts /
// workflowlangchain.ts, where the number of dishAllergens calls scales
// with the menu size).

import "dotenv/config";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatAnthropic } from "@langchain/anthropic";
import { todayMenu } from "./tools.js";

const StateAnnotation = Annotation.Root({
  userQuestion: Annotation<string>(),
  menuRaw: Annotation<string>(),
  firstDish: Annotation<string>(),
  answer: Annotation<string>(),
});

const model = new ChatAnthropic({ model: "claude-sonnet-4-5" });

// Step 1 — always call todayMenu once. No arguments to extract, so unlike
// pipeline.ts in tema1/tema2, there is no "extract X from the question"
// step at all: the question's content is completely ignored until compose.
async function readMenu(s: typeof StateAnnotation.State) {
  return { menuRaw: await todayMenu.invoke({}) };
}

// Step 2 — pick the first dish, deterministically. Plain string parsing of
// todayMenu's own output, no LLM, no second tool call.
async function takeFirstDish(s: typeof StateAnnotation.State) {
  const firstLine = s.menuRaw.split("\n")[0] ?? "";
  return { firstDish: firstLine };
}

// Step 3 — turn the raw data into a natural answer.
async function composeAnswer(s: typeof StateAnnotation.State) {
  const res = await model.invoke([
    { role: "system", content: "Write a short, natural answer in English." },
    {
      role: "user",
      content: `Question: ${s.userQuestion}\nToday's first dish: ${s.firstDish}`,
    },
  ]);
  return { answer: res.content as string };
}

// Linear graph: no conditional edges, so the path is fixed every run.
const graph = new StateGraph(StateAnnotation)
  .addNode("readMenu", readMenu)
  .addNode("takeFirstDish", takeFirstDish)
  .addNode("composeAnswer", composeAnswer)
  .addEdge(START, "readMenu")
  .addEdge("readMenu", "takeFirstDish")
  .addEdge("takeFirstDish", "composeAnswer")
  .addEdge("composeAnswer", END)
  .compile();

async function main() {
  const question =
    process.argv.slice(2).join(" ") || "Ce se găsește azi la meniu?";
  console.log(`\n> Question: ${question}\n`);

  const result = await graph.invoke({ userQuestion: question });

  console.log(`  Menu:\n${result.menuRaw}`);
  console.log(`  First dish: ${result.firstDish}`);
  console.log(`< Answer:     ${result.answer}\n`);
}

main().catch(console.error);

/*
Test „rupe pipeline / lucru degeaba": `npm run tema3:pipeline -- "Cât costă
un abonament lunar?"`.

Întrebarea nu are nicio legătură cu meniul, dar pipeline-ul citește
meniul și ia primul fel EXACT LA FEL ca pentru orice altă întrebare — nu
există nicio ramură care să verifice dacă întrebarea are sens pentru acest
flux. composeAnswer primește "Today's first dish: F1: Ciorbă de legume —
12 RON" ca "date", și trebuie să compună un răspuns despre un abonament
lunar din asta — fie ignoră datele și răspunde onest că nu știe, fie le
amestecă într-un răspuns confuz. În ambele cazuri, apelul la todayMenu a
fost degeaba: pipeline-ul nu are cum să decidă "nu citesc meniul de data
asta", cum poate un agent.

Test „numărul de apeluri depinde de meniu" — ăsta e specific variantelor
AGENTICE (agent.ts / workflow.ts / workflowlangchain.ts), NU acestei
pipeline: rulează `npm run tema3:workflow -- "Ce pot mânca dacă am alergie
la lactoză?"` și numără liniile "→ dishAllergens(...)" din consolă — ar
trebui să fie exact cât MENU.length din tools.ts (5, implicit). Schimbă
lungimea array-ului MENU și numărul de apeluri se schimbă odată cu el;
această pipeline determinist rămâne mereu la 1 apel (todayMenu), indiferent
de câte feluri sunt pe meniu.
*/
