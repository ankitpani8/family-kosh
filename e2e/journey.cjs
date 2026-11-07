// End-to-end journey through the real UI: an existing user, a relative starting fresh, and a partner
// who takes over her own profile. Run against e2e/server.mjs and a build pointed at it.
// Usage: node e2e/journey.cjs <app-url> [export.json] [screenshot-dir]
// Names and expected figures come from the export, so any family's file works; e2e/fixtures has a made-up one.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const APP = process.argv[2] ?? "http://127.0.0.1:4174/";
const EXPORT = process.argv[3] ?? path.join(__dirname, "fixtures/sample-export.json");
const SHOTS = process.argv[4] ?? "/tmp/kosh-e2e-shots";
const X = JSON.parse(fs.readFileSync(EXPORT, "utf8"));
const M = Object.entries(X.members);
const ME = (M.find(([, m]) => String(m.relation).toLowerCase() === "me") ?? M[0])[0];
const PARTNER = (M.find(([k, m]) => k !== ME && Number(m.income) > 0) ?? M.find(([k]) => k !== ME))[0];
const ownerName = X.members[ME].name;
const partnerName = X.members[PARTNER].name;
const otherNames = M.filter(([k]) => k !== PARTNER).map(([, m]) => m.name);
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const anyOf = (list) => new RegExp(list.map(esc).join("|"));
const partnerHoldingNames = Object.values(X.holdings).filter((h) => h.owners.includes(PARTNER)).map((h) => h.name);
// Only distinctive names: short generic ones ("EPF") also appear in help text or in the partner's own holdings.
const ownerOnlyHoldings = Object.values(X.holdings).filter((h) => !h.owners.includes(PARTNER)).map((h) => h.name)
  .filter((n) => n.length >= 6 && !partnerHoldingNames.some((p) => p.includes(n) || n.includes(p)));
const partnerOnly = Object.values(X.holdings).find((h) => h.owners.length === 1 && h.owners[0] === PARTNER).name;
const counts = { people: M.length, holdings: Object.keys(X.holdings).length, goals: Object.keys(X.goals).length };
const results = [];
const check = (ok, msg) => { results.push([ok, msg]); console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`); };
const errors = [];

async function user(browser, name, viewport = { width: 412, height: 900 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/websocket|realtime|Failed to load resource/i.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  return { ctx, page };
}
async function shot(page, file) { await page.screenshot({ path: path.join(SHOTS, file), fullPage: true }); }
async function toast(page, re, timeout = 90000) {
  const t = page.locator(".toast");
  await t.filter({ hasText: re }).first().waitFor({ timeout });
  return t.first().innerText();
}
async function go(page, tab) { await page.evaluate((t) => { location.hash = t; }, tab); await page.waitForTimeout(400); }
async function signUp(page, name, email) {
  await page.goto(APP);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.fill("#a-name", name);
  await page.fill("#a-email", email);
  await page.fill("#a-pw", "test-password-123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.locator("header.top").waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
}
async function mainText(page) { return (await page.locator("main").innerText()).replace(/\s+/g, " "); }
async function heroValue(page) { return (await page.locator(".hero .big").innerText()).trim(); }

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch();

  // ── 1. Owner signs up and imports his family's data ──
  const owner = await user(browser, "owner", { width: 1200, height: 900 });
  await signUp(owner.page, ownerName, "owner@example.com");
  check(await owner.page.locator("#get-started").isVisible(), "owner: new account shows the set-up checklist");
  await go(owner.page, "settings");
  await owner.page.click("#open-import");
  await owner.page.setInputFiles('.sheet input[type=file]', EXPORT);
  await owner.page.locator("#import-me").waitFor();
  check((await owner.page.locator("#import-me").inputValue()) !== "", "owner: import recognises which person is him");
  await owner.page.fill("#import-family-name", "Owner family");
  await owner.page.click("#import-run");
  const t1 = await toast(owner.page, /Imported/);
  check(t1.includes(`Imported ${counts.people} people, ${counts.holdings} holdings and ${counts.goals} goals`), `owner: import completes (${t1})`);
  await go(owner.page, "overview");
  await owner.page.waitForTimeout(800);
  const ownerHero = await heroValue(owner.page);
  check(ownerHero !== "₹0", `owner: family net worth is shown (${ownerHero})`);
  await shot(owner.page, "1-owner-overview.png");

  // Share a copy of the partner, and create her hand-over code.
  await go(owner.page, "people");
  const partnerRow = owner.page.locator("tr", { hasText: partnerName });
  await partnerRow.getByRole("button", { name: "Share a copy" }).click();
  const [dl] = await Promise.all([owner.page.waitForEvent("download"), owner.page.getByRole("button", { name: "Save or send file" }).click()]);
  const partnerFile = path.join(SHOTS, dl.suggestedFilename());
  await dl.saveAs(partnerFile);
  const partnerJson = JSON.parse(fs.readFileSync(partnerFile, "utf8"));
  const copyText = JSON.stringify(partnerJson);
  check(Object.keys(partnerJson.members).length === 1 && !anyOf(otherNames).test(copyText) && !anyOf(ownerOnlyHoldings).test(copyText),
    `owner: the partner's copy holds only her (${Object.keys(partnerJson.holdings).length} holdings, no one else's data)`);
  await owner.page.keyboard.press("Escape");
  await partnerRow.getByRole("button", { name: "Hand over" }).click();
  const handover = (await owner.page.locator(".sheet .code").innerText()).trim();
  check(/^[A-Z0-9]{8}$/.test(handover), "owner: hand-over code issued for the partner");
  await owner.page.keyboard.press("Escape");

  // ── 2. The partner's relative signs up: sees nothing of the owner's, sets up his own family ──
  const relative = await user(browser, "brother");
  await signUp(relative.page, "Relative", "relative@example.com");
  let txt = await mainText(relative.page);
  check(!anyOf([...M.map(([, m]) => m.name), "Owner family", ...ownerOnlyHoldings]).test(txt), "relative: a new account shows none of the owner's family");
  check((await heroValue(relative.page)) === "₹0", "relative: starts at ₹0");
  await shot(relative.page, "2-brother-first-run.png");
  await go(relative.page, "people");
  txt = await mainText(relative.page);
  check(!anyOf(M.map(([, m]) => m.name)).test(txt), "relative: People shows only himself");
  await go(relative.page, "holdings");
  check(!anyOf([...ownerOnlyHoldings, ...partnerHoldingNames.filter((n) => n.length >= 6)]).test(await mainText(relative.page)), "relative: Holdings shows none of the owner's holdings");
  await go(relative.page, "overview");

  // Checklist step 1: details
  await relative.page.locator("#get-started").getByRole("button", { name: "Add details" }).click();
  const sheet = relative.page.locator(".sheet");
  await sheet.locator("label:has-text('Take-home income') input").fill("120000");
  await sheet.locator("label:has-text('Spending from their own money') input").fill("40000");
  await sheet.getByRole("button", { name: "Save" }).click();
  await toast(relative.page, /Saved/);
  // Step 2: family
  await relative.page.locator("#get-started").getByRole("button", { name: "Create family" }).click();
  await relative.page.locator(".sheet label:has-text('Name') input").fill("Relative family");
  await relative.page.locator(".sheet").getByRole("button", { name: "Create" }).click();
  await toast(relative.page, /Family created/);
  // Step 4: import the partner's copy into his family
  await relative.page.locator("#get-started").getByRole("button", { name: "Import a file" }).click();
  await relative.page.setInputFiles('.sheet input[type=file]', partnerFile);
  await relative.page.locator("#import-me").waitFor();
  check((await relative.page.locator("#import-me").inputValue()) === "", "relative: import defaults to 'add as people I manage'");
  check((await relative.page.locator("#import-family option:checked").innerText()) === "Relative family", "relative: import defaults to his own family");
  await relative.page.click("#import-run");
  const t2 = await toast(relative.page, /Imported/);
  check(/Imported 1 person/.test(t2), `relative: imports the partner's copy (${t2})`);
  await relative.page.waitForTimeout(800);
  await shot(relative.page, "3-brother-after-setup.png");
  txt = await mainText(relative.page);
  check(/Relative family/.test(txt) && txt.includes(partnerName) && !anyOf([...otherNames, "Owner family"]).test(txt), "relative: sees his family with the partner, still nothing of the owner's");

  // The relative invites people to his family.
  await go(relative.page, "people");
  await relative.page.getByRole("button", { name: "Invite someone" }).click();
  const invite = (await relative.page.locator(".sheet .code").innerText()).trim();
  check(/^[A-Z0-9]{8}$/.test(invite), "relative: gets an invite code for his family");
  await relative.page.keyboard.press("Escape");

  // ── 3. The partner gets her own login, takes over her profile, joins her brother's family too ──
  const partner = await user(browser, "partner");
  await signUp(partner.page, partnerName, "partner@example.com");
  check((await heroValue(partner.page)) === "₹0" && !anyOf([ownerName, "Owner family"]).test(await mainText(partner.page)), "partner: new account starts empty and private");
  await go(partner.page, "people");
  await partner.page.locator("label:has-text('Hand-over code') input").fill(handover);
  await partner.page.getByRole("button", { name: "Take over" }).click();
  await toast(partner.page, /Profile taken over/);
  await partner.page.locator("label:has-text('Join a family') input").fill(invite);
  await partner.page.getByRole("button", { name: "Join" }).click();
  await toast(partner.page, /joined the family/);
  await go(partner.page, "overview");
  await partner.page.waitForTimeout(800);
  const partnerScopes = await partner.page.locator(".scopebar").innerText();
  check(/Owner family/.test(partnerScopes) && /Relative family/.test(partnerScopes), "partner: belongs to both families");
  await partner.page.getByRole("button", { name: "Me", exact: true }).click();
  await partner.page.waitForTimeout(300);
  const partnerNW = await heroValue(partner.page);
  check(partnerNW !== "₹0", `partner: her own data came with her (${partnerNW})`);
  await shot(partner.page, "4-partner-own-login.png");

  // ── 4. What each person can now see and change ──
  await relative.page.reload();
  await relative.page.locator("header.top").waitFor();
  await relative.page.waitForTimeout(1200);
  await go(relative.page, "people");
  txt = await mainText(relative.page);
  check(/Own login/.test(txt), "relative: sees the real partner (own login) in his family");
  check(!anyOf(otherNames).test(txt), "relative: still can't see the owner's other people");
  await go(relative.page, "holdings");
  txt = await mainText(relative.page);
  check(!anyOf(ownerOnlyHoldings).test(txt), "relative: still can't see any of the owner's own holdings");
  const partnerHolding = relative.page.locator(".hold", { hasText: partnerOnly });
  const nCopies = await partnerHolding.count();
  let editableByRelative = 0;
  for (let i = 0; i < nCopies; i++) editableByRelative += await partnerHolding.nth(i).getByRole("button", { name: "Edit" }).count();
  check(nCopies === 2 && editableByRelative === 1, "relative: sees the partner's real holding (read-only) and his imported copy (editable)");
  await shot(relative.page, "5-brother-holdings.png");

  await owner.page.reload();
  await owner.page.locator("header.top").waitFor();
  await owner.page.waitForTimeout(1200);
  await go(owner.page, "people");
  txt = await mainText(owner.page);
  check(new RegExp(esc(partnerName) + ".*Own login").test(txt), "owner: the partner now shows as having her own login");
  check(!/Relative/.test(txt), "owner: can't see the relative or his family");
  await go(owner.page, "holdings");
  const ownerSeesPartner = owner.page.locator(".hold", { hasText: partnerOnly });
  check((await ownerSeesPartner.count()) === 1 && (await ownerSeesPartner.getByRole("button", { name: "Edit" }).count()) === 0, "owner: still sees the partner's holding, but can no longer edit it");
  const ownerHero2 = await heroValue(owner.page);
  check(ownerHero2 === ownerHero, `owner: family net worth unchanged after the hand-over (${ownerHero2})`);

  await browser.close();
  console.log(`\n${results.filter((r) => r[0]).length}/${results.length} checks passed`);
  if (errors.length) console.log("Page errors:\n" + errors.slice(0, 15).join("\n"));
  process.exit(results.every((r) => r[0]) && !errors.length ? 0 : 1);
})().catch((e) => { console.error("JOURNEY CRASHED:", e.message); console.log(results.map((r) => (r[0] ? "PASS " : "FAIL ") + r[1]).join("\n")); console.log(errors.join("\n")); process.exit(2); });
