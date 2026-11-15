import { i18n } from "@lingui/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installFakePowerPoint,
  removeFakePowerPoint,
  requirementsUpTo,
} from "../../../test/mocks/powerpoint/fakePowerPoint";
import { powerpointInclusionStore } from "../../hooks/powerpointInclusionStore";
import { powerpointReadSupport } from "../../utils/powerpointReadSupport";
import { PowerPointChatInput } from "../PowerPointChatInput";

import type {
  AddinChatInputRenderProps,
  AddinSendPreparation,
} from "../../../core/AddinChatCore";
import type { AddinChatInputCoreProps } from "../../../core/AddinChatInputCore";
import type { FakeDeck } from "../../../test/mocks/powerpoint/fakePowerPoint";
import type {
  ComposerContextItem,
  FileCapability,
  FileUploadItem,
} from "@erato/frontend/library";
import type { ReactNode } from "react";

const VISION: FileCapability[] = [
  {
    id: "image",
    extensions: ["png", "jpg"],
    mime_types: ["image/*"],
    operations: ["analyze_image"],
    upload_allowed: true,
  },
];

const mocks = vi.hoisted(() => ({
  composer: null as AddinChatInputCoreProps | null,
  available: new Map<string, () => boolean>(),
  facets: [
    {
      id: "powerpoint_presentation",
      allowed_args: ["presentation_name", "read_tier", "selection_summary"],
    },
  ] as { id: string; allowed_args: string[] }[],
  capabilities: undefined as FileCapability[] | undefined,
  capabilityQueries: [] as { modelId?: string; enabled?: boolean }[],
  addUploadedFiles: (_files: FileUploadItem[]) => {},
  menu: { uploadDisabled: false, onClose: () => {} },
  uploadEnabled: true,
}));

vi.mock("../../../core/AddinChatInputCore", async () => {
  const { PowerPointChatAddMenuExtraContent } = await import(
    "../PowerPointChatAddMenuExtraContent"
  );
  return {
    AddinChatInputCore: (props: AddinChatInputCoreProps) => {
      mocks.composer = props;
      return (
        <PowerPointChatAddMenuExtraContent
          onClose={mocks.menu.onClose}
          uploadDisabled={mocks.menu.uploadDisabled}
        />
      );
    },
  };
});

vi.mock("@erato/frontend/library", async () => {
  const mock = await import("../../../test/helpers/eratoLibraryMock");
  return mock.createEratoLibraryMock({
    useFacets: () => ({ data: { action_facets: mocks.facets } }),
    registerClientToolExecutor: (
      name: string,
      _executor: unknown,
      isAvailable: () => boolean,
    ) => {
      mocks.available.set(name, isAvailable);
      return () => mocks.available.delete(name);
    },
    useFileCapabilities: (
      variables: { queryParams?: { model_id?: string } },
      options?: { enabled?: boolean },
    ) => {
      mocks.capabilityQueries.push({
        modelId: variables.queryParams?.model_id,
        enabled: options?.enabled,
      });
      return { data: options?.enabled ? mocks.capabilities : undefined };
    },
    findCapabilityByExtension: (
      filename: string,
      capabilities: FileCapability[],
    ) =>
      capabilities.find((capability) =>
        capability.extensions.includes(filename.split(".").pop() ?? ""),
      ) ?? null,
    hasSupportedOperations: (capability: FileCapability) =>
      capability.operations.length > 0,
    useUploadFeature: () => ({
      enabled: mocks.uploadEnabled,
      maxSizeBytes: 20 * 1024 * 1024,
      maxSizeFormatted: "20 MB",
    }),
    useChatInputControls: () => ({
      addUploadedFiles: (files: FileUploadItem[]) =>
        mocks.addUploadedFiles(files),
      removeUploadedFiles: () => {},
      focusInput: () => {},
    }),
    Row: ({
      children,
      onClick,
      disabled,
      "data-testid": testId,
    }: {
      children?: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
      "data-testid"?: string;
    }) => (
      <button
        type="button"
        data-testid={testId}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
    ),
  });
});

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
  installFakePowerPoint({
    slides: [{ id: "256#", shapes: [] }],
    selectedSlideIds: ["256#"],
  });
});

afterEach(() => {
  cleanup();
  removeFakePowerPoint();
  powerpointInclusionStore.resetForTests();
  mocks.composer = null;
  mocks.available.clear();
  mocks.capabilities = undefined;
  mocks.capabilityQueries = [];
  mocks.addUploadedFiles = () => {};
  mocks.menu = { uploadDisabled: false, onClose: () => {} };
  mocks.uploadEnabled = true;
  mocks.facets = [
    {
      id: "powerpoint_presentation",
      allowed_args: ["presentation_name", "read_tier", "selection_summary"],
    },
  ];
});

function renderInput(
  set = "1.10",
  {
    uploadFiles,
    maxFiles = 5,
    modelId = "vision-model",
  }: {
    uploadFiles?: AddinChatInputRenderProps["uploadFiles"];
    maxFiles?: number;
    modelId?: string;
  } = {},
) {
  const onSendMessage = vi.fn<AddinChatInputRenderProps["onSendMessage"]>();
  const props = {
    chatId: null,
    onSendMessage,
    uploadFiles,
    maxFiles,
    controlledSelectedModel: {
      chat_provider_id: modelId,
      model_display_name: modelId,
    },
  } as unknown as AddinChatInputRenderProps;
  render(
    <PowerPointChatInput
      chatInputProps={props}
      support={powerpointReadSupport(requirementsUpTo(set))}
    />,
  );
  return { onSendMessage };
}

const chip = () => mocks.composer?.contextItems?.[0] as ComposerContextItem;
const send = () =>
  act(() => mocks.composer!.onSendMessage("Summarise slide 1"));

describe("PowerPoint composer", () => {
  it("includes the presentation by default and sends the facet with the selection", async () => {
    const { onSendMessage } = renderInput();
    expect(chip()).toMatchObject({ state: "included", label: "Presentation" });
    send();
    const prepare = onSendMessage.mock.calls[0][11] as AddinSendPreparation;
    expect(prepare).toBeDefined();
    const prepared = await prepare.run(new AbortController().signal);
    expect(prepared).toEqual({
      hostContextIdentity: null,
      actionFacet: {
        id: "powerpoint_presentation",
        args: {
          presentation_name: "Untitled presentation",
          read_tier: "full (PowerPointApi 1.10)",
          selection_summary: "Selected slides: 1 (id 256#).",
        },
      },
    });
    expect(
      [...mocks.available.values()].every((isAvailable) => isAvailable()),
    ).toBe(true);
  });

  it("sends nothing of the presentation and withholds the tools once left out", () => {
    const { onSendMessage } = renderInput();
    act(() => chip().onRemove?.());
    expect(chip().state).toBe("suggested");
    send();
    expect(onSendMessage.mock.calls[0][4]).toBeUndefined();
    expect(onSendMessage.mock.calls[0][11]).toBeUndefined();
    expect(
      [...mocks.available.values()].some((isAvailable) => isAvailable()),
    ).toBe(false);
    act(() => chip().onRestore?.());
    expect(chip().state).toBe("included");
  });

  it("keeps the tools listed for the turn when inclusion is turned off after the send", () => {
    renderInput();
    send();
    act(() => chip().onRemove?.());
    expect(
      [...mocks.available.values()].every((isAvailable) => isAvailable()),
    ).toBe(true);
  });

  it("shows no chip, lists no tools and reads nothing when the server offers no PowerPoint facet", () => {
    mocks.facets = [];
    const host = installFakePowerPoint({ slides: [] });
    const { onSendMessage } = renderInput();
    expect(mocks.composer?.contextItems).toEqual([]);
    expect(
      [...mocks.available.values()].some((isAvailable) => isAvailable()),
    ).toBe(false);
    send();
    expect(onSendMessage.mock.calls[0][11]).toBeUndefined();
    expect(host.runs).toBe(0);
  });

  it("describes a basic host's reads in the chip from the same switches", () => {
    renderInput("1.9");
    const detail = render(
      <>{chip().detail?.render({ locked: false, runAction: () => {} })}</>,
    );
    expect(detail.container.textContent).toContain(
      "text boxes and their positions only",
    );
  });

  it("offers no selection read and no chip on a host that cannot read slides", () => {
    renderInput("1.3");
    expect(mocks.composer?.contextItems).toEqual([]);
    expect(mocks.available.size).toBe(0);
  });

  it("registers no selection read on PowerPointApi 1.4", () => {
    renderInput("1.4");
    expect([...mocks.available.keys()]).toEqual([
      "powerpoint_read_presentation",
      "powerpoint_read_slide",
    ]);
  });
});

describe("slide picture", () => {
  const SLIDES: FakeDeck = {
    slides: ["256#", "257#", "258#", "259#", "260#"].map((id) => ({
      id,
      shapes: [],
    })),
    selectedSlideIds: ["257#"],
  };
  const uploadedFor = (files: File[]): FileUploadItem[] =>
    files.map(
      (file, i) =>
        ({ id: `upload-${i}`, filename: file.name }) as FileUploadItem,
    );
  const row = () => screen.queryByTestId("powerpoint-add-menu-slide-picture");
  const chipAction = () => chip().detail?.actions?.[0];
  const offered = () => row() !== null && chipAction() !== undefined;

  beforeEach(() => {
    mocks.capabilities = VISION;
    installFakePowerPoint(SLIDES);
  });

  it("is offered on a full host, with the facet, the presentation included and a model that sees images", () => {
    renderInput();
    expect(offered()).toBe(true);
    expect(chipAction()?.label).toBe("Attach picture of selected slide");
    expect(mocks.capabilityQueries.at(-1)).toEqual({
      modelId: "vision-model",
      enabled: true,
    });
  });

  it("is not offered on the basic tier, without the facet, or with the presentation left out", () => {
    renderInput("1.9");
    expect(offered()).toBe(false);
    expect(mocks.capabilityQueries.every((query) => !query.enabled)).toBe(true);
    cleanup();

    mocks.facets = [];
    renderInput();
    expect(row()).toBeNull();
    expect(mocks.composer?.contextItems).toEqual([]);
    cleanup();

    mocks.facets = [
      {
        id: "powerpoint_presentation",
        allowed_args: ["presentation_name", "read_tier", "selection_summary"],
      },
    ];
    renderInput();
    expect(offered()).toBe(true);
    act(() => chip().onRemove?.());
    expect(offered()).toBe(false);
  });

  it("is not offered where the composer takes no uploads", () => {
    mocks.uploadEnabled = false;
    renderInput();
    expect(offered()).toBe(false);
    expect(mocks.capabilityQueries.every((query) => !query.enabled)).toBe(true);
  });

  it("is not offered while the selected model cannot see images", () => {
    mocks.capabilities = [{ ...VISION[0], operations: [] }];
    renderInput("1.10", { modelId: "text-only" });
    expect(offered()).toBe(false);
    expect(mocks.capabilityQueries.at(-1)?.modelId).toBe("text-only");
  });

  it("renders the selected slide, uploads it through the composer and stages it, holding Send meanwhile", async () => {
    let finishUpload: (items: FileUploadItem[]) => void = () => {};
    const uploadFiles = vi.fn(
      (_files: File[]) =>
        new Promise<FileUploadItem[] | undefined>((resolve) => {
          finishUpload = resolve;
        }),
    );
    const staged: FileUploadItem[][] = [];
    mocks.addUploadedFiles = (files) => staged.push(files);
    const onClose = vi.fn();
    mocks.menu.onClose = onClose;
    renderInput("1.10", { uploadFiles });

    fireEvent.click(row()!);
    expect(onClose).toHaveBeenCalled();
    expect(mocks.composer?.disabled).toBe(true);
    expect(mocks.composer?.composerNotice).toMatchObject({
      busy: true,
      tone: "info",
    });
    await waitFor(() => expect(uploadFiles).toHaveBeenCalledTimes(1));
    const [files] = uploadFiles.mock.calls[0];
    expect(files.map((file) => [file.name, file.type])).toEqual([
      ["slide-2.png", "image/png"],
    ]);
    expect(mocks.composer?.disabled).toBe(true);

    await act(async () => finishUpload(uploadedFor(files)));
    expect(staged).toEqual([[{ id: "upload-0", filename: "slide-2.png" }]]);
    expect(mocks.composer?.disabled).toBe(false);
    expect(mocks.composer?.composerNotice).toBeNull();
    expect(
      screen.getByTestId("powerpoint-composer-announcer").textContent,
    ).toBe("Slide picture attached.");
  });

  it("attaches nothing and says so when PowerPoint cannot make the picture", async () => {
    installFakePowerPoint({ ...SLIDES, pictureFails: true });
    const uploadFiles = vi.fn(async (files: File[]) => uploadedFor(files));
    const staged: FileUploadItem[][] = [];
    mocks.addUploadedFiles = (files) => staged.push(files);
    renderInput("1.10", { uploadFiles });

    act(() => chipAction()?.onSelect());
    await waitFor(() =>
      expect(mocks.composer?.composerNotice?.tone).toBe("error"),
    );
    expect(mocks.composer?.composerNotice?.text).toBe(
      "PowerPoint couldn't make the slide picture, so nothing was attached. Try again.",
    );
    expect(uploadFiles).not.toHaveBeenCalled();
    expect(staged).toEqual([]);
    expect(mocks.composer?.disabled).toBe(false);
    act(() => mocks.composer?.composerNotice?.onDismiss?.());
    expect(mocks.composer?.composerNotice).toBeNull();
  });

  it("attaches nothing and says so when the upload fails", async () => {
    const uploadFiles = vi.fn(async () => undefined);
    const staged: FileUploadItem[][] = [];
    mocks.addUploadedFiles = (files) => staged.push(files);
    renderInput("1.10", { uploadFiles });

    fireEvent.click(row()!);
    await waitFor(() =>
      expect(mocks.composer?.composerNotice?.tone).toBe("error"),
    );
    expect(mocks.composer?.composerNotice?.text).toBe(
      "The slide picture couldn't be uploaded, so it isn't attached.",
    );
    expect(staged).toEqual([]);
    expect(mocks.composer?.disabled).toBe(false);
  });

  it("attaches the first three of several selected slides and names how many were left out", async () => {
    installFakePowerPoint({
      ...SLIDES,
      selectedSlideIds: ["256#", "257#", "258#", "259#", "260#"],
    });
    const uploadFiles = vi.fn(async (files: File[]) => uploadedFor(files));
    renderInput("1.10", { uploadFiles });

    fireEvent.click(row()!);
    await waitFor(() =>
      expect(mocks.composer?.composerNotice?.busy).toBeFalsy(),
    );
    expect(uploadFiles.mock.calls[0][0].map((file) => file.name)).toEqual([
      "slide-1.png",
      "slide-2.png",
      "slide-3.png",
    ]);
    expect(mocks.composer?.composerNotice).toMatchObject({
      tone: "info",
      text: "Attached the first 3 of 5 selected slides. To add the other 2, select them and add again.",
    });
  });

  it("renders only as many slides as the message has room for, and none when it is full", async () => {
    installFakePowerPoint({
      ...SLIDES,
      selectedSlideIds: ["256#", "257#", "258#"],
    });
    const uploadFiles = vi.fn(async (files: File[]) => uploadedFor(files));
    renderInput("1.10", { uploadFiles, maxFiles: 5 });
    const four = Array.from(
      { length: 4 },
      (_, i) => ({ id: `f${i}`, filename: `f${i}.txt` }) as FileUploadItem,
    );
    act(() => mocks.composer?.onStagedFilesChange?.(four));

    fireEvent.click(row()!);
    await waitFor(() => expect(uploadFiles).toHaveBeenCalledTimes(1));
    expect(uploadFiles.mock.calls[0][0]).toHaveLength(1);

    act(() =>
      mocks.composer?.onStagedFilesChange?.([
        ...four,
        { id: "f4", filename: "f4.txt" } as FileUploadItem,
      ]),
    );
    await waitFor(() => expect(mocks.composer?.disabled).toBe(false));
    act(() => chipAction()?.onSelect());
    expect(mocks.composer?.composerNotice?.text).toBe(
      "This message has as many files as it can take. Remove one to add a slide picture.",
    );
    expect(uploadFiles).toHaveBeenCalledTimes(1);
  });

  it("sends without the picture once it is removed from the composer", async () => {
    const uploadFiles = vi.fn(async (files: File[]) => uploadedFor(files));
    const staged: FileUploadItem[][] = [];
    mocks.addUploadedFiles = (files) => staged.push(files);
    const { onSendMessage } = renderInput("1.10", { uploadFiles });

    fireEvent.click(row()!);
    await waitFor(() => expect(staged).toHaveLength(1));
    act(() => mocks.composer?.onStagedFilesChange?.(staged[0]));
    // The attachment tile's (x) is the composer's own; it reports the file gone.
    act(() => mocks.composer?.onStagedFilesChange?.([]));
    act(() => mocks.composer!.onSendMessage("What does this slide show?", []));

    expect(onSendMessage.mock.calls[0][1]).toEqual([]);
    expect(staged).toHaveLength(1);
    expect(mocks.composer?.composerNotice).toBeNull();
  });
});
