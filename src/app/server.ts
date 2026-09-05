import express from "express";
import { findMember, members, type Member } from "./fake-bank-data.js";

export type FakeBankServerOptions = {
  port?: number;
};

const defaultPort = 3000;

export function createFakeBankApp() {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get("/", (_req, res) => {
    res.type("html").send(renderShell(renderDashboard()));
  });

  app.get("/members/search", (req, res) => {
    const memberId = normalizeMemberId(req.query.memberId);
    const validationError = memberId.length > 0 && !/^\d{5}$/.test(memberId);
    const member = validationError || memberId.length === 0 ? undefined : findMember(memberId);

    res.type("html").send(
      renderShell(
        renderSearchPage({
          memberId,
          validationError,
          member,
          searched: memberId.length > 0
        })
      )
    );
  });

  app.post("/members/search", (req, res) => {
    const memberId = normalizeMemberId(req.body.memberId);
    res.redirect(303, `/members/search?memberId=${encodeURIComponent(memberId)}`);
  });

  app.get("/members/:memberId", (req, res) => {
    const memberId = normalizeMemberId(req.params.memberId);
    const member = findMember(memberId);

    if (!member) {
      res.status(404).type("html").send(renderShell(renderMemberNotFound(memberId)));
      return;
    }

    const delayMs = memberId === "55555" ? 1_200 : 0;
    setTimeout(() => {
      res.type("html").send(renderShell(renderMemberDetail(member)));
    }, delayMs);
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, members: Object.keys(members).length });
  });

  return app;
}

export function startFakeBankServer(options: FakeBankServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT ?? defaultPort);
  const app = createFakeBankApp();
  const server = app.listen(port, () => {
    console.log(`Fake bank app listening at http://localhost:${port}`);
  });

  return server;
}

function normalizeMemberId(value: unknown): string {
  return String(value ?? "").trim();
}

function renderShell(content: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Northstar CoreServicing</title>
  <style>
    body { margin: 0; background: #d7dbe2; color: #111827; font-family: Arial, Helvetica, sans-serif; }
    .chrome { min-height: 100vh; display: grid; grid-template-columns: 224px 1fr; }
    .sidebar { background: #172033; color: #e5e7eb; padding: 18px 14px; }
    .brand { border: 2px solid #6b7280; padding: 12px; margin-bottom: 22px; font-weight: bold; letter-spacing: 0.04em; }
    .nav-cell { display: block; color: #d1d5db; padding: 9px 8px; border-bottom: 1px solid #2f3a52; text-decoration: none; }
    .workspace { padding: 22px; }
    .panel { background: #f8fafc; border: 1px solid #8b95a7; box-shadow: 3px 3px 0 #a0a8b8; max-width: 980px; }
    .panel-title { background: #23304a; color: white; padding: 10px 12px; font-size: 18px; }
    .panel-body { padding: 18px; }
    table.legacy { border-collapse: collapse; width: 100%; margin-top: 14px; background: white; }
    table.legacy th, table.legacy td { border: 1px solid #8b95a7; padding: 8px; text-align: left; vertical-align: top; }
    table.legacy th { background: #e5e7eb; }
    input[type="text"] { border: 2px inset #cbd5e1; padding: 8px; width: 220px; font-size: 16px; }
    button, .button-link { background: #1d4ed8; color: white; border: 1px solid #0f2f76; padding: 8px 12px; text-decoration: none; cursor: pointer; font-size: 14px; }
    .muted { color: #4b5563; }
    .error { border: 1px solid #991b1b; background: #fee2e2; color: #7f1d1d; padding: 10px; margin: 12px 0; }
    .warning { border: 1px solid #a16207; background: #fef3c7; color: #713f12; padding: 10px; margin: 12px 0; }
    .success { border: 1px solid #166534; background: #dcfce7; color: #14532d; padding: 10px; margin: 12px 0; }
    dialog { border: 3px solid #7c2d12; box-shadow: 4px 4px 0 #9ca3af; max-width: 460px; }
    dialog::backdrop { background: rgba(15, 23, 42, 0.45); }
    @media (max-width: 760px) { .chrome { display: block; } .sidebar { padding: 12px; } .workspace { padding: 12px; } }
  </style>
</head>
<body>
  <div class="chrome">
    <aside class="sidebar">
      <div class="brand">NORTHSTAR CORESERVICING</div>
      <a class="nav-cell" href="/">Operator Home</a>
      <a class="nav-cell" href="/members/search">Member Search</a>
      <span class="nav-cell muted">Deposit Accounts</span>
      <span class="nav-cell muted">Servicing Queue</span>
    </aside>
    <main class="workspace">${content}</main>
  </div>
</body>
</html>`;
}

function renderDashboard(): string {
  return `<section class="panel">
  <div class="panel-title">Operator Console</div>
  <div class="panel-body">
    <p>Use the legacy servicing menu to locate members and review deposit account information.</p>
    <p><a class="button-link" href="/members/search">Start Member Search</a></p>
  </div>
</section>`;
}

function renderSearchPage(options: {
  memberId: string;
  validationError: boolean;
  member: Member | undefined;
  searched: boolean;
}): string {
  const result = renderSearchResult(options);

  return `<section class="panel">
  <div class="panel-title">Member Search</div>
  <div class="panel-body">
    <form method="post" action="/members/search">
      <table class="legacy" aria-label="member search form">
        <tr>
          <th>Field</th>
          <th>Operator Input</th>
        </tr>
        <tr>
          <td><label for="memberId">Member Number</label></td>
          <td><input id="memberId" name="memberId" type="text" value="${escapeHtml(options.memberId)}" autocomplete="off" /> <button type="submit">Search</button></td>
        </tr>
      </table>
    </form>
    ${result}
  </div>
</section>`;
}

function renderSearchResult(options: {
  memberId: string;
  validationError: boolean;
  member: Member | undefined;
  searched: boolean;
}): string {
  if (options.validationError) {
    return `<div role="alert" class="error">Validation error: Member Number must be exactly five digits.</div>`;
  }

  if (!options.searched) {
    return `<p class="muted">No search has been submitted.</p>`;
  }

  if (!options.member) {
    return `<div role="status" class="warning">No member record found for ${escapeHtml(options.memberId)}.</div>`;
  }

  return `<table class="legacy" aria-label="search results">
    <tr>
      <th>Member Number</th>
      <th>Name</th>
      <th>Status</th>
      <th>Action</th>
    </tr>
    <tr>
      <td>${escapeHtml(options.member.id)}</td>
      <td>${escapeHtml(options.member.name)}</td>
      <td>${escapeHtml(options.member.status)}</td>
      <td><a class="button-link" href="/members/${encodeURIComponent(options.member.id)}">Open Member Detail</a></td>
    </tr>
  </table>`;
}

function renderMemberNotFound(memberId: string): string {
  return `<section class="panel">
  <div class="panel-title">Member Detail</div>
  <div class="panel-body">
    <div role="status" class="warning">No member record found for ${escapeHtml(memberId)}.</div>
    <p><a href="/members/search">Return to search</a></p>
  </div>
</section>`;
}

function renderMemberDetail(member: Member): string {
  const warning = member.flags.length
    ? `<div role="alert" class="warning">${member.flags.map(escapeHtml).join("<br />")}</div>`
    : `<div class="success">Member profile loaded.</div>`;
  const restrictedDialog =
    member.status === "restricted"
      ? `<dialog id="restrictedDialog" open aria-label="restricted member review">
  <h2>Supervisor review required</h2>
  <p>This member profile is restricted. Automation must hand control to a human operator before proceeding.</p>
  <form method="dialog"><button>Human reviewed restriction</button></form>
</dialog>`
      : "";

  return `<section class="panel">
  <div class="panel-title">Member Detail</div>
  <div class="panel-body">
    ${warning}
    <table class="legacy" aria-label="member profile summary">
      <tr><th>Member Number</th><td>${escapeHtml(member.id)}</td></tr>
      <tr><th>Member Name</th><td>${escapeHtml(member.name)}</td></tr>
      <tr><th>Profile Status</th><td>${escapeHtml(member.status)}</td></tr>
      <tr><th>Last Updated</th><td>${escapeHtml(member.lastUpdated)}</td></tr>
    </table>
    <table class="legacy" aria-label="deposit account balances">
      <tr>
        <th>Account Type</th>
        <th>Current Balance</th>
        <th>Available Balance</th>
      </tr>
      <tr>
        <td>Savings</td>
        <td>${escapeHtml(member.savingsBalance)}</td>
        <td>${escapeHtml(member.savingsBalance)}</td>
      </tr>
      <tr>
        <td>Checking</td>
        <td>${escapeHtml(member.checkingBalance)}</td>
        <td>${escapeHtml(member.checkingBalance)}</td>
      </tr>
    </table>
    <p class="muted">Checkpoint: deposit account balances visible.</p>
    <p><a href="/members/search">Return to search</a></p>
    ${restrictedDialog}
  </div>
</section>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
