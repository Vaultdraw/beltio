/**
 * The mock host writes the host's pure rules again (sdk/api/shared/rules.ts).
 * These tables run the same cases through the app's code and through the mock
 * and require equal results, so a change on one side fails here.
 */
import { describe, expect, it } from "vitest";

import {
  emptyQueue,
  pushToast as realPushToast,
} from "../../../excalidraw-desktop/src/toasts/queue";
import { boot as bootHost } from "../../../excalidraw-desktop/src/plugins/testing";
import {
  allowsScope as realAllows,
  declProblem as realDeclProblem,
  effectiveSetting as realEffective,
  validateSettingValue as realValidate,
  type SettingDecl,
} from "../../../excalidraw-desktop/src/plugins/settings/declaredSettings";
import { validateOps as realValidateOps } from "../../../excalidraw-desktop/src/sceneOps/validate";
import { boot as bootMock } from "../testing";
import {
  allowsScope,
  declProblem,
  effectiveSetting,
  pushToast,
  validateSettingValue,
  type MockToast,
} from "../shared/rules";
import { validateOps } from "../shared/sceneRules";

import type { Plugin } from "../src/index";
import type { TestManifest, TestPlugin as SdkTestPlugin } from "../testing";

const decl = (
  d: Partial<SettingDecl> & Pick<SettingDecl, "type">,
): SettingDecl => ({
  key: "k",
  title: "K",
  default: "",
  ...d,
});

const DECLS: SettingDecl[] = [
  decl({ type: "bool", default: true }),
  decl({ type: "int", default: 3, min: 1, max: 5 }),
  decl({ type: "int", default: 3 }),
  decl({ type: "number", default: 0.5, min: 0, max: 1 }),
  decl({ type: "string", default: "x" }),
  decl({
    type: "select",
    default: "a",
    options: [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
  }),
  decl({ type: "color", default: "#aabbcc" }),
  decl({ type: "int", default: 3, scope: ["vault"] }),
  decl({ type: "int", default: 9, min: 1, max: 5 }), // invalid default
  decl({ type: "select", default: "a" }), // no options
];

const VALUES: unknown[] = [
  undefined,
  null,
  true,
  false,
  0,
  1,
  3,
  5,
  6,
  -1,
  2.5,
  NaN,
  Infinity,
  "",
  "a",
  "b",
  "c",
  "#fff",
  "#aabbcc",
  "#aabbccdd",
  "#abcd",
  "red",
  [],
  {},
];

// Compile-time (root tsc): the in-repo host kit implements the SDK's types.
export const hostKitConforms: (
  manifest: TestManifest,
  plugin: Plugin,
) => Promise<SdkTestPlugin> = bootHost;

describe("parity: settings rules", () => {
  it("validateSettingValue agrees on every declaration and value", () => {
    for (const d of DECLS) {
      for (const v of VALUES) {
        expect(
          validateSettingValue(d, v),
          `${d.type} ${JSON.stringify(v)}`,
        ).toEqual(realValidate(d, v));
      }
    }
  });

  it("declProblem, allowsScope and effectiveSetting agree", () => {
    for (const d of DECLS) {
      expect(declProblem(d)).toBe(realDeclProblem(d));
      for (const scope of ["global", "vault"] as const) {
        expect(allowsScope(d, scope)).toBe(realAllows(d, scope));
      }
      for (const v of VALUES) {
        expect(effectiveSetting(d, v)).toEqual(realEffective(d, v, undefined));
      }
    }
  });
});

describe("parity: toast queue", () => {
  it("de-duplicates and caps the same way", () => {
    const pushes: MockToast[] = [
      { message: "a", kind: "info" },
      { message: "a", kind: "info" },
      { message: "a", kind: "error" },
      { message: "b", kind: "info" },
      { message: "c", kind: "info" },
      { message: "d", kind: "info" },
      { message: "c", kind: "info" },
    ];
    let real = emptyQueue();
    let mock: MockToast[] = [];
    for (const t of pushes) {
      real = realPushToast(real, t, 0);
      mock = pushToast(mock, t);
      expect(mock).toEqual(
        real.toasts.map((x) => ({ message: x.message, kind: x.kind })),
      );
    }
  });
});

describe("parity: scene ops", () => {
  it("the app and the mock share one validator (sdk/api/shared/sceneRules.ts)", () => {
    expect(realValidateOps).toBe(validateOps);
  });

  const el = (type: string, isDeleted = false) => ({ type, isDeleted });
  const existing = new Map([
    ["r", el("rectangle")],
    ["t", el("text")],
    ["a", el("arrow")],
    ["gone", el("rectangle", true)],
  ]);
  const CASES: unknown[] = [
    "nope",
    [],
    [1],
    [{ op: "wat" }],
    [{ op: "add" }],
    [{ op: "add", element: { type: "rectangle" } }],
    [{ op: "add", element: { type: "star" } }],
    [{ op: "add", element: { type: "text" } }],
    [{ op: "add", element: { type: "text", text: "hi", x: 1e8 } }],
    [{ op: "add", element: { type: "rectangle", width: 0, color: 1 } }],
    [{ op: "add", element: { type: "rectangle", backgroundColor: "teal" } }],
    [
      {
        op: "add",
        element: { type: "rectangle", backgroundColor: "nonsense" },
      },
    ],
    [{ op: "add", element: { type: "arrow", points: [[0, 0], [1]] } }],
    [
      {
        op: "add",
        element: {
          type: "arrow",
          points: [
            [0, 0],
            [5, 5],
          ],
        },
      },
    ],
    [{ op: "update", id: "r", props: { text: "x", points: [] } }],
    [{ op: "update", id: "t", props: { text: "x", fontSize: 10 } }],
    [
      {
        op: "update",
        id: "a",
        props: {
          points: [
            [0, 0],
            [1, 1],
          ],
        },
      },
    ],
    [{ op: "update", id: "gone", props: {} }],
    [{ op: "update", id: "r" }],
    [
      { op: "delete", id: "r" },
      { op: "delete", id: "zzz" },
    ],
    Array.from({ length: 501 }, () => ({ op: "delete", id: "r" })),
  ];

  it("validateOps returns or throws the same issues", () => {
    for (const ops of CASES) {
      let real: unknown;
      let mock: unknown;
      try {
        real = realValidateOps(ops, existing as never);
      } catch (err) {
        real = {
          message: (err as Error).message,
          issues: (err as { issues: unknown }).issues,
        };
      }
      try {
        mock = validateOps(ops, existing);
      } catch (err) {
        mock = {
          message: (err as Error).message,
          issues: (err as { issues: unknown }).issues,
        };
      }
      expect(mock, JSON.stringify(ops).slice(0, 80)).toEqual(real);
    }
  });
});

describe("parity: host behaviour seen through both kits", () => {
  const manifest = {
    id: "par",
    name: "Parity",
    contributes: {
      commands: [{ id: "go" }, { id: "fail" }],
      settings: [
        { key: "n", type: "int", title: "N", default: 2, min: 1, max: 4 },
      ],
    },
  } as const;

  const plugin: Plugin = {
    activate(ctx) {
      ctx.commands.register("go", () => {
        ctx.ui.toast("hello");
        ctx.ui.toast("hello");
        ctx.ui.toast(42 as never);
        ctx.ui.toast(`n=${ctx.settings.get("n")}`);
      });
      ctx.commands.register("fail", () => {
        throw new Error("boom");
      });
      ctx.commands.register("undeclared", () => {});
      ctx.panels.register("nowhere", () => null);
    },
  };

  /** Everything observable that the two hosts must agree on. */
  const observe = async (bootFn: (m: never, p: Plugin) => Promise<unknown>) => {
    const t = (await bootFn(
      manifest as never,
      plugin,
    )) as import("../testing").TestPlugin;
    try {
      const out: Record<string, unknown> = {};
      await t.run("go");
      out.toasts = t.toasts();
      out.settings = [
        await t.setSetting("n", 4),
        await t.setSetting("n", 5),
        await t.setSetting("n", 1.5),
        await t.setSetting("zzz", "free"),
        await t.setSetting("n", 2, "vault"),
      ];
      await t.run("fail");
      out.afterFail = t.toasts();
      out.log = t.log();
      out.unknown = await t.run("undeclared").catch((e: Error) => e.message);
      await t.disable();
      out.afterDisable = await t.run("go").catch((e: Error) => e.message);
      return out;
    } finally {
      await t.dispose();
    }
  };

  it("toasts, setting results, errors and the log are the same", async () => {
    const real = await observe(bootHost as never);
    const mock = await observe(bootMock as never);
    expect(mock).toEqual(real);
    expect(mock.toasts).toEqual(["Parity: hello", "Parity: 42", "Parity: n=2"]);
  });
});

describe("parity: host and theme seen through both kits", () => {
  const manifest = {
    id: "par-ht",
    permissions: ["vault.read"],
    activation: ["onStartupFinished"],
  } as const;

  const observe = async (bootFn: (m: never, p: Plugin) => Promise<unknown>) => {
    const seen: Record<string, unknown> = {};
    const changes: unknown[] = [];
    const t = (await bootFn(manifest as never, {
      activate(ctx) {
        seen.api = ctx.host.api;
        seen.has = [
          "theme.tokens",
          "scene.batch",
          "drawing.saved",
          "vault.rename",
          "toString",
        ].map((n) => ctx.host.has(n));
        seen.permissions = ctx.manifest.permissions;
        seen.mode = ctx.theme.mode();
        ctx.theme.onChange((e) => changes.push(e));
      },
    })) as import("../testing").TestPlugin;
    try {
      t.theme.set({ mode: "dark", themeId: "cendre" });
      t.theme.set({ tokens: { "--vault-text": "#fefefe" } });
      seen.changes = changes;
      await t.disable();
      t.theme.set({ mode: "light" });
      seen.afterDisable = changes.length;
      return seen;
    } finally {
      await t.dispose();
    }
  };

  it("has(), api, permissions, mode and onChange agree", async () => {
    const real = await observe(bootHost as never);
    const mock = await observe(bootMock as never);
    expect(mock).toEqual(real);
    expect(mock.has).toEqual([true, true, true, false, false]);
    expect(mock.changes).toEqual([
      { mode: "dark", themeId: "cendre" },
      { mode: "dark", themeId: "cendre" },
    ]);
  });
});

describe("parity: vault, workspace and importers seen through both kits", () => {
  const rect = {
    type: "rectangle",
    x: 1,
    y: 2,
    width: 30,
    height: 40,
  } as const;
  const code = (p: Promise<unknown>) =>
    p.then(
      () => "ok",
      (e: { code?: string }) => e.code ?? "no code",
    );

  const observe = async (
    bootFn: (m: never, p: Plugin) => Promise<unknown>,
    permissions: ("vault.read" | "vault.write")[],
  ) => {
    let ctx!: import("../src/index").PluginContext;
    const t = (await bootFn(
      {
        id: "par-vault",
        name: "ParV",
        permissions,
        activation: ["onStartupFinished"],
        contributes: {
          importers: [{ id: "txt", extensions: ["txt", "excalidraw.txt"] }],
        },
      } as never,
      {
        activate(c) {
          ctx = c;
          c.importers.register("txt", {
            async import(input, { at, path }) {
              return {
                ops: [
                  {
                    op: "add",
                    element: {
                      type: "text",
                      text: `${await input.text()}@${path}`,
                      x: at.x,
                      y: at.y,
                    },
                  },
                ],
              };
            },
          });
          c.importers.register("nope", { import() {} });
        },
      },
    )) as import("../testing").TestPlugin;
    try {
      const out: Record<string, unknown> = {};
      t.vault.seed({ "a.excalidraw": [rect], "sub/b.excalidraw": [rect] });
      out.info = ctx.vault.info();
      out.list = await code(ctx.vault.list());
      out.listNames = await ctx.vault
        .list()
        .then((es) => es.map((e) => [e.path, e.kind]))
        .catch(() => null);
      out.listMissing = await code(ctx.vault.list("zzz"));
      out.listBad = await code(ctx.vault.list(".git"));
      out.read = await ctx.vault
        .readDrawing("a.excalidraw")
        .then((r) =>
          r.elements.map(({ type, x, y, width, height }) => ({
            type,
            x,
            y,
            width,
            height,
          })),
        )
        .catch((e: { code: string }) => e.code);
      out.readMissing = await code(ctx.vault.readDrawing("zz.excalidraw"));
      out.readBad = await code(ctx.vault.readDrawing("a.txt"));
      out.create = await ctx.vault
        .createDrawing("c.excalidraw", [
          { op: "add", element: { type: "text", text: "x", x: 1, y: 1 } },
        ])
        .then((r) => [r.path, r.ids.length])
        .catch((e: { code: string }) => e.code);
      out.createAgain = await code(ctx.vault.createDrawing("c.excalidraw", []));
      out.createBadOps = await ctx.vault
        .createDrawing("d.excalidraw", [{ op: "delete", id: "q" }])
        .catch((e: Error) => e.message);
      out.createBadPath = await code(ctx.vault.createDrawing("d.txt", []));
      out.openMissing = await code(ctx.workspace.open("nope.excalidraw"));
      out.openBad = await code(ctx.workspace.open("nope.txt"));
      out.active = ctx.workspace.activePath();
      const batch = await t.import("note.txt", "hello", { x: 7, y: 8 });
      out.imported = batch?.elements.map(({ x, y, text }) => ({ x, y, text }));
      out.importedLong = (
        await t.import("n.excalidraw.txt", "deep", { x: 1, y: 1 })
      )?.elements.length;
      out.cancel = t.cancelImport();
      out.undeclared = t.log().map((l) => l.text);
      out.opened = await code(
        ctx.workspace.open("a.excalidraw", { newTab: true }),
      );
      out.openedList = t.workspace.opened();
      out.activeAfter = ctx.workspace.activePath();
      t.vault.setVault(null);
      out.noVault = await code(ctx.vault.list());
      out.noVaultInfo = ctx.vault.info();
      return out;
    } finally {
      await t.dispose();
    }
  };

  it("declared permissions: results and error codes are the same", async () => {
    const real = await observe(bootHost as never, [
      "vault.read",
      "vault.write",
    ]);
    const mock = await observe(bootMock as never, [
      "vault.read",
      "vault.write",
    ]);
    expect(mock).toEqual(real);
    expect(mock.read).toEqual([
      { type: "rectangle", x: 1, y: 2, width: 30, height: 40 },
    ]);
    expect(mock.imported).toEqual([
      { x: 7, y: 8, text: "hello@fake.excalidraw" },
    ]);
    expect(mock.createAgain).toBe("NAME_COLLISION");
    expect(mock.openMissing).toBe("NOT_FOUND");
  });

  it("missing permissions: the same PERMISSION refusals", async () => {
    const real = await observe(bootHost as never, []);
    const mock = await observe(bootMock as never, []);
    expect(mock).toEqual(real);
    expect(mock.list).toBe("PERMISSION");
    expect(mock.create).toBe("PERMISSION");
  });

  it("vault.changed without vault.read reports the same PERMISSION error", async () => {
    const observeGate = async (
      bootFn: (m: never, p: Plugin) => Promise<unknown>,
    ) => {
      const t = (await bootFn(
        {
          id: "par-gate",
          permissions: [],
          activation: ["onStartupFinished"],
        } as never,
        {
          activate(c) {
            c.events.on("vault.changed", () => {});
          },
        },
      )) as import("../testing").TestPlugin;
      try {
        return t.log();
      } finally {
        await t.dispose();
      }
    };
    const real = await observeGate(bootHost as never);
    const mock = await observeGate(bootMock as never);
    expect(mock).toEqual(real);
    expect(mock[0].text).toContain("vault.changed needs the permission");
  });
});

describe("API 0.8.0 tables equal the editor's", () => {
  it("page sizes and the gap", async () => {
    const { PAGE_SIZES, PAGE_GAP } = await import("../shared/pages");
    const editor = await import(
      "../../../packages/excalidraw/data/pageSetup"
    );
    expect(Object.keys(PAGE_SIZES).sort()).toEqual(
      [...editor.PAGE_SIZE_PRESET_IDS].sort(),
    );
    for (const [id, size] of Object.entries(PAGE_SIZES)) {
      const p = editor.PAGE_SIZE_PRESETS[id as keyof typeof PAGE_SIZES];
      expect(size).toEqual({ width: p.width, height: p.height });
    }
    expect(PAGE_GAP).toBe(editor.PAGE_GAP);
  });

  it("line heights", async () => {
    const { LINE_HEIGHTS } = await import("../shared/text");
    const { FONT_FAMILY, getLineHeight } = await import(
      "../../../packages/common/src/index"
    );
    for (const [family, lh] of Object.entries(LINE_HEIGHTS)) {
      expect(getLineHeight(FONT_FAMILY[family as keyof typeof FONT_FAMILY]))
        .toBe(lh);
    }
  });
});
