import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import InlineMessageContent from "./InlineMessageContent";
import InlineIcon, { createInlineIconElement } from "../redesign/InlineIcon";
import { referenceIconNames } from "./referenceIcons";

test("message references render before, inside and after prose", () => {
  const html = renderToStaticMarkup(createElement(InlineMessageContent, {
    imageLabel: "Image 1",
    message: {
      role: "user", content: "Hello world",
      image_reference: { deliverable_id: "work", index: 0 },
      references: [{ kind: "insight", id: "insight", title: "Evidence" }, { kind: "material", id: "material", title: "Asset" }],
      reference_positions: [
        { kind: "image", id: "work:0", offset: 0 },
        { kind: "insight", id: "insight", offset: 6 },
        { kind: "material", id: "material", offset: 11 },
      ],
    },
  }));
  assert.ok(html.indexOf("Image 1") < html.indexOf("Hello"));
  assert.ok(html.indexOf("Hello") < html.indexOf("Evidence"));
  assert.ok(html.indexOf("Evidence") < html.indexOf("world"));
  assert.ok(html.indexOf("world") < html.indexOf("Asset"));
  assert.equal((html.match(/class="amp-inline-reference-icon"/g) || []).length, 3);
  assert.match(html, /aria-hidden="true"/);
});

test("each inline reference kind uses its corresponding shared icon", () => {
  assert.deepEqual(referenceIconNames, {
    insight: "insight", case: "case", material: "collection", image: "image",
  });
  const html = renderToStaticMarkup(createElement(InlineMessageContent, {
    imageLabel: "Image 1",
    message: { role: "user", content: "Review", references: [
      { id: "case", kind: "case", title: "<script>Case</script>" },
    ], reference_positions: [{ id: "case", kind: "case", offset: 0 }] },
  }));
  assert.match(html, /data-reference-kind="case"><svg/);
  assert.match(html, /&lt;script&gt;Case&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test("composer DOM icons reuse the same SVG geometry as message icons", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  interface IconElement {
    namespaceURI: string;
    tagName: string;
    attributes: Record<string, string>;
    children: IconElement[];
    setAttribute: (name: string, value: string) => void;
    append: (child: IconElement) => void;
  }
  const created: IconElement[] = [];
  const makeElement = (namespaceURI: string, tagName: string): IconElement => {
    const element: IconElement = {
      namespaceURI, tagName, attributes: {}, children: [],
      setAttribute(name, value) { this.attributes[name] = value; },
      append(child) { this.children.push(child); },
    };
    created.push(element);
    return element;
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true, value: { createElementNS: makeElement },
  });
  try {
    for (const name of Object.values(referenceIconNames)) {
      created.length = 0;
      const icon = createInlineIconElement(name);
      const markup = renderToStaticMarkup(createElement(InlineIcon, { name }));
      assert.equal(icon.namespaceURI, "http://www.w3.org/2000/svg");
      const element = created[0];
      assert.equal(element.attributes["aria-hidden"], "true");
      assert.equal(element.attributes.viewBox, "0 0 24 24");
      assert.ok(element.children.length > 0);
      for (const child of element.children) {
        assert.equal(child.namespaceURI, icon.namespaceURI);
        assert.ok(markup.includes(`<${child.tagName}`));
        for (const [attribute, value] of Object.entries(child.attributes)) {
          assert.ok(markup.includes(`${attribute}="${value}"`));
        }
      }
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
