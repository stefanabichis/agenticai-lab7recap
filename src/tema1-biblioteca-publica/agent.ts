// src/tema1-biblioteca-publica/agent.ts
//
// AGENTIC — high-level `createAgent`. The model decides itself whether to
// call a tool, which one, and how many times. This is what makes the
// "second call depends on the first" case work:
//   "Cine a scris Dune și ce a mai scris?"
//   -> model calls searchBook("Dune"), reads the author from the result,
//      THEN calls authorWorks(<that author>). The pipeline variants can't
//      do this — they run a fixed number of steps in a fixed order.

import "dotenv/config";
import { createAgent } from "langchain";
import { libraryTools } from "./tools.js";

const agent = createAgent({
  model: "anthropic:claude-sonnet-4-5",
  tools: libraryTools,
  systemPrompt:
    "You are a librarian assistant. Use the tools to answer questions " +
    "about books and authors. Answer briefly and to the point.",
});

async function main() {
  const question =
    process.argv.slice(2).join(" ") ||
    "Cine a scris Dune și ce a mai scris?";
  console.log(`\n> Question: ${question}\n`);

  const result = await agent.invoke(
    { messages: [{ role: "user", content: question }] },
    { recursionLimit: 25 },
  );

  const lastMessage = result.messages[result.messages.length - 1];
  console.log(`< Answer: ${lastMessage.content}\n`);
  console.log(`(total messages in the loop: ${result.messages.length})`);
}

main().catch(console.error);

// ─────────────────────────────────────────────────────────────────────────
// Test „lucru degeaba sau rupe pipeline": rulează cu o întrebare fără nicio
// legătură cu cărțile, ex. `npm run tema1:agent -- "Ce oră e în Tokyo?"`.
// Agentul NU are niciun tool de timp, deci fie răspunde direct că nu știe
// (fără să cheme vreun tool degeaba), fie — spre deosebire de pipeline.ts —
// nu e OBLIGAT să inventeze o "carte" doar ca să completeze un pas fix.
// ─────────────────────────────────────────────────────────────────────────
