import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { describe, expect, it } from "vitest";

import { preloadableRoute } from "../startPreload";

import "@testing-library/jest-dom";

const page = () => {
  const Page = () => <div>page</div>;
  return preloadableRoute(() => Promise.resolve({ default: Page }));
};

describe("preloadableRoute", () => {
  it("renders a preloaded page at once, without its fallback", async () => {
    const route = page();
    await route.preload();

    render(
      <Suspense fallback={<div>fallback</div>}>
        <route.Route />
      </Suspense>,
    );

    expect(screen.getByText("page")).toBeInTheDocument();
    expect(screen.queryByText("fallback")).toBeNull();
  });

  it("loads a page that was not preloaded through the fallback", async () => {
    const route = page();

    render(
      <Suspense fallback={<div>fallback</div>}>
        <route.Route />
      </Suspense>,
    );

    expect(screen.getByText("fallback")).toBeInTheDocument();
    expect(await screen.findByText("page")).toBeInTheDocument();
  });
});
