// src/tema2-suport-it-intern/tools.ts
//
// ═══════════════════════════════════════════════════════════════════════
// TEMA 2 · SUPORT IT INTERN — TOOL DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════
//
// Data source: FAKE — all data below is hardcoded in this file (in-memory
// objects), there is no real IT support system behind it. That is fine for
// the assignment: the point is the tool-calling shape, not the data source.
//
// Three tools, chained the way the assignment describes:
//   findTicket(id)          -> status, priority, responsible, affected
//                              service. Ticket IDs look like "SD-1042".
//   serviceStatus(serviciu) -> up / degraded / down, for VPN, Jira, CI/CD.
//   estimateWait(prioritate)-> estimated resolution time, from a fixed table.
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

// ─────────────────────────────────────────────────────────────────────────
// FAKE DATA
// ─────────────────────────────────────────────────────────────────────────

type Ticket = {
  status: "Open" | "In Progress" | "Resolved" | "Closed";
  priority: "P1" | "P2" | "P3" | "P4";
  assignee: string;
  service: "VPN" | "Jira" | "CI/CD";
  description: string;
};

// Keyed by ticket ID, e.g. "SD-1042".
const TICKETS: Record<string, Ticket> = {
  "SD-1001": {
    status: "Resolved",
    priority: "P3",
    assignee: "Ana Pop",
    service: "Jira",
    description: "Cannot create new issues in the PLATFORM project.",
  },
  "SD-1042": {
    status: "In Progress",
    priority: "P2",
    assignee: "Mihai Ionescu",
    service: "VPN",
    description: "User cannot connect to the office VPN from home.",
  },
  "SD-2050": {
    status: "Open",
    priority: "P1",
    assignee: "unassigned",
    service: "CI/CD",
    description: "Deploy pipeline failing on the main branch.",
  },
  "SD-3300": {
    status: "Closed",
    priority: "P4",
    assignee: "Elena Radu",
    service: "Jira",
    description: "Requested a new Jira dashboard.",
  },
};

// Keyed by service name.
const SERVICE_STATUS: Record<string, "up" | "degraded" | "down"> = {
  VPN: "degraded",
  Jira: "up",
  "CI/CD": "down",
};

// Estimated resolution time by priority, from a fixed table (no lookup, no
// randomness — same input always gives the same output).
const WAIT_TABLE: Record<Ticket["priority"], string> = {
  P1: "2 hours (urgent, on-call team engaged)",
  P2: "8 business hours",
  P3: "1 business day",
  P4: "3 business days",
};

// ─────────────────────────────────────────────────────────────────────────
// TOOL 1 — findTicket(id)
// ─────────────────────────────────────────────────────────────────────────
export const findTicket = tool(
  async ({ id }: { id: string }) => {
    const normalized = id.trim().toUpperCase();
    if (!/^SD-\d{3,5}$/.test(normalized)) {
      return (
        `"${id}" is not a valid ticket ID. Ticket IDs look like "SD-1042" ` +
        `(the letters "SD-" followed by 3-5 digits).`
      );
    }

    const t = TICKETS[normalized];
    if (!t) {
      return (
        `No ticket found with ID "${normalized}". Known example IDs: ` +
        `"SD-1001", "SD-1042", "SD-2050".`
      );
    }

    return (
      `Ticket ${normalized}: status=${t.status}, priority=${t.priority}, ` +
      `assignee=${t.assignee}, affected service=${t.service}. ` +
      `Description: ${t.description}`
    );
  },
  {
    name: "findTicket",
    description:
      "Look up an IT support ticket by ID and return its status, " +
      "priority, assignee, and the service it affects. Call this FIRST " +
      "whenever the user mentions a ticket ID, and before serviceStatus " +
      "when you need to check whether the SERVICE the ticket points to is " +
      "having problems.\n" +
      'Example input: { "id": "SD-1042" }\n' +
      'Example output: Ticket SD-1042: status=In Progress, priority=P2, ' +
      "assignee=Mihai Ionescu, affected service=VPN. Description: User " +
      "cannot connect to the office VPN from home.",
    schema: z.object({
      id: z
        .string()
        .describe(
          'Ticket ID in the format "SD-1042" (letters "SD-" + 3-5 digits). ' +
            "Case-insensitive.",
        ),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────
// TOOL 2 — serviceStatus(serviciu)
// ─────────────────────────────────────────────────────────────────────────
export const serviceStatus = tool(
  async ({ service }: { service: string }) => {
    const key = Object.keys(SERVICE_STATUS).find(
      (k) => k.toLowerCase() === service.trim().toLowerCase(),
    );
    if (!key) {
      return (
        `Unknown service "${service}". Known services: ` +
        `${Object.keys(SERVICE_STATUS).join(", ")}.`
      );
    }

    return `${key} is currently: ${SERVICE_STATUS[key]}.`;
  },
  {
    name: "serviceStatus",
    description:
      "Check whether an internal service is up, degraded, or down. Call " +
      "this when the user asks if something is broken, or after " +
      "findTicket has told you which service a ticket affects, to check " +
      "if that service explains why the ticket is stuck.\n" +
      'Example input: { "service": "VPN" }\n' +
      'Example output: VPN is currently: degraded.',
    schema: z.object({
      service: z
        .string()
        .describe(
          'Service name: "VPN", "Jira", or "CI/CD". Case-insensitive.',
        ),
    }),
  },
);

// ─────────────────────────────────────────────────────────────────────────
// TOOL 3 — estimateWait(prioritate)
// ─────────────────────────────────────────────────────────────────────────
const PRIORITY_ALIASES: Record<string, Ticket["priority"]> = {
  p1: "P1",
  urgent: "P1",
  critical: "P1",
  p2: "P2",
  high: "P2",
  p3: "P3",
  medium: "P3",
  normal: "P3",
  p4: "P4",
  low: "P4",
};

export const estimateWait = tool(
  async ({ priority }: { priority: string }) => {
    const key = PRIORITY_ALIASES[priority.trim().toLowerCase()];
    if (!key) {
      return (
        `Unknown priority "${priority}". Valid priorities: "P1" (urgent), ` +
        `"P2" (high), "P3" (medium), "P4" (low).`
      );
    }

    return `Estimated resolution time for ${key}: ${WAIT_TABLE[key]}.`;
  },
  {
    name: "estimateWait",
    description:
      "Return the estimated resolution time for a ticket priority, from a " +
      "fixed table. Call this when the user asks how long a fix will " +
      "take, using the priority returned by findTicket (or one the user " +
      "states directly).\n" +
      'Example input: { "priority": "P2" }\n' +
      'Example output: Estimated resolution time for P2: 8 business hours.',
    schema: z.object({
      priority: z
        .string()
        .describe(
          'Ticket priority: "P1", "P2", "P3", "P4", or a plain-English ' +
            'alias like "urgent", "high", "medium", "low".',
        ),
    }),
  },
);

// All tools, ready to hand to the model.
export const supportTools = [findTicket, serviceStatus, estimateWait];
