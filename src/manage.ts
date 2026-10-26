// `sbs accounts`: browse every account (mine vs clients) and manage one at a time.
import * as p from "@clack/prompts";
import * as cmd from "./commands";
import { bold, dim, green, interactive, red } from "./out";
import { getAccount, getActive, getSecrets, listAccounts, renameAccount, upsertAccount, UserError, ALIAS_RE, type Account } from "./store";

const BACK = "__back";

function hint(a: Account, active?: string) {
  const s = getSecrets(a.alias);
  return [a.email, a.alias === active ? "attivo" : "", s.token ? "" : "manca il token", a.label ?? ""].filter(Boolean).join(" · ");
}

async function guard(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    const err = e instanceof UserError ? e : new UserError((e as Error).message);
    if (err.code === "cancelled") return;
    p.log.error(err.message + (err.hint ? dim("\n" + err.hint) : ""));
  }
}

export async function accountsManager() {
  if (!interactive()) return cmd.cmdList();
  while (true) {
    const accs = listAccounts();
    const active = getActive();
    const mine = accs.filter((a) => a.kind === "mine");
    const clients = accs.filter((a) => a.kind !== "mine");
    const opt = (a: Account) => ({ value: a.alias, label: a.alias, hint: hint(a, active) });
    const choice = await p.select({
      message: accs.length ? `${accs.length} account collegati` : "Nessun account collegato",
      options: [
        ...(mine.length ? [{ value: "__h1", label: bold("I miei account"), disabled: true }, ...mine.map(opt)] : []),
        ...(clients.length ? [{ value: "__h2", label: bold("Clienti"), disabled: true }, ...clients.map(opt)] : []),
        { value: "__add", label: "+ Aggiungi un account che ho già" },
        { value: "__new", label: "+ Crea un account per un cliente" },
      ],
    });
    if (p.isCancel(choice)) return;
    if (choice === "__add") await guard(() => cmd.cmdAdd(undefined, {}));
    else if (choice === "__new") await guard(() => cmd.cmdNew(undefined, {}));
    else await accountMenu(choice as string);
  }
}

async function accountMenu(start: string) {
  let alias = start;
  while (true) {
    const acc = getAccount(alias);
    if (!acc) return;
    const s = getSecrets(alias);
    const active = getActive() === alias;
    p.log.message(
      `${bold(alias)}  ${dim(acc.kind === "mine" ? "mio" : "cliente")}${active ? green("  ● attivo") : ""}\n` +
        dim(`${acc.email ?? "email non salvata"}${acc.label ? " · " + acc.label : ""}`),
    );
    const action = await p.select({
      message: "Cosa vuoi fare?",
      options: [
        ...(!active && s.token ? [{ value: "use", label: "Usa questo account nella Supabase CLI" }] : []),
        ...(s.token
          ? [
              { value: "orgs", label: "Organizzazioni e membri" },
              { value: "projects", label: "Progetti" },
            ]
          : []),
        { value: "creds", label: "Mostra le credenziali" },
        ...(s.password ? [{ value: "copy", label: "Copia la password" }] : []),
        { value: "edit", label: "Modifica…" },
        { value: "token", label: s.token ? "Ricollega il token" : "Collega il token" },
        { value: "open", label: "Apri la dashboard", hint: "già loggata con questo account" },
        { value: "remove", label: red("Rimuovi da sbs") },
        { value: BACK, label: "← Indietro" },
      ],
    });
    if (p.isCancel(action) || action === BACK) return;

    switch (action) {
      case "use":
        await guard(() => cmd.cmdUse(alias, {}));
        break;
      case "orgs":
        await guard(() => cmd.cmdMembers(undefined, { as: alias }));
        break;
      case "projects":
        await guard(() => cmd.cmdProjects(undefined, [], { as: alias }));
        break;
      case "creds":
        await guard(() => cmd.cmdCreds(alias, { reveal: true }));
        break;
      case "copy":
        await guard(() => cmd.cmdCreds(alias, { copy: "password" }));
        break;
      case "edit":
        alias = (await editMenu(alias)) ?? alias;
        break;
      case "token": {
        const how = await p.select({
          message: "Come?",
          options: [
            { value: "auto", label: "Dal browser (consigliato)", hint: s.password ? "entra da solo" : "entri tu, il token si crea da solo" },
            { value: "paste", label: "Incollo un token" },
            { value: "login", label: "supabase login ufficiale" },
          ],
        });
        if (p.isCancel(how)) break;
        if (how === "auto") await guard(() => cmd.cmdConnect(alias, {}));
        else if (how === "login") await guard(() => cmd.cmdLogin(alias, {}));
        else {
          const t = await p.password({ message: "Token (sbp_...)" });
          if (!p.isCancel(t)) await guard(() => cmd.cmdSet(alias, { token: t.trim() }));
        }
        break;
      }
      case "open":
        await guard(() => cmd.cmdOpen(alias, {}));
        break;
      case "remove": {
        p.log.warn("Toglie l'account e le sue credenziali da sbs. Su Supabase non cambia nulla.");
        const ok = await p.confirm({ message: `Rimuovere ${alias}?`, initialValue: false });
        if (ok === true) {
          await guard(() => cmd.cmdRemove(alias, { yes: true }));
          return;
        }
        break;
      }
    }
  }
}

/** Returns the new alias when renamed. */
async function editMenu(alias: string): Promise<string | undefined> {
  const acc = getAccount(alias)!;
  const what = await p.select({
    message: "Cosa modifichi?",
    options: [
      { value: "email", label: "Email", hint: acc.email },
      { value: "password", label: "Password salvata" },
      { value: "label", label: "Nota", hint: acc.label },
      { value: "kind", label: acc.kind === "mine" ? "Segna come account cliente" : "Segna come mio account" },
      { value: "alias", label: "Nome (alias)", hint: alias },
      { value: BACK, label: "← Indietro" },
    ],
  });
  if (p.isCancel(what) || what === BACK) return;

  if (what === "kind") {
    upsertAccount(alias, { kind: acc.kind === "mine" ? "client" : "mine" });
    p.log.success(`${alias} ora è ${acc.kind === "mine" ? "un account cliente" : "un tuo account"}.`);
    return;
  }
  if (what === "password") {
    const pw = await p.password({ message: "Nuova password" });
    if (!p.isCancel(pw) && pw) await guard(() => cmd.cmdSet(alias, { password: pw }));
    return;
  }
  if (what === "alias") {
    const to = await p.text({
      message: "Nuovo nome",
      initialValue: alias,
      validate: (v) => (v && ALIAS_RE.test(v) ? undefined : "minuscole, numeri, . _ -"),
    });
    if (p.isCancel(to) || to === alias) return;
    let renamed: string | undefined;
    await guard(async () => {
      renameAccount(alias, to);
      renamed = to;
      p.log.success(`Rinominato in ${to}. Aggiorna i file .supabase-account che usavano "${alias}".`);
    });
    return renamed;
  }
  const v = await p.text({
    message: what === "email" ? "Email" : "Nota",
    initialValue: (what === "email" ? acc.email : acc.label) ?? "",
    validate: (x) => (what === "email" && !x?.includes("@") ? "email non valida" : undefined),
  });
  if (!p.isCancel(v)) await guard(() => cmd.cmdSet(alias, { [what]: v }));
}
