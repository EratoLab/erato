import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fileFetch,
  installHostShell,
  removeHostShell,
} from "@/test/hostShellStub";

import { ImageLightbox } from "./ImageLightbox";

const PIXEL = "data:image/png;base64,iVBORw0KGgo=";

const renderLightbox = (src: string) =>
  render(
    <I18nProvider i18n={i18n}>
      <ImageLightbox
        isOpen
        onClose={vi.fn()}
        image={{ type: "image", id: "img-1", src }}
      />
    </I18nProvider>,
  );

afterEach(() => {
  removeHostShell();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ImageLightbox download", () => {
  it("saves an embedded image through a download link in a browser", () => {
    const saved: { name: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push({ name: this.download, href: this.href });
    });
    renderLightbox(PIXEL);

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(saved).toEqual([{ name: "image-img-1.png", href: PIXEL }]);
  });

  it("opens a linked image in a browser", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    renderLightbox("/api/v1beta/files/1/preview");

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    expect(open).toHaveBeenCalledExactlyOnceWith(
      "/api/v1beta/files/1/preview",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("hands the image to a host app that offers files", async () => {
    vi.stubGlobal("fetch", fileFetch("png-bytes", "image/png"));
    const request = installHostShell({ files: 1 });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    renderLightbox(PIXEL);

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() => {
      expect(request).toHaveBeenCalledExactlyOnceWith(
        "files.share",
        expect.objectContaining({
          fileName: "image-img-1",
          contentType: "image/png",
          data: globalThis.btoa("png-bytes"),
        }),
      );
    });
    expect(fetch).toHaveBeenCalledWith(PIXEL, expect.anything());
    expect(click).not.toHaveBeenCalled();
  });
});
