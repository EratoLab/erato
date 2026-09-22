import { fetchTokenUsageEstimate } from "@erato/frontend/library";

import { WORD_AUTHORING_CONTRACT } from "./wordAuthoringContract";
import { wordReadableSourceBlock } from "./wordAuthoringReadData";
import { wordImageAssetMetadata } from "./wordImageAssetData";
import { wordSourceDetails } from "./wordRichContent";

import type { WordAuthoringSnapshot } from "./wordDocumentPlan";
import type { TokenUsageRequest } from "@erato/frontend/library";

type WordAuthoringBudgetResult =
  | { ok: true }
  | {
      ok: false;
      issue: "model-budget" | "budget-unavailable";
      details?: string[];
    };

/** A conservative preflight estimate; it cannot guarantee the model’s eventual output size. */
export async function checkWordAuthoringBudget(
  snapshot: WordAuthoringSnapshot,
  args: {
    message: string;
    chatId: string | null;
    assistantId?: string;
    modelId?: string;
    fileIds?: string[];
    signal?: AbortSignal;
  },
): Promise<WordAuthoringBudgetResult> {
  const source = JSON.stringify({
    contract: WORD_AUTHORING_CONTRACT,
    styles: snapshot.styles,
    blocks: snapshot.blocks.map(wordReadableSourceBlock),
    stories: snapshot.fullDocument
      ? snapshot.stories?.map(
          ({ xml, part: _part, nativeId: _nativeId, ...s }) => ({
            ...s,
            ...wordSourceDetails(xml, `story_${s.id}`),
          }),
        )
      : undefined,
    sections: snapshot.fullDocument
      ? snapshot.sections?.map(({ xml: _xml, ...s }) => s)
      : undefined,
    assets: snapshot.assets?.map(wordImageAssetMetadata),
    imageAssetIssues: snapshot.imageAssetIssues?.map(
      ({ fileId: _fileId, ...issue }) => issue,
    ),
  });
  const controller = new AbortController();
  const abort = () => controller.abort();
  args.signal?.addEventListener("abort", abort, { once: true });
  if (args.signal?.aborted) abort();
  const timeout = setTimeout(abort, 15000);
  try {
    const body: TokenUsageRequest = {
      user_message: [args.message, source, source, source].join("\n\n"),
    };
    // The generated schema does not express the backend's flattened chat selector.
    const request: Record<string, unknown> = body;
    if (args.chatId) request.existing_chat_id = args.chatId;
    else if (args.assistantId)
      request.new_chat = { assistant_id: args.assistantId };
    if (args.modelId) body.chat_provider_id = args.modelId;
    if (args.fileIds?.length) body.input_files_ids = args.fileIds;
    const response = await fetchTokenUsageEstimate({ body }, controller.signal);
    const { total_tokens, max_tokens } = response?.stats ?? {};
    if (
      !Number.isFinite(total_tokens) ||
      !Number.isFinite(max_tokens) ||
      total_tokens < 0 ||
      max_tokens <= 0
    )
      return {
        ok: false,
        issue: "budget-unavailable",
        details: ["estimate-invalid"],
      };
    return total_tokens + 8192 <= max_tokens * 0.9
      ? { ok: true }
      : { ok: false, issue: "model-budget" };
  } catch (error) {
    let detail = "estimate-failed";
    if (controller.signal.aborted)
      detail = args.signal?.aborted ? "estimate-cancelled" : "estimate-timeout";
    else if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number" &&
      Number.isInteger(error.status) &&
      error.status >= 400 &&
      error.status <= 599
    )
      detail = `estimate-http-${error.status}`;
    // Only diagnostic codes reach the model; never include backend payloads.
    return { ok: false, issue: "budget-unavailable", details: [detail] };
  } finally {
    clearTimeout(timeout);
    args.signal?.removeEventListener("abort", abort);
  }
}
