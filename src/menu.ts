// `sbs` with no arguments on a terminal: one short menu.
import * as p from "@clack/prompts";
import * as cmd from "./commands";
import { readCliToken } from "./cli-slot";
import { accountsManager } from "./manage";
import { findAliasByToken, getAccount, listAccounts, UserError } from "./store";

export async function menu() {
  const cli = readCliToken();
  const current = cli ? findAliasByToken(cli) : undefined;
  const email = current ? getAccount(current)?.email : undefined;
  p.intro(`supabase-swap  ${current ? `· ${current}${email ? ` (${email})` : ""}` : cli ? "· token sconosciuto" : "· CLI non loggata"}`);

  const hasAccounts = listAccounts().length > 0;
  const choice = await p.select({
    message: "Cosa facciamo?",
    options: [
      ...(hasAccounts
        ? [
            { value: "use", label: "Cambia account" },
            { value: "accounts", label: "Gestisci gli account", hint: "miei e clienti" },
          ]
        : []),
      { value: "add", label: "Aggiungi un account che ho già" },
      { value: "new", label: "Crea un account per un cliente" },
      ...(hasAccounts
        ? [
            { value: "orgs", label: "Organizzazioni e membri" },
            { value: "projects", label: "Progetti" },
            { value: "open", label: "Apri la dashboard di un account" },
            { value: "doctor", label: "Controlla i token" },
          ]
        : []),
    ],
  });
  if (p.isCancel(choice)) return p.outro("Ciao");

  const pickAccount = async (message: string) => {
    const v = await p.select({
      message,
      initialValue: current,
      options: listAccounts().map((a) => ({ value: a.alias, label: a.alias, hint: a.email })),
    });
    if (p.isCancel(v)) throw new UserError("Annullato.", "cancelled");
    return v as string;
  };

  switch (choice) {
    case "use":
      return cmd.cmdUse(undefined, {});
    case "accounts":
      return accountsManager();
    case "add":
      return cmd.cmdAdd(undefined, {});
    case "new":
      return cmd.cmdNew(undefined, {});
    case "orgs":
      return cmd.cmdMembers(undefined, { as: await pickAccount("Di quale account?") });
    case "projects":
      return cmd.cmdProjects(undefined, [], { as: await pickAccount("Di quale account?") });
    case "open":
      return cmd.cmdOpen(await pickAccount("Di quale account?"), {});
    case "doctor":
      return cmd.cmdDoctor();
    default:
      throw new UserError("Scelta sconosciuta.");
  }
}
