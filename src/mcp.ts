// `sbs mcp`: a tiny MCP server over stdio (newline-delimited JSON-RPC 2.0), no SDK.
// Read-only view of the account/project cache. It never returns tokens or passwords, and
// nothing but protocol messages may reach stdout.
import { allProjects, searchProjects, syncAccounts, type ProjectHit } from "./accounts";
import { VERSION } from "./env";
import { flags } from "./out";
import { listAccounts, UserError } from "./store";

const str = { type: "string" } as const;
const TOOLS = [
  { name: "list_accounts", description: "List the saved Supabase accounts (alias, email, mine/client, project count).", inputSchema: { type: "object", properties: {} } },
  {
    name: "list_projects",
    description: "List projects of all accounts from the local cache, optionally filtered by text (name, ref, organization).",
    inputSchema: { type: "object", properties: { query: str } },
  },
  {
    name: "find_project",
    description: "Find which account owns a project. Returns the account alias to use with `sbs run <alias> -- supabase ...`.",
    inputSchema: { type: "object", properties: { query: str }, required: ["query"] },
  },
  { name: "sync", description: "Check every account's token and refresh the project cache.", inputSchema: { type: "object", properties: {} } },
];

const row = (h: ProjectHit) => ({ account: h.account, ref: h.ref, name: h.name, org: h.org_name, region: h.region, status: h.status });

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const query = typeof args.query === "string" ? args.query : "";
  switch (name) {
    case "list_accounts":
      return listAccounts().map((a) => ({ alias: a.alias, email: a.email, kind: a.kind, projects: a.projects.length }));
    case "list_projects":
      return (query ? searchProjects(query) : allProjects()).map(row);
    case "find_project": {
      if (!query) throw new UserError("query is required", "missing_query");
      let hits = searchProjects(query);
      if (!hits.length) {
        await syncAccounts(listAccounts().map((a) => a.alias), false);
        hits = searchProjects(query);
      }
      return hits.map(row);
    }
    case "sync":
      return await syncAccounts(listAccounts().map((a) => a.alias), true);
    default:
      throw new UserError(`Unknown tool: ${name}`, "unknown_tool");
  }
}

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"]; // newest first

const send = (msg: object) => process.stdout.write(JSON.stringify(msg) + "\n");

async function handle(msg: any) {
  const { id, method, params } = msg ?? {};
  const reply = (result: unknown) => id !== undefined && send({ jsonrpc: "2.0", id, result });
  const error = (code: number, message: string) => id !== undefined && send({ jsonrpc: "2.0", id, error: { code, message } });
  if (typeof method !== "string") return error(-32600, "Invalid request: method must be a string");
  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion; // echo the client's version if we speak it, else offer ours
      const protocolVersion = PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0];
      return reply({ protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "sbs", version: VERSION } });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call":
      try {
        const out = await callTool(params?.name, params?.arguments ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
      } catch (e) {
        return reply({ isError: true, content: [{ type: "text", text: (e as Error).message }] });
      }
    default:
      if (method.startsWith("notifications/")) return; // initialized, cancelled...: nothing to do
      return error(-32601, `Method not found: ${method}`);
  }
}

export async function runMcp() {
  flags.json = true; // anything printed by shared code goes to stderr
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of Bun.stdin.stream()) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        await handle(JSON.parse(line));
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
    }
  }
}
