// src/tema1-biblioteca-publica/tools.ts
//
// ═══════════════════════════════════════════════════════════════════════
// TEMA 1 · BIBLIOTECĂ PUBLICĂ — TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════
//
// Data source: Open Library (https://openlibrary.org) — free, public REST
// API, no API key required.
//
// Three tools, chained the way the assignment describes:
//   searchBook(titluri)  -> author, year, work ID — one or more titles at
//                           once, so "who wrote X and who wrote Y" needs a
//                           single call instead of silently keeping only X.
//   bookEditions(id)     -> number of editions + languages (needs the ID
//                           returned by searchBook)
//   authorWorks(autori)  -> other works by each author — same idea, one or
//                           more author names at once.
//
// All 5 variants in this folder (agent.ts, workflow.ts, workflowlangchain.ts,
// pipeline.ts, pipelinelangchain.ts) import these SAME tools, unchanged.
//
// Each tool follows the lab's rules:
//   1. Invalid input -> a readable message that includes valid examples.
//   2. description = what it does + when to call it + argument format +
//      one example input/output.
//   3. Every zod field has .describe().

import { tool } from "@langchain/core/tools";
import { z } from "zod";

// Small helper: fetch + parse JSON, never throw — the caller always gets
// either a parsed body or `null`, so tools can turn failures into a plain
// string message instead of crashing the agent loop.
async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// A work key can come back as "/works/OL893415W" or just "OL893415W"
// depending on which endpoint produced it. Normalize both directions.
function toWorkId(key: string): string {
  return key.replace("/works/", "");
}

// ─────────────────────────────────────────────────────────────────────────
// TOOL 1 — searchBook(titluri)
// Open Library full-text/title search: https://openlibrary.org/search.json
//
// Takes an ARRAY of titles so a question naming several books ("who wrote
// X and who wrote Y") resolves in one call, with one result line per title
// — instead of a schema that only fits a single title and silently drops
// every book after the first.
// ─────────────────────────────────────────────────────────────────────────
async function searchOneBook(title: string): Promise<string> {
  const data = await fetchJson(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(
      title,
    )}&limit=5&fields=title,author_name,first_publish_year,key`,
  );

  const docs = data?.docs;
  if (!docs?.length) {
    return (
      `- "${title}": no book found. Try a well-known title such as ` +
      `"Dune", "The Hobbit", or "1984".`
    );
  }

  // First hit is Open Library's own best-relevance match.
  const best = docs[0];
  const author = best.author_name?.[0] ?? "unknown author";
  const year = best.first_publish_year ?? "unknown year";
  const id = toWorkId(best.key);

  return `- "${best.title}" by ${author} (${year}). Work ID: ${id}.`;
}

export const searchBook = tool(
  async ({ titles }: { titles: string[] }) => {
    if (!titles?.length) {
      return (
        'No titles given. Provide at least one book title, e.g. ' +
        '{ "titles": ["Dune"] } or { "titles": ["Dune", "1984"] }.'
      );
    }

    const lines = await Promise.all(titles.map(searchOneBook));
    return lines.join("\n");
  },
  {
    name: "searchBook",
    description:
      "Search for one or more books by title and return each one's " +
      "author, first publish year, and Open Library work ID — one result " +
      "line per title, in the same order given. Call this FIRST whenever " +
      "the user asks about one or more specific books (who wrote it, when " +
      "it came out, etc.) — pass ALL the titles mentioned in the question " +
      "in a single call, not one call per title. Also call it before " +
      "bookEditions (which needs a work ID this tool returns).\n" +
      'Example input: { "titles": ["Dune", "1984"] }\n' +
      "Example output:\n" +
      '- "Dune" by Frank Herbert (1965). Work ID: OL893415W.\n' +
      '- "1984" by George Orwell (1949). Work ID: OL1168083W.',
    // No .min(1) here on purpose: an empty array is a VALID call whose
    // result is the readable "no titles given" message above, not a schema
    // error. That keeps invalid input on the "readable message" path
    // instead of crashing the caller with a Zod validation error.
    schema: z.object({
      titles: z
        .array(z.string())
        .describe(
          'One or more book titles to search for, e.g. ["Dune"] or ' +
            '["Dune", "1984"]. Partial titles work too, Open Library ' +
            "returns the closest match for each.",
        ),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────
// TOOL 2 — bookEditions(id)
// https://openlibrary.org/works/{id}/editions.json
// ─────────────────────────────────────────────────────────────────────────
export const bookEditions = tool(
  async ({ id }: { id: string }) => {
    const workId = toWorkId(id.trim());
    // A valid Open Library work ID looks like "OL893415W".
    if (!/^OL\d+W$/i.test(workId)) {
      return (
        `"${id}" is not a valid Open Library work ID. Call searchBook first ` +
        `to get one — it looks like "OL893415W".`
      );
    }

    const data = await fetchJson(
      `https://openlibrary.org/works/${workId}/editions.json`,
    );
    const entries = data?.entries;
    if (!entries?.length) {
      return (
        `No editions found for work ID "${workId}". Double check the ID ` +
        `came from searchBook, e.g. "OL893415W".`
      );
    }

    // Collect the distinct languages across all editions (language codes
    // come back as keys like "/languages/eng").
    const languages = new Set<string>();
    for (const e of entries) {
      for (const lang of e.languages ?? []) {
        languages.add(lang.key.replace("/languages/", ""));
      }
    }

    const langList = languages.size
      ? [...languages].join(", ")
      : "unknown language";
    return `${entries.length} edition(s) found, in ${languages.size || "?"} language(s): ${langList}.`;
  },
  {
    name: "bookEditions",
    description:
      "Given an Open Library WORK ID (not a title!), return how many " +
      "editions exist and in which languages. Call this AFTER searchBook, " +
      "using the work ID it returned — never guess an ID.\n" +
      'Example input: { "id": "OL893415W" }\n' +
      'Example output: 42 edition(s) found, in 7 language(s): eng, fre, ger, ...',
    schema: z.object({
      id: z
        .string()
        .describe(
          'Open Library work ID, e.g. "OL893415W". This comes from the ' +
            "output of searchBook, not from the user's question directly.",
        ),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────
// TOOL 3 — authorWorks(autori)
// Two calls per author: name -> author key (search/authors.json), then
// key -> works list (authors/{key}/works.json).
//
// Takes an ARRAY of author names for the same reason as searchBook: a
// question naming several authors resolves in one call, one result line
// per author.
// ─────────────────────────────────────────────────────────────────────────
async function worksForOneAuthor(author: string): Promise<string> {
  const search = await fetchJson(
    `https://openlibrary.org/search/authors.json?q=${encodeURIComponent(
      author,
    )}`,
  );
  const match = search?.docs?.[0];
  if (!match) {
    return (
      `- "${author}": no author found. Try a full name such as ` +
      `"Frank Herbert" or "Isaac Asimov".`
    );
  }

  const works = await fetchJson(
    `https://openlibrary.org/authors/${match.key}/works.json?limit=10`,
  );
  const titles = (works?.entries ?? []).map((w: any) => w.title);
  if (!titles.length) {
    return `- ${match.name}: no works listed.`;
  }

  return `- ${match.name} also wrote: ${titles.join(", ")}.`;
}

export const authorWorks = tool(
  async ({ authors }: { authors: string[] }) => {
    if (!authors?.length) {
      return (
        'No authors given. Provide at least one author name, e.g. ' +
        '{ "authors": ["Frank Herbert"] }.'
      );
    }

    const lines = await Promise.all(authors.map(worksForOneAuthor));
    return lines.join("\n");
  },
  {
    name: "authorWorks",
    description:
      "Look up one or more authors by name and list other works each one " +
      "wrote — one result line per author, in the same order given. Call " +
      "this when the user asks what ELSE an author wrote, typically after " +
      "searchBook has already told you the author's name(s). Pass ALL the " +
      "authors mentioned in a single call, not one call per author.\n" +
      'Example input: { "authors": ["Frank Herbert"] }\n' +
      "Example output:\n" +
      "- Frank Herbert also wrote: Dune Messiah, Children of Dune, God " +
      "Emperor of Dune, ...",
    // No .min(1) here either, same reason as searchBook: an empty array
    // should hit the readable "no authors given" message, not a Zod error.
    schema: z.object({
      authors: z
        .array(z.string())
        .describe(
          'One or more full author names, e.g. ["Frank Herbert"] or ' +
            '["Frank Herbert", "Isaac Asimov"]. Use the name(s) as returned ' +
            "by searchBook, not a partial or misspelled one.",
        ),
    }),
  },
);


export const libraryTools = [searchBook, bookEditions, authorWorks];
