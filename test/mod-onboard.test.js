// The Claude Code mod's onboarding choices (mods/agent-board/hooks/onboard.ts), loaded by Node's own
// type stripping. The flows around them are tested by `claude plugin test mods/agent-board`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answerOf, cardChoices, cardUrl, firstSentence, needsInputChoices, projectChoices, projectFor, repoName, reporting, titleChoices,
} from "../mods/agent-board/hooks/onboard.ts";

test("first sentence: the first thing typed, slash commands and engine rows skipped", () => {
  const m = (text, role = "user") => ({ role, text });
  assert.equal(firstSentence([m("/board-sync new"), m("<command-name>x</command-name>"), m("Fix the login loop. It is bad.")]), "Fix the login loop");
  assert.equal(firstSentence([m("hi", "assistant"), m("幫我修登入頁。很急")]), "幫我修登入頁");
  assert.equal(firstSentence([m("line one\nline two")]), "line one");
  assert.equal(firstSentence([]), null);
  assert.equal(firstSentence([m("x".repeat(80))]).length, 50);
});

test("title choices: sentence, branch, cancel; duplicates and blanks dropped", () => {
  assert.deepEqual(titleChoices("Do it", "feat/x").map((c) => c.label), ["Do it", "feat/x", "Cancel"]);
  assert.deepEqual(titleChoices("same", "same").map((c) => c.label), ["same", "Cancel"]);
  assert.deepEqual(titleChoices(null, null).map((c) => c.label), ["Cancel"]);
  assert.equal(answerOf(titleChoices("Do it", null), "Cancel"), null);
});

test("card choices: at most three cards, then None of these", () => {
  const cards = [1, 2, 3, 4].map((i) => ({ id: `P-${i}`, title: `t${i}\nmore` }));
  const c = cardChoices(cards);
  assert.deepEqual(c.map((x) => x.label), ["P-1 t1 more", "P-2 t2 more", "P-3 t3 more", "None of these"]);
  assert.equal(answerOf(c, "P-2 t2 more"), "P-2");
  assert.equal(answerOf(c, "None of these"), null);
});

test("an answer that is not a label (typed under Other) means nothing", () => {
  assert.equal(answerOf(projectChoices(["AB"]), "ABC"), undefined);
  assert.equal(answerOf(projectChoices(["AB"]), undefined), undefined);
  // the dialog answers with blanks collapsed
  assert.deepEqual(answerOf([{ label: "AB  (AB-1)", value: 1 }], "AB (AB-1)"), 1);
});

test("project choices: two prefixes (D15), web, not now; never more than 4", () => {
  const c = projectChoices(["AB", "ABC", "ABCD"]);
  assert.equal(c.length, 4);
  assert.deepEqual(c.map((x) => x.value), [{ prefix: "AB" }, { prefix: "ABC" }, "web", "not-now"]);
});

test("needs_input choices: the server's options with their args, Cancel in a free slot", () => {
  const n = (k) => ({ question: "q?", error: "e", options: Array.from({ length: k }, (_, i) => ({ label: `o${i}`, args: { project: `p${i}` } })) });
  assert.deepEqual(needsInputChoices(n(1)).map((x) => x.label), ["o0", "Cancel"]);
  assert.deepEqual(needsInputChoices(n(4)).map((x) => x.label), ["o0", "o1", "o2", "o3"]);
  assert.deepEqual(answerOf(needsInputChoices(n(2)), "o1"), { project: "p1" });
});

test("which project a repo's cards go to", () => {
  const projects = [{ name: "Agent Board" }, { name: "My-App" }];
  assert.equal(projectFor(projects, { configured: "", repo: "my-app" }), "My-App");
  assert.equal(projectFor(projects, { configured: "", remembered: "Agent Board", repo: "x" }), "Agent Board");
  assert.equal(projectFor(projects, { configured: "", remembered: "deleted", repo: "x" }), null);
  assert.equal(projectFor(projects, { configured: "Set", repo: "x" }), "Set");
  assert.equal(repoName("/Users/me/code/my-app/"), "my-app");
});

test("card URL: ?task=ID, workspace only when not the default", () => {
  assert.equal(cardUrl("http://localhost:4317", "AB-1"), "http://localhost:4317/?task=AB-1");
  assert.equal(cardUrl("http://localhost:4317", "AB-1", "client a"), "http://localhost:4317/?task=AB-1&workspace=client%20a");
  assert.equal(cardUrl("http://localhost:4317"), "http://localhost:4317/");
});

test("off scope (D21): session beats project beats global; settings last", () => {
  const base = { sessionOff: false, projectOff: false, override: undefined, enabled: true };
  assert.deepEqual(reporting(base), { isOn: true, offBy: null });
  assert.deepEqual(reporting({ ...base, sessionOff: true, override: "on" }), { isOn: false, offBy: "session" });
  assert.deepEqual(reporting({ ...base, projectOff: true }), { isOn: false, offBy: "project" });
  assert.deepEqual(reporting({ ...base, override: "off" }), { isOn: false, offBy: "global" });
  assert.deepEqual(reporting({ ...base, enabled: false }), { isOn: false, offBy: "settings" });
  assert.deepEqual(reporting({ ...base, enabled: false, override: "on" }), { isOn: true, offBy: null });
});
