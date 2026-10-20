import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { server } from "@/lib/mocks/server";
import {
  teamsIndex,
  teamsMessage,
  teamsSection,
  teamsTranscriptText,
} from "@/test/teamsTranscriptFixtures";
import { forgetStoredTeamsTranscripts } from "@/utils/teams/storedTeamsTranscript";

import { useSentTeamsTranscriptContextItems } from "./useSentTeamsTranscriptContextItems";

import type { FileUploadItem } from "@/lib/generated/v1betaApi/v1betaApiSchemas";

const upload = (id: string, filename: string) =>
  ({
    id,
    filename,
    download_url: `https://example.invalid/${id}`,
  }) as FileUploadItem;

const transcript = upload("t1", "teams-Product_sync.md");
const report = upload("f1", "teams-file-abcd1234-report.pdf");
const own = upload("o1", "budget.xlsx");
const files = [transcript, report, own];

const serve = () =>
  server.use(
    http.get("https://example.invalid/t1", () =>
      HttpResponse.text(
        teamsTranscriptText(
          teamsIndex(
            [teamsSection()],
            [
              teamsMessage("m1", {
                assets: [
                  { name: report.filename, displayName: null, kind: "file" },
                ],
              }),
            ],
          ),
        ),
      ),
    ),
  );

describe("useSentTeamsTranscriptContextItems", () => {
  afterEach(forgetStoredTeamsTranscripts);

  it("is loading while the stored transcript is read, then included", async () => {
    serve();
    const onRemoveFiles = vi.fn();
    const { result } = renderHook(() =>
      useSentTeamsTranscriptContextItems(files, { onRemoveFiles }),
    );

    expect(result.current).toHaveLength(1);
    expect(result.current[0].state).toBe("loading");
    expect(result.current[0].id).toBe("teams.transcript:t1");
    expect(result.current[0].claimsFileIds).toEqual(["t1", "f1"]);

    await waitFor(() => expect(result.current[0].state).toBe("included"));
    expect(result.current[0].origin).toBe("user");
    expect(result.current[0].claimsFileIds).toEqual(["t1", "f1"]);
  });

  it("removes the transcript with its files, and offers no Edit selection", async () => {
    serve();
    const onRemoveFiles = vi.fn();
    const { result } = renderHook(() =>
      useSentTeamsTranscriptContextItems(files, { onRemoveFiles }),
    );
    await waitFor(() => expect(result.current[0].state).toBe("included"));

    result.current[0].onRemove?.();
    expect(onRemoveFiles).toHaveBeenCalledWith(["t1", "f1"]);
    expect(result.current[0].detail?.actions).toEqual([]);
  });

  it("keeps its identity across renders that change nothing it shows", async () => {
    serve();
    const options = { onRemoveFiles: vi.fn() };
    const { result, rerender } = renderHook(
      ({ list }: { list: FileUploadItem[] }) =>
        useSentTeamsTranscriptContextItems(list, options),
      { initialProps: { list: files } },
    );
    await waitFor(() => expect(result.current[0].state).toBe("included"));
    const items = result.current;

    rerender({ list: [...files] });
    expect(result.current).toBe(items);
  });
});
