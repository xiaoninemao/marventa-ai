import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../../styles/landing.css", import.meta.url), "utf8");
const source = readFileSync(new URL("./PublicHomepage.tsx", import.meta.url), "utf8");

test("public sections share fluid desktop gutters instead of a fixed content width", () => {
  const rule = css.match(/\.amp-public-container\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.match(rule, /margin-inline:\s*auto/);
  assert.match(rule, /width:\s*calc\(100% - clamp\(112px, 10vw, 240px\)\)/);
  assert.doesNotMatch(rule, /max-width:/);
});

test("public tablet and mobile gutters keep their existing responsive sizes", () => {
  for (const [breakpoint, gutter] of [[1100, 64], [800, 48], [560, 40]]) {
    const media = css.split(`@media (max-width: ${breakpoint}px) {`)[1]?.split("\n@media ")[0];
    assert.ok(media);
    assert.match(media, new RegExp(
      `\\.amp-public-container \\{\\s*width: calc\\(100% - ${gutter}px\\);`,
    ));
  }
});

test("public descriptions use their available column width", () => {
  for (const selector of [".amp-public-hero-statement", ".amp-public-value-copy > p"]) {
    const rule = css.split(`${selector} {`)[1]?.split("}")[0];
    assert.ok(rule);
    assert.doesNotMatch(rule, /(?:max-)?width\s*:/);
    assert.doesNotMatch(rule, /white-space:\s*nowrap/);
  }
});

test("the public capability heading wraps naturally instead of forcing a line break", () => {
  const heading = source.match(/<h2 id="public-capabilities-title">([\s\S]*?)<\/h2>/)?.[1];
  assert.ok(heading);
  assert.doesNotMatch(heading, /<br/);
  assert.ok(heading.includes('"Shared context. Work you build together."'));
});

test("the hero describes agents working with shared team knowledge in both languages", () => {
  const heading = source.match(/<h1 id="public-hero-title">([\s\S]*?)<\/h1>/)?.[1];
  assert.ok(heading);
  for (const phrase of ["让 Agent 带着", "团队的知识工作。", "Agents that work with ", "your team's knowledge."]) {
    assert.ok(heading.includes(phrase));
  }
  assert.match(heading, /className="amp-public-hero-phrase"/);
  assert.match(source, /className="amp-public-hero-description"/);
  const rule = css.match(/\.amp-public-hero h1\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.doesNotMatch(rule, /white-space:\s*nowrap/);
  assert.match(rule, /text-wrap:\s*balance/);
});

test("collaboration is a concrete progression from context through creation to team review", () => {
  const steps = source.match(/<ol className="amp-public-collaboration-steps">([\s\S]*?)<\/ol>/)?.[1];
  assert.ok(steps);
  assert.equal((steps.match(/<li>/g) || []).length, 3);
  for (const title of ["共享项目背景", "和 Agent 一起推进", "由团队审阅与交付",
    "Start with shared context", "Move the work forward with agents", "Keep the team in control"]) {
    assert.ok(steps.includes(title));
  }
  assert.doesNotMatch(source, /自动学习|自主优化|automatically learns|guaranteed/i);
});

test("the collaboration introduction connects shared knowledge, agents, and team judgment", () => {
  const introduction = source.match(/className="amp-public-collaboration-intro">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(introduction);
  assert.ok(introduction.includes("产品知识、品牌准则与创作经验"));
  assert.ok(introduction.includes("把握方向与品质"));
  assert.ok(introduction.includes("your team shapes its direction and quality"));
  assert.doesNotMatch(introduction, /一位同事|another's next draft/);
});

test("the hero transitions into collaboration without a section divider", () => {
  const rule = css.match(/\.amp-public-collaboration\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule);
  assert.doesNotMatch(rule, /border(?:-top|-block)?\s*:/);
});

test("retained knowledge has explicit reuse examples rather than bare labels", () => {
  assert.ok(source.includes("作品交付，经验留下。"));
  assert.ok(source.includes("Deliver the work. Keep the knowledge."));
  assert.equal((source.match(/className="amp-public-outcome-copy"/g) || []).length, 3);
  assert.ok(source.includes("把有效的表达和参考整理成素材"));
  assert.ok(source.includes("Turn useful copy and references into assets"));
  assert.match(source, /id="workflow"[\s\S]*?onClick=\{\(event\) => openAuth\("register", event\)\}/);
});
