import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useChatInputHandlers } from "../useChatInputHandlers";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

describe("useChatInputHandlers", () => {
  it("deduplicates uploaded files by id when the same upload is reported twice", () => {
    const onAttachmentsChanged = vi.fn();
    const uploadedFile = {
      id: "file-1",
      filename: "sample-report-compressed.pdf",
      download_url: "https://files.example.com/sample-report-compressed.pdf",
    } as unknown as FileUploadItem;

    const { result } = renderHook(() =>
      useChatInputHandlers(5, onAttachmentsChanged),
    );

    act(() => {
      result.current.handleFilesUploaded([uploadedFile]);
    });

    act(() => {
      result.current.handleFilesUploaded([uploadedFile]);
    });

    expect(result.current.attachedFiles).toEqual([uploadedFile]);
    expect(onAttachmentsChanged).toHaveBeenLastCalledWith([uploadedFile]);
  });

  it("replaces existing transcription attachments with the latest upload and keeps non-audio files", () => {
    const onAttachmentsChanged = vi.fn();
    const existingFile = {
      id: "file-doc",
      filename: "notes.txt",
      download_url: "https://files.example.com/notes.txt",
      audio_transcription: null,
    } as unknown as FileUploadItem;
    const existingAudio = {
      id: "audio-1",
      filename: "memo-1.webm",
      download_url: "https://files.example.com/memo-1.webm",
      audio_transcription: { status: "completed", transcript: "first capture" },
    } as unknown as FileUploadItem;
    const nextAudio = {
      id: "audio-2",
      filename: "memo-2.webm",
      download_url: "https://files.example.com/memo-2.webm",
      audio_transcription: {
        status: "completed",
        transcript: "latest capture",
      },
    } as unknown as FileUploadItem;

    const { result } = renderHook(() =>
      useChatInputHandlers(5, onAttachmentsChanged, [
        existingFile,
        existingAudio,
      ]),
    );

    act(() => {
      result.current.handleFilesUploaded([existingFile, nextAudio]);
    });

    expect(result.current.attachedFiles).toEqual([existingFile, nextAudio]);
    expect(onAttachmentsChanged).toHaveBeenLastCalledWith([
      existingFile,
      nextAudio,
    ]);
  });

  it("keeps only one audio transcription attachment and uses the latest one when multiple audio uploads arrive together", () => {
    const onAttachmentsChanged = vi.fn();
    const incomingAudioA = {
      id: "audio-a",
      filename: "batch-a.webm",
      download_url: "https://files.example.com/batch-a.webm",
      audio_transcription: { status: "completed" },
    } as unknown as FileUploadItem;
    const incomingAudioB = {
      id: "audio-b",
      filename: "batch-b.webm",
      download_url: "https://files.example.com/batch-b.webm",
      audio_transcription: { status: "completed" },
    } as unknown as FileUploadItem;

    const { result } = renderHook(() =>
      useChatInputHandlers(5, onAttachmentsChanged),
    );

    act(() => {
      result.current.handleFilesUploaded([incomingAudioA, incomingAudioB]);
    });

    expect(result.current.attachedFiles).toEqual([incomingAudioB]);
    expect(onAttachmentsChanged).toHaveBeenLastCalledWith([incomingAudioB]);
  });
});
