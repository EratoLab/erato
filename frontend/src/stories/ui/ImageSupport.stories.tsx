import { action } from "@storybook/addon-actions";

import { ChatMessage } from "../../components/ui/Chat/ChatMessage";
import { MessageContent } from "../../components/ui/Message/MessageContent";

import type { ContentPart } from "@/lib/generated/v1betaApi/v1betaApiSchemas";
import type { UiChatMessage } from "@/utils/adapters/messageAdapter";
import type { Meta, StoryObj } from "@storybook/react";

const meta = {
  title: "UI/Image Support",
  parameters: {
    layout: "centered",
    docs: {
      description: {
        component: `
Image support implementation for chat messages.

## Features
- Display images from base64 data
- Display images from download URLs (file pointers)
- Mixed text and image content
- Image lightbox for full-screen preview
- Error handling for failed image loads
- Lazy loading for performance
        `,
      },
    },
  },
} satisfies Meta;

export default meta;

// Test data
const textOnlyContent: ContentPart[] = [
  {
    content_type: "text",
    text: "This is a text-only message with no images.",
  },
];

const imageOnlyContent: ContentPart[] = [
  {
    content_type: "image_file_pointer",
    file_upload_id: "test-image-1",
    download_url: "https://picsum.photos/400/300",
  },
];

const mixedContent: ContentPart[] = [
  {
    content_type: "text",
    text: "Here's the image you requested:",
  },
  {
    content_type: "image_file_pointer",
    file_upload_id: "test-image-2",
    download_url: "https://picsum.photos/500/400",
  },
  {
    content_type: "text",
    text: "\n\nWhat do you think about it?",
  },
];

const multipleImagesContent: ContentPart[] = [
  {
    content_type: "text",
    text: "I generated three variations for you:",
  },
  {
    content_type: "image_file_pointer",
    file_upload_id: "test-image-3",
    download_url: "https://picsum.photos/300/300?random=1",
  },
  {
    content_type: "image_file_pointer",
    file_upload_id: "test-image-4",
    download_url: "https://picsum.photos/300/300?random=2",
  },
  {
    content_type: "image_file_pointer",
    file_upload_id: "test-image-5",
    download_url: "https://picsum.photos/300/300?random=3",
  },
  {
    content_type: "text",
    text: "\n\nWhich one do you prefer?",
  },
];

// Base64 image (small test image)
const base64TestImage =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const base64ImageContent: ContentPart[] = [
  {
    content_type: "text",
    text: "Here's a base64 encoded image:",
  },
  {
    content_type: "image",
    base64_data: base64TestImage,
  },
];

// Story components
export const TextOnlyMessage: StoryObj = {
  render: () => (
    <div className="w-96">
      <MessageContent content={textOnlyContent} />
    </div>
  ),
};

export const ImageOnlyMessage: StoryObj = {
  render: () => (
    <div className="w-96">
      <MessageContent content={imageOnlyContent} />
    </div>
  ),
};

export const MixedTextAndImage: StoryObj = {
  render: () => (
    <div className="w-96">
      <MessageContent content={mixedContent} />
    </div>
  ),
};

export const MultipleImages: StoryObj = {
  render: () => (
    <div className="w-full max-w-3xl">
      <MessageContent content={multipleImagesContent} />
    </div>
  ),
};

export const Base64Image: StoryObj = {
  render: () => (
    <div className="w-96">
      <MessageContent content={base64ImageContent} />
    </div>
  ),
};

const FullChatMessageWithImageRender = () => {
  const message: UiChatMessage = {
    id: "msg-1",
    content: mixedContent,
    role: "assistant",
    sender: "assistant",
    authorId: "assistant-1",
    createdAt: new Date().toISOString(),
  };

  return (
    <div className="w-full max-w-3xl">
      <ChatMessage
        message={message}
        controlsContext={{
          currentUserId: "user-1",
          dialogOwnerId: "user-1",
          isSharedDialog: false,
        }}
        onMessageAction={async (act) => {
          action("message-action")(act);
          return true;
        }}
        showAvatar={true}
        showTimestamp={true}
      />
    </div>
  );
};

export const FullChatMessageWithImage: StoryObj = {
  render: FullChatMessageWithImageRender,
};

export const ErrorHandling: StoryObj = {
  render: () => {
    const brokenImageContent: ContentPart[] = [
      {
        content_type: "text",
        text: "This image should fail to load:",
      },
      {
        content_type: "image_file_pointer",
        file_upload_id: "broken-image",
        download_url: "https://invalid-url-that-will-404.example.com/image.png",
      },
    ];

    return (
      <div className="w-96">
        <MessageContent content={brokenImageContent} />
      </div>
    );
  },
};
