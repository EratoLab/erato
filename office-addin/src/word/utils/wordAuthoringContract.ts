import {
  MAX_PLAN_BYTES,
  MAX_WORD_SCOPE_BYTES,
} from "@erato/frontend/word-review";

/** The backend schema for word_submit_document_plan (erato-action-facets.toml) and its tool
 * description state the same numbers. Blocks per change have no count limit (ERMAIN-1193). */
export const MAX_WORD_SCOPED_CHANGES = 16;
export const MAX_WORD_SCOPED_SOURCES = 16;
const WORD_SCOPED_JSON = `about ${Math.floor(MAX_WORD_SCOPE_BYTES / 1000)},000 characters of JSON`;
export const WORD_SCOPED_SIZE = `${MAX_WORD_SCOPE_BYTES / 1024} KiB (${WORD_SCOPED_JSON})`;
/** The 24 KiB cap holds only after a target read; after a complete read a sparse change is
 * expanded into a full plan anyway, so it has a full plan's limit (ERMAIN-1287). */
export const WORD_SCOPED_LIMITS = `at most ${MAX_WORD_SCOPED_CHANGES} changes per collection (body, objects, stories, sections) and ${MAX_WORD_SCOPED_SOURCES} source refs per change; after a target read at most ${WORD_SCOPED_SIZE} per submission, after a complete read as much as a full plan (${MAX_PLAN_BYTES / 1024} KiB)`;
/** One rule for when a full plan is needed; the plan contract, tool description and facet prompt
 * carry the same sentence (ERMAIN-1186). Size alone never calls for a full plan (ERMAIN-1287). */
export const WORD_FULL_PLAN_RULE = `Use a full plan only to rewrite or reorder most of the document, or for more than ${MAX_WORD_SCOPED_CHANGES} changes per collection. Otherwise submit only the changes with scoped_edit, also after a complete read. A scoped_edit over ${WORD_SCOPED_JSON} after a target read needs the complete read first, then the same scoped_edit with its final readToken; when the document is too large for a complete read, submit what fits and continue in the next turn.`;
export const WORD_SCOPED_NEEDS_COMPLETE_READ = `Scoped submission exceeds ${WORD_SCOPED_SIZE}, the limit after a target read. Complete the full read and resubmit the same scoped_edit with its final readToken; after a complete read it may be as large as a full plan.`;
const WORD_SCOPED_WHAT_FITS = `submit at most ${WORD_SCOPED_JSON} now and tell the user the rest follows in the next turn.`;
export const WORD_SCOPED_TOO_LARGE_FOR_FULL_PLAN = `This document is too large for a full plan; ${WORD_SCOPED_WHAT_FITS}`;
export const WORD_SCOPED_OVER_COMPLETE_READ_BUDGET = `A complete read does not fit this request's model budget; ${WORD_SCOPED_WHAT_FITS}`;
export const WORD_SCOPED_EXPANDED_TOO_LARGE = `With the blocks it keeps, this change exceeds a full plan's ${MAX_PLAN_BYTES / 1024} KiB. Submit part of it now and tell the user the rest follows in the next turn.`;

export const WORD_SECTION_PROPERTIES =
  "headers/footers:{default?:storyId|null,first?:storyId|null,even?:storyId|null}; null removes that reference. layout:{orientation:portrait|landscape,width?,height?,margins?:{top,right,bottom,left,header,footer,gutter},columns?,columnSpacing?,break:nextPage|continuous|evenPage|oddPage,pageNumberStart?,differentFirstPage?,differentOddEvenPages?}. All dimensions are points.";

/** What every read's freshness leaves out, per host (ERMAIN-1005 F1; owner decision 2026-10-30). */
export const WORD_FRESHNESS_NOTICE =
  'freshness tracks the text this read returned. changes:"none" means no text change was seen since capturedAt; formatting-only edits, Track Changes toggles and Word\'s own proofing are not text changes (Word for the web does report formatting edits, so there they count), and Apply re-checks the live document before it changes anything.';

/** Protocol vocabulary belongs here; model behavior instructions come from deployment configuration. */
export const WORD_AUTHORING_CONTRACT = {
  version: 1,
  freshness: WORD_FRESHNESS_NOTICE,
  scopedEdit: {
    read: "read_document_blocks accepts {snapshot,documentIdentity,target:{kind?,text?,nearbyText?,ref?,refs?,throughRef?,offset?}}. Search filters are ANDed; text searches object text/properties and nearbyText searches adjacent body blocks. Five bounded candidates per page. An ambiguous search grants no scope. Select returned refs explicitly (at most 16), or ref/throughRef for a contiguous body range. For multiple dependencies, target:{queries:[selectors]} resolves them atomically into one readToken; every selector must resolve uniquely or select explicit refs/a range. Any missing or ambiguous query grants no scope for the entire batch. Query results identify refs by index; select or refine unresolved queries without reading the whole document. At most 16 distinct targets and 24 KiB for the combined response, including guidance/metadata. Optional include:[text|formatting|table|media|structures|stories|sections] requests guidance for new content as well as existing target kinds. Only overall ready grants a readToken; larger responses require a narrower selection or complete read.",
    input: `{snapshot,readToken,scoped_edit:{body?:[],objects?:[],stories?:[],sections?:[]}}. Supply only changes. The host retains every other source. Limits: ${WORD_SCOPED_LIMITS}; blocks per change have no count limit, so keep a long list or passage in one change. Split a longer source range into consecutive changes. ${WORD_FULL_PLAN_RULE} Overlapping changes are rejected. No full plans or draft repairs with scoped tokens.`,
    body: `{operation:'replace'|'delete'|'insert-before'|'insert-after'|'move-before'|'move-after',source?:[at most ${MAX_WORD_SCOPED_SOURCES} refs],anchor?:ref,blocks?:[typed blocks, any count],reason?:string}. Replace/delete/move source is an explicitly read contiguous range. Insert/move anchor must also be explicitly read and retained. Replacement/insertion uses the existing typed block contract. Delete needs a reason. Moves preserve the original source exactly.`,
    objects:
      "{ref:returned-object-ref,edit:{operation:'update'|'delete'|'unwrap',...properties}}. Read the exact object. After a complete read, ref is the containing block or story ref, two underscores and the object's target (b7__field-1). kind and native target are host-owned. Properties and supported operations follow structures.nativeEdit. The enclosing fragment is retained.",
    stories:
      "Existing story changes follow the stories contract and require a complete scoped read of that story. New notes need an explicitly read, retained body anchor. New headers/footers need a read section and an association in the same scoped submission. Deleting a story also removes its anchors/section references. Other stories are preserved.",
    sections:
      "Sparse section changes: {id,after?,layout?,headers?,footers?} or {id,delete:true}. Existing sections must be read. Changing a boundary needs a read retained body anchor; after:null makes the selected section final. Splitting a section needs its read section plus boundary. Removing a boundary requires both affected sections. Header/footer associations require read stories or stories created in the same submission. Host retains other sections and their properties.",
    authorization:
      "Scope is bound to document identity, immutable snapshot and request. readToken is a target read's token or the final token of a complete read; after a complete read every returned block, object, story and section counts as read. A target read's context neighbors do not grant write permission. Source reuse requires read references. Full-document plans still require complete pagination. Success stores the complete plan for review; it is not model continuation context.",
  },
  tableCell: {
    tool: "submit_document_plan",
    input:
      "{snapshot,readToken,table_cell:{sourceRef,rowIndex,cellIndex,expectedText,text}}",
    target:
      "One exact text update in a standalone, unmerged body table. sourceRef is a returned table object ref or simple table block ref; rowIndex and cellIndex are original zero-based row and physical cell sourceIndex values, not visual column numbers. expectedText must match the captured cell text exactly. Both text strings are single-line, at most 10000 characters.",
    scopedRead:
      "read_document_blocks accepts {snapshot,documentIdentity,table_cell:{nearbyText?,header?,rowLabel?,text?,sourceRef?,rowIndex?,cellIndex?,offset?}}. Text filters are case-insensitive substrings, ANDed; header means first row at the same physical cell index, rowLabel means first cell, nearbyText searches immediate body neighbors. Filters are at most 256 characters. At most five candidates per response. Only status=ready returns exact expectedText and a cell-scoped readToken; ambiguous/not-found/unsupported results grant no scope. Refine filters or select returned sourceRef and original indexes. Scoped context is limited to 4096 UTF-8 bytes per target; snippets are truncated explicitly. Unsupported cells use complete reads and the existing full-plan workflow. Scoped tokens accept only concise submissions, not plans or repairs.",
    preservation:
      "The host constructs the complete plan, keeps every other body source and table cell, and preserves the target paragraph/run properties. Supports one plain-text paragraph with uniform run formatting; nested tables, merged cells, wrappers, fields, links, mixed formatting and multiple paragraphs require a complete plan. Complete or explicitly scoped read, snapshot validation, submission budget and review/Apply are unchanged. Rejected concise arguments without a draft handle may be corrected with another concise submission.",
  },
  repair: {
    tool: "submit_document_plan",
    input:
      "{snapshot,readToken,draft_id,revision,patches:[{op:'add'|'replace',path,value}|{op:'remove',path}]}",
    draft:
      "A rejected submission may return submission_feedback.draft:{id,revision}. The handle is scoped to the current request and captured snapshot. Schema rejection before host execution has no draft handle.",
    patches:
      "Atomic RFC 6902 add/replace/remove subset, 1–32 operations. JSON Pointer paths address the submitted plan. Editable roots: scope, entries, deleted, stories, sections. Snapshot, readToken and version are immutable. Arrays use zero-based indexes; add also accepts '-' for append. Parents must exist. Each patch is applied in order; a malformed patch changes nothing.",
    revision:
      "Each changed rejected proposal advances the revision. Validation covers the complete materialized plan. Unchanged proposals with unchanged diagnostics end the submission turn. Full and repair submissions share the configured attempt budget. Acceptance persists the complete plan for review without writing to Word.",
  },
  plan: `{version:1,snapshot,readToken,scope:'body'|'document',entries:[keep|replace|insert],deleted?:[{source:[refs],reason}],stories?:[],sections?:[]}; omitted deleted means []. Source coverage must still be complete. ${WORD_FULL_PLAN_RULE}`,
  parts: {
    plan: "plan_document_sections {snapshot,readToken,intent,terms?,rows:[{source:'b1-b57,b60',action:'keep'|'rewrite'|'delete',change?,title?,reason?}]}. Rows are in output order and hold every body block exactly once: their order moves blocks, and several ranges in one rewrite row merge them. A rewrite row says its change, a delete row its reason; title renames the heading a keep row starts with, which then takes the built-in heading style of its level. Sending it again replaces it and keeps the parts of rewrite rows with the same blocks.",
    part: "write_document_section {snapshot,draft_id,row,ops:[{keep:refs}|{replace:refs,text}|{insert:text}|{delete:refs,reason}],allow?} per rewrite row. The ops use every block of the row exactly once, in output order. A rejected part changes nothing: send it again whole.",
    checks:
      "Each part is compared with the original: numbers and amounts, clause numbers such as (1), the section plan's terms, blocks repeated word for word, and a row that leaves more than half of its paragraphs unchanged. Finish also checks references to sections the change moves, merges or renumbers. allow lists a check (numbers, clause-numbering, term, kept-unchanged, cross-reference) whose change is intended, only when its error offers it; the card names it on the row.",
    text: "New text is plain text. One non-empty line is one block. # to ###### is a heading of that level. '- ' is a bullet and '1. ' a numbered item, two spaces of indent per level; a new list always starts at 1, a blank line between items keeps the list, and a later '1.' starts a new one. '| a | b |' is a table row; a |---| line after the first row makes it the header row. **bold** and *italic* work inside a line. A \\ at the start of a line keeps the line as text. A line that replaces a paragraph takes that paragraph's style; new tables take the document's table style. Anything else (other formatting, styles, continuing a list, merged cells, fields) is kept by reference or goes through scoped_edit.",
    finish:
      "submit_document_plan {snapshot,readToken,draft_id,revision,finish:true} with the latest receipt's revision checks the whole change and stages it like a full plan.",
  },
  ownership:
    "Every body source ref is consumed once by keep, replace or deleted. New nested block IDs are globally unique. Story sources and document_sections are separate read records, not body ownership refs. Keep preserves exact content. Replacement and deletion accept native objects. Source references are scoped to this immutable snapshot.",
  entries: {
    keep: { kind: "keep", source: ["b1"] },
    replace: {
      kind: "replace",
      source: ["b2"],
      blocks: [{ id: "n1", type: "paragraph", text: "Rewritten text" }],
    },
    insert: {
      kind: "insert",
      contextRefs: ["b3"],
      blocks: [{ id: "n2", type: "paragraph", text: "Additional text" }],
    },
  },
  paragraphs:
    "{id,type:'paragraph',text,runs?,styleRef?,format?}; heading: {id,type:'heading',text,level:1..9,runs?,format?}. A heading's captured styleRef is read-only metadata: never copy it into a heading block. The host chooses its built-in style from level; list-item: {id,type:'list-item',text,list:'group-id',level:0..8,ordered:boolean,runs?,styleRef?,format?}. Reuse a captured existing-* list name, level and ordered value to continue that exact list. A new group name creates a separate list; its items share ordered. Each paragraph is a distinct block; text has no newline. Runs concatenate exactly to text.",
  runFormatting:
    "Each run has text plus optional bold,italic,underline,strike,caps,smallCaps:boolean; underlineStyle:single|double|dotted|dash|wave; fontFamily; fontSize in points; color/shading:6-digit hex; highlight:Word named color; verticalAlign:baseline|superscript|subscript; characterSpacing in points; language:BCP47.",
  paragraphFormatting:
    "format:{alignment:left|center|right|justify,spacingBefore?,spacingAfter?,lineSpacing?:{value,rule:multiple|exact|atLeast},indentLeft?,indentRight?,firstLineIndent?,keepNext?,keepTogether?,pageBreakBefore?,widowControl?,shading?,borders?,font?:run-format}. Measurements are points except multiple line spacing. Negative firstLineIndent means hanging indent. styleRef must be a returned paragraph style. format and run formatting are direct formatting on top of the block's style, whose resolved look is styles[].look; omit them to keep the current look and set only properties the user asked to change.",
  borders:
    "{top?,left?,bottom?,right?,between?,insideH?,insideV?}; each border {style:none|single|double|dotted|dashed|thick,color?,width?,space?}. Colors are 6-digit hex, width/space points.",
  table: {
    shape:
      "{id,type:'table',sourceRef?,columns?:[width-in-points,...],format?,rows:[{sourceIndex?,format?,cells:[{sourceIndex?,colSpan?,rowSpan?,format?,blocks?:[nested blocks],textEdit?:{expectedText,text}}]}]}",
    textEdit:
      "A retained unmerged cell may use textEdit instead of blocks to replace its exact plain text while preserving paragraph/run properties. Requires one paragraph with uniform run formatting and a complete sourceRef/row.sourceIndex/cell.sourceIndex chain. expectedText must match the original source, not a previous proposal.",
    creation:
      "Without sourceRef the table is new: row.sourceIndex and cell.sourceIndex are invalid. Every cell requires blocks; blocks:[] represents an empty cell. Output positions are determined by rows/cells array order.",
    source:
      "sourceRef identifies a captured table via objects[].ref or a simple table block ref. row.sourceIndex requires table.sourceRef; cell.sourceIndex requires its row.sourceIndex. Indexes are the original zero-based inventory positions and remain unchanged when output order changes. A source row is referenced at most once per table, a source cell at most once per row. Only a cell with this complete source chain can omit blocks to retain exact contents; blocks:[] clears it, explicit blocks replaces it. A new row has no sourceIndex, and all its cells have no sourceIndex and require blocks. A new cell in a source row likewise has no sourceIndex and requires blocks. Rows/cells arrays specify the complete output order; omitted source rows/cells are deleted. sourcePatchSupported:false requires intact retention or a new typed table without sourceRef. For rowSpan, later rows omit covered slots.",
    columns:
      "Explicit column widths default to fixed layout and their summed width; widthPercent and layout:autofit support automatic widths.",
    format:
      "styleRef (returned table style),alignment:left|center|right,layout:fixed|autofit,width:number|'auto',widthPercent,indent,cellMargins:{top,left,bottom,right},borders,shading,firstRow,lastRow,firstColumn,lastColumn,bandedRows,bandedColumns,caption,description. Row format:{repeatHeader,allowSplit,height,heightRule:atLeast|exact}. Cell format:{verticalAlign:top|center|bottom,textDirection:horizontal|vertical|vertical270,margins,borders,shading,noWrap}.",
  },
  media: {
    image:
      "{id,type:'image',image:{sourceRef?,assetRef?,widthPt?,heightPt?,alt?,title?,alignment:left|center|right,rotation?,crop?:{left,right,top,bottom},border?:{color,widthPt},wrap:inline|square|top-bottom|behind|front}}. sourceRef resolves objects[].ref; assetRef resolves captured attachment metadata. Both together replace the image while retaining its layout. Crop requires all four edges as percentages 0..99; opposing edges sum to less than 100. Binary/base64 payloads and uncaptured asset references are unsupported.",
    drawing:
      "{id,type:'drawing',drawing:{sourceRef? OR shape:rect|roundRect|ellipse|line|triangle|diamond|rightArrow,text?,widthPt?,heightPt?,alt?,title?,alignment?,rotation?,fill?:hex|'none',line?:{color,widthPt},wrap?}}. Existing drawings retain unknown details through sourceRef.",
  },
  structures: {
    field:
      "{id,type:'field',field:{instruction:'PAGE',text:'1',locked?:boolean}}. Supported Word field instructions include PAGE,NUMPAGES,TOC,REF,DATE,DOCPROPERTY. Fields executing commands or fetching external resources are unavailable.",
    bookmark:
      "{id,type:'bookmark',bookmark:{name:'Identifier',children:[blocks]}}. Names start with letter/underscore, max 40 characters; no duplicates.",
    control:
      "{id,type:'content-control',control:{title?,tag?,lock:none|content|control|both,appearance:bounding-box|tags|hidden,color?:hex,children:[blocks]}}",
    nativeEdit:
      "{id,type:'native-edit',sourceRef:'b7',edits:[{kind,target,operation,...}]} retains the source fragment and changes only named objects. target resolves objects[].target. Kinds field,bookmark,content-control support update|unwrap|delete (unwrap retains contents). image,drawing support update|delete. field update:instruction?,text?,locked?; bookmark:name?,text?; content-control:title?,tag?,lock?,appearance?,color?,children?,binding:retain|remove; image:image:{...}; drawing:drawing:{...}. Delete removes the object's contents too. Selectors stay stable across one edit batch. Replacing mapped contents of a bound control requires binding:remove.",
  },
  stories:
    "scope=document, fullDocument=true only. stories:[{kind:'upsert'|'delete',type:'header'|'footer'|'footnote'|'endnote',id,blocks?,anchor?:{block:'output-id-or-kept-body-ref',start?,end?}}]. Upsert replaces all story blocks (empty clears); an omitted existing story is preserved. Delete removes the story. A new note requires a body anchor. start is a UTF-16 position in the anchor block's text as the read returned it (paragraphs of a block joined by newline, table cells by tab, hidden text left out), on a kept block or a new paragraph, heading or list item; a note is a point, so end, if given, equals start. Omit start to place the note at the end of the block. Existing note anchors stay unless explicitly moved. Existing story native sourceRef is 'story_'+id for native-edit/table/image references. Comment stories are read-only here: plans never add, edit or delete comments, and removing all of a comment's anchor text deletes its thread, which the user must confirm.",
  trackedChanges:
    "Passages that contain pending tracked changes are returned as native anchored-content. They cannot be edited until the user accepts or rejects those changes in Word: keep them and tell the user. While Track Changes is on, accepted edits are written as tracked changes under the user's name, and changes that need a full-document rewrite (sections, new or relinked headers/footers, moves, objects, formatting, new lists) cannot be applied.",
  sections: `scope=document only. sections:[{id,source?:'section-1',after?:'output-id-or-kept-body-ref',layout?,headers?,footers?}]. The complete ordered section list replaces existing boundaries. The last section omits after; all others end after the named output block. The read record's afterBlock identifies its existing boundary. source retains that section's existing properties. An absent sections property preserves existing boundaries and requires their original relative order. ${WORD_SECTION_PROPERTIES}`,
} as const;
