// `sbs` with no arguments on a terminal: accounts grouped Mine / Clients, then a small action list.
import * as p from "@clack/prompts";
import * as cmd from "./commands";
import { getActive, listAccounts, UserError, type Account } from "./store";

const stay = Symbol("stay");

async function accountMenu(a: Account): Promise<symbol | void> {
  const choice = await p.select({
    message: `${a.alias}  ${a.email}`,
    options: [
      { value: "use", label: "Use" },
      { value: "open", label: "Open dashboard" },
      { value: "rename", label: "Rename" },
      { value: "kind", label: a.kind === "mine" ? "Mark as client" : "Mark as mine" },
      { value: "rm", label: "Remove" },
    ],
  });
  if (p.isCancel(choice)) return stay; // Esc = back
  switch (choice) {
    case "use":
      return cmd.cmdUse(a.alias);
    case "open":
      await cmd.cmdOpen(a.alias, {});
      return stay;
    case "rename": {
      const to = await p.text({ message: "New alias", defaultValue: a.alias });
      if (!p.isCancel(to) && to !== a.alias) cmd.cmdRename(a.alias, to);
      return stay;
    }
    case "kind":
      cmd.cmdKind(a.alias, a.kind === "mine" ? "client" : "mine");
      return stay;
    case "rm":
      await cmd.cmdRm(a.alias);
      return stay;
  }
}

export async function menu() {
  p.intro("supabase-swap");
  while (true) {
    const accounts = listAccounts();
    const active = getActive();
    const row = (a: Account) => ({
      value: a.alias,
      label: `${a.alias === active ? "* " : "  "}${a.alias}`,
      hint: `${a.email} - ${a.projects.length} project${a.projects.length === 1 ? "" : "s"}`,
    });
    const group = (title: string, list: Account[]) =>
      list.length ? [{ value: `-${title}`, label: title, disabled: true }, ...list.map(row)] : [];
    const choice = await p.select({
      message: "Accounts",
      initialValue: active,
      options: [
        ...group("Mine", accounts.filter((a) => a.kind === "mine")),
        ...group("Clients", accounts.filter((a) => a.kind !== "mine")),
        { value: "+add", label: "+ Add account" },
        { value: "+new", label: "+ Create client account" },
      ],
    });
    if (p.isCancel(choice)) return p.outro("Bye");
    try {
      if (choice === "+add") await cmd.cmdAdd(undefined, {});
      else if (choice === "+new") await cmd.cmdNew(undefined, undefined);
      else if ((await accountMenu(accounts.find((a) => a.alias === choice)!)) !== stay) return;
    } catch (e) {
      if (!(e instanceof UserError && e.code === "cancelled")) p.log.error((e as Error).message);
    }
  }
}
