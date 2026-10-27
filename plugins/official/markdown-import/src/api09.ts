/**
 * Plugin API 0.9.0 as this plugin uses it (the contract in PHASE4-PLAN.md). The host
 * implements it (sdk/api, host contexts); until `@vaultdraw/api` declares the same
 * members, the plugin reads them through `Ctx09`. Delete a member from here once the
 * shared types have it.
 */
import type {
  FontFamilyName,
  PageRequest,
  PluginContext,
} from "@vaultdraw/api";

export type PageItem =
  | {
      type: "text";
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      text: string;
      fontSize: number;
      fontFamily: FontFamilyName;
      lineHeight: number;
      align?: "left" | "center" | "right";
      tone?: "normal" | "muted" | "code" | "link";
      link?: string;
      data?: Record<string, unknown>;
    }
  | {
      type: "rect";
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      fill: "code" | "quote" | "callout" | "table" | "none";
      stroke?: "none" | "thin";
    }
  | {
      type: "line";
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      type: "image";
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      mimeType: string;
      bytes?: Uint8Array;
      alt?: string;
      target: string;
    };

export interface PageDocument {
  readonly path: string;
  append(items: readonly PageItem[], pageCount: number): void;
  finish(): Promise<{ path: string; revision: string }>;
  abort(): Promise<void>;
}

export interface SourceFolder {
  readonly name: string;
  list(): Promise<{ path: string; size: number; modifiedAt: number }[]>;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
}

export interface TargetFolder {
  readonly name: string;
  readonly kind: "newVault" | "vaultFolder";
  writeDrawing(path: string, scene: object): Promise<void>;
  copyFrom(source: SourceFolder, from: string, to: string): Promise<void>;
  open(): Promise<void>;
}

export interface Ctx09 extends PluginContext {
  readonly pages: PluginContext["pages"] & {
    createDocument(opts: {
      name: string;
      parent?: string;
      setup?: PageRequest;
      open?: boolean;
    }): Promise<PageDocument>;
    buildScene(
      items: readonly PageItem[],
      opts: { setup?: PageRequest; pageCount: number },
    ): Promise<object>;
  };
  readonly scene: PluginContext["scene"] & { scrollTo(id: string): void };
  readonly folders: {
    pickSource(opts?: { title?: string }): Promise<SourceFolder | null>;
    pickTarget(
      opts:
        | { kind: "newVault"; title?: string }
        | { kind: "vaultFolder"; path: string },
    ): Promise<TargetFolder | null>;
  };
}
