import {
  expect,
  fn,
  userEvent,
  waitForElementToBeRemoved,
  within,
} from "@storybook/test";

import { ImageContentDisplay } from "../../components/ui/Message/ImageContentDisplay";

import type { UiImagePart } from "@/utils/adapters/contentPartAdapter";
import type { Meta, StoryObj } from "@storybook/react";

const makeSvgDataUrl = ({
  width,
  height,
  label,
  fill,
}: {
  width: number;
  height: number;
  label: string;
  fill: string;
}) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="100%" height="100%" rx="24" fill="${fill}" />
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" font-family="Arial" font-size="36" fill="#111827">${label}</text>
    </svg>`,
  )}`;

const images: UiImagePart[] = [
  {
    id: "landscape",
    type: "image",
    src: makeSvgDataUrl({
      width: 1200,
      height: 720,
      label: "1200x720",
      fill: "#dbeafe",
    }),
  },
  {
    id: "portrait",
    type: "image",
    src: makeSvgDataUrl({
      width: 720,
      height: 1200,
      label: "720x1200",
      fill: "#dcfce7",
    }),
  },
];

const landscapeImage: UiImagePart[] = [images[0]];
const portraitImage: UiImagePart[] = [images[1]];

const brokenImage: UiImagePart[] = [
  {
    id: "broken-image",
    type: "image",
    src: "https://example.invalid/broken-image.png",
  },
];

const waitForLocaleLoader = async (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement);
  const loadingText = canvas.queryByText(/loading locale:/i);

  if (loadingText) {
    await waitForElementToBeRemoved(loadingText);
  }

  return canvas;
};

const meta = {
  title: "UI/ImageContentDisplay",
  component: ImageContentDisplay,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Focused validation stories for inline chat image previews. These cover the theme-backed sizing contract, interactive behavior, and the image load fallback state.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div className="bg-theme-bg-primary p-6">
        <div className="mx-auto max-w-3xl rounded-lg bg-theme-bg-secondary p-4">
          <Story />
        </div>
      </div>
    ),
  ],
  tags: ["autodocs"],
} satisfies Meta<typeof ImageContentDisplay>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PreviewSizing: Story = {
  args: {
    images,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Renders two aspect ratios side by side so the theme-backed max width and max height constraints are visible.",
      },
    },
  },
};

export const ClickablePreview: Story = {
  args: {
    images: landscapeImage,
    onImageClick: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = await waitForLocaleLoader(canvasElement);
    const button = await canvas.findByRole("button");
    const image = await canvas.findByRole("img", {
      name: "Message attachment",
    });

    await expect(button).toBeInTheDocument();
    await expect(button.tagName).toBe("BUTTON");
    await expect(button).toHaveAttribute("type", "button");
    await expect(image).toBeInTheDocument();
    await userEvent.click(button);
    await expect(args.onImageClick).toHaveBeenCalledTimes(1);
    await expect(args.onImageClick).toHaveBeenCalledWith(landscapeImage[0]);
  },
};

export const StaticPreview: Story = {
  args: {
    images: portraitImage,
    onImageClick: undefined,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Renders a single non-interactive preview. This should not expose button semantics or keyboard focus treatment.",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await waitForLocaleLoader(canvasElement);
    await canvas.findByRole("img", { name: "Message attachment" });

    await expect(canvas.queryByRole("button")).toBeNull();
    await expect(
      canvas.getByRole("img", { name: "Message attachment" }),
    ).toBeInTheDocument();
  },
};

export const LoadErrorFallback: Story = {
  args: {
    images: brokenImage,
  },
  play: async ({ canvasElement }) => {
    const canvas = await waitForLocaleLoader(canvasElement);
    const image = await canvas.findByRole("img", {
      name: "Message attachment",
    });

    image.dispatchEvent(new Event("error"));

    await expect(await canvas.findByText("Failed to load image")).toBeInTheDocument();
  },
};
