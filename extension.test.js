import assert from "node:assert/strict";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { visibleWidth } from "@earendil-works/pi-tui";

const host = process.env.PI_MONITOR_HOST;

test("Pi loads the extension, renders the viewer, and queues completion", {
  skip: !host && "Set PI_MONITOR_HOST to your installed Pi package directory",
  timeout: 5000,
}, async () => {
  const { loadExtensions } = await import(pathToFileURL(`${host}/dist/core/extensions/loader.js`).href);
  const result = await loadExtensions([`${process.cwd()}/index.ts`], process.cwd());
  assert.deepEqual(result.errors, []);
  const extension = result.extensions[0];
  const messages = [];
  result.runtime.sendMessage = (message, options) => messages.push({ message, options });
  let widget;
  let interact = async (_component, _isClosed) => {};
  const theme = { fg: (_color, text) => text };
  const tui = { terminal: { rows: 24 }, requestRender() {} };
  const ctx = {
    cwd: process.cwd(), mode: "tui",
    ui: {
      notify(message) { throw new Error(message); },
      setWidget(_key, factory) {
        widget?.dispose?.();
        widget = factory?.(tui, theme);
      },
      async custom(factory) {
        let done = false;
        const component = factory(tui, theme, { matches: (data) => data === "escape" }, () => { done = true; });
        for (const width of [1, 4, 30, 80]) {
          const lines = component.render(width).map(stripVTControlCharacters);
          assert.ok(lines.length <= tui.terminal.rows);
          assert.ok(lines.every((line) => visibleWidth(line) <= width));
          if (width >= 4) {
            assert.equal(lines[0], `╭${"─".repeat(width - 2)}╮`);
            assert.equal(lines.at(-1), `╰${"─".repeat(width - 2)}╯`);
            assert.equal(lines[1], `│${" ".repeat(width - 2)}│`);
            assert.equal(lines.at(-2), lines[1]);
            assert.ok(lines.slice(1, -1).every((line) =>
              line.startsWith("│ ") && line.endsWith(" │") && visibleWidth(line) === width));
          }
        }
        await interact(component, () => done);
        if (!done) component.handleInput("escape");
        assert.equal(done, true);
      },
    },
  };
  const dispatch = async (name) => {
    for (const handler of extension.handlers.get(name) ?? []) await handler({}, ctx);
  };
  const tool = extension.tools.get("monitor").definition;
  const execute = (params) => tool.execute("test", params, new AbortController().signal, undefined, ctx);
  await dispatch("session_start");
  try {
    assert.deepEqual(widget.render(40), []);
    const started = await execute({ action: "start", command: "sleep 0.1; printf done", title: "CI 日本語 🚀" });
    assert.match(started.content[0].text, /Started in background/);
    assert.match(widget.render(80)[0], /CI.*running/);
    interact = async (component, isClosed) => {
      component.handleInput("d");
      assert.equal(isClosed(), false);
      assert.match((await execute({ action: "status", id: "1" })).content[0].text, /running/);
    };
    await extension.commands.get("monitors").handler("", ctx);
    while (!messages.length) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(messages.length, 1);
    assert.match(messages[0].message.content, /completed[\s\S]*done/);
    assert.deepEqual(messages[0].options, { triggerTurn: true, deliverAs: "followUp" });
    assert.deepEqual(widget.render(80), []);
    assert.match((await execute({ action: "status" })).content[0].text, /completed/);
    await execute({ action: "start", command: "sleep 30" });
    assert.match(widget.render(80)[0], /#2.*running/);
    await execute({ action: "stop", id: "2" });
    assert.deepEqual(widget.render(80), []);
    interact = async (component, isClosed) => {
      component.handleInput("d");
      assert.equal(isClosed(), false);
      assert.match(component.render(80).join("\n"), /#1.*CI/);
      await assert.rejects(execute({ action: "status", id: "2" }), /Unknown monitor/);
      component.handleInput("d");
      assert.equal(isClosed(), true);
      assert.deepEqual(component.render(80), []);
      assert.equal((await execute({ action: "status" })).content[0].text, "No monitors");
    };
    await extension.commands.get("monitors").handler("", ctx);
    assert.equal(messages.length, 1);
    await execute({ action: "start", command: "sleep 30" });
    await dispatch("session_shutdown");
    assert.equal(messages.length, 1);
    await dispatch("session_start");
    assert.equal((await execute({ action: "status" })).content[0].text, "No monitors");
  } finally { await dispatch("session_shutdown"); }
});
