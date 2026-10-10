import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const styles = fs.readFileSync(new URL("../styles/redesign.css", import.meta.url), "utf8");
const actions = ":is(.amp-text-action, .amp-button-cancel, .amp-button-back)";

function declarations(selector: string): string {
  const start = styles.indexOf(selector);
  assert.notEqual(start, -1, `Missing text-action selector: ${selector}`);
  const open = styles.indexOf("{", start);
  return styles.slice(open + 1, styles.indexOf("}", open));
}

test("text actions, cancel and back share transparent, borderless, stationary states", () => {
  for (const state of ["", ":is(:hover, :active)"]) {
    const css = declarations(`.amp-redesign.amp-app-shell ${actions}${state} {`);
    for (const property of [
      "background: transparent;", "border: 0;", "box-shadow: none;",
      "text-decoration: none;", "transform: none;",
    ]) assert.ok(css.includes(property), `Text-action ${state || "default"} needs ${property}`);
  }
});

test("enabled hover changes only the text color and disabled actions retain their color", () => {
  const css = declarations(`.amp-redesign.amp-app-shell ${actions}:hover:not(:disabled):not([aria-disabled="true"])`);
  assert.match(css, /color: var\(--amp-text-action-hover-color, #344054\);/);
  const disabled = declarations(`.amp-redesign.amp-app-shell ${actions}:is(:disabled, [aria-disabled="true"])`);
  assert.match(disabled, /color: var\(--amp-text-action-color, #475467\);/);
  const focus = declarations(`.amp-redesign.amp-app-shell ${actions}:focus-visible`);
  assert.match(focus, /outline: 2px solid #175cd3;/);
});

test("primary and abort text actions preserve their semantic palettes", () => {
  assert.match(declarations(".amp-redesign .amp-text-action-primary"), /--amp-text-action-hover-color: #1849a9;/);
  assert.match(declarations(".amp-redesign .amp-text-action-danger"), /--amp-text-action-color: #b42318;/);
});

test("special-case text operations opt into the shared interaction policy", () => {
  const cases = [
    ["components/content_generator/AgentDeliverableWorkspace.tsx", "amp-work-history-return", "amp-work-history-restore"],
    ["components/projects/MaterialDocumentPreview.tsx", "amp-material-preview-action"],
    ["app/market_insight/[insightId]/page.tsx", "amp-insight-source-download", "amp-insight-source-preview-more"],
    ["components/landing/PublicHomepage.tsx", "amp-public-login-link"],
  ];
  for (const [file, ...classes] of cases) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    for (const name of classes) {
      assert.match(source, new RegExp(`className="${name}[^"]*(?:amp-text-action|amp-button-cancel)`), `${file}: ${name}`);
    }
  }
});

test("plain cancel and back actions cannot bypass the shared text policy", () => {
  function sourceFiles(directory: string): string[] {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const filename = path.join(directory, entry.name);
      return entry.isDirectory() ? sourceFiles(filename)
        : filename.endsWith(".tsx") && !filename.endsWith(".test.tsx") ? [filename] : [];
    });
  }
  for (const filename of sourceFiles(fileURLToPath(new URL("../", import.meta.url)))) {
    const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node: ts.Node) {
      if (ts.isJsxElement(node) && ["button", "GuardedButton", "RedesignButton"].includes(node.openingElement.tagName.getText(source))) {
        const children = node.children.map((child) => child.getText(source)).join(" ");
        if (/(?:CHINESE|ENGLISH)_ACTIONS\.(?:cancel|back)\b/.test(children) && !/<(?:InlineIcon|svg|img|Image)\b/.test(children)) {
          const attribute = node.openingElement.attributes.properties.find(
            (item) => ts.isJsxAttribute(item) && item.name.getText(source) === "className",
          );
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          assert.match(attribute?.getText(source) || "", /amp-(?:text-action|button-cancel|button-back)/, `${filename}:${line}`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
});
