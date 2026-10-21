import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PanelHost } from "./PanelHost";

afterEach(cleanup);

const Hello = ({ name }: { name: string }) => <p>hello {name}</p>;
const loader = () => vi.fn(async () => ({ default: Hello }));

describe("PanelHost", () => {
  it("does not load before the first open, loads once across reopens", async () => {
    const load = loader();
    const { rerender } = render(
      <PanelHost id="p" load={load} open={false} props={{ name: "a" }} />,
    );
    expect(load).not.toHaveBeenCalled();
    rerender(<PanelHost id="p" load={load} open props={{ name: "a" }} />);
    expect(await screen.findByText("hello a")).toBeInTheDocument();
    rerender(
      <PanelHost id="p" load={load} open={false} props={{ name: "a" }} />,
    );
    expect(screen.queryByText("hello a")).toBeNull();
    rerender(<PanelHost id="p" load={load} open props={{ name: "a" }} />);
    expect(await screen.findByText("hello a")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keepAlive stays mounted but hidden and never re-fetches", async () => {
    const load = loader();
    const el = (open: boolean) => (
      <PanelHost
        id="p"
        load={load}
        keepAlive
        open={open}
        props={{ name: "k" }}
      />
    );
    const { rerender } = render(el(true));
    const text = await screen.findByText("hello k");
    rerender(el(false));
    expect(text.closest("[hidden]")).not.toBeNull();
    rerender(el(true));
    expect(text.closest("[hidden]")).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("contains a throwing panel, offers Retry and Close", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const Bad = () => {
      if (fail) {
        throw new Error("boom");
      }
      return <p>recovered</p>;
    };
    const onClose = vi.fn();
    render(
      <div>
        <p>rest of app</p>
        <PanelHost
          id="bad"
          load={async () => ({ default: Bad })}
          open
          onClose={onClose}
          props={{}}
        />
      </div>,
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("rest of app")).toBeInTheDocument();
    expect(err.mock.calls.some((c) => String(c[0]).includes('"bad"'))).toBe(
      true,
    );
    fireEvent.click(screen.getByText("Close"));
    expect(onClose).toHaveBeenCalled();
    fail = false;
    fireEvent.click(screen.getByText("Retry"));
    expect(await screen.findByText("recovered")).toBeInTheDocument();
    err.mockRestore();
  });
});
