export const WORD_SECTION_PROPERTIES =
  "headers/footers:{default?:storyId|null,first?:storyId|null,even?:storyId|null}; null removes that reference. layout:{orientation:portrait|landscape,width?,height?,margins?:{top,right,bottom,left,header,footer,gutter},columns?,columnSpacing?,break:nextPage|continuous|evenPage|oddPage,pageNumberStart?,differentFirstPage?,differentOddEvenPages?}. All dimensions are points.";

/** Protocol vocabulary belongs here; model behavior instructions come from deployment configuration. */
export const WORD_AUTHORING_CONTRACT = {
  version: 1,
  scopedEdit: {
    read: "read_document_blocks accepts {snapshot,documentIdentity,target:{kind?,text?,nearbyText?,ref?,refs?,throughRef?,offset?}}. Search filters are ANDed; text searches object text/properties and nearbyText searches adjacent body blocks. Five bounded candidates per page. An ambiguous search grants no scope. Select returned refs explicitly (at most 16), or ref/throughRef for a contiguous body range. For multiple dependencies, target:{queries:[selectors]} resolves them atomically into one readToken; every selector must resolve uniquely or select explicit refs/a range. Any missing or ambiguous query grants no scope for the entire batch. Query results identify refs by index; select or refine unresolved queries without reading the whole document. At most 16 distinct targets and 24 KiB for the combined response, including guidance/metadata. Optional include:[text|formatting|table|media|structures|stories|sections] requests guidance for new content as well as existing target kinds. Only overall ready grants a readToken; larger responses require a narrower selection or complete read.",
    input:
      "{snapshot,readToken,scoped_edit:{body?:[],objects?:[],stories?:[],sections?:[]}}. Supply only changes. The host retains every other source. At most 16 changes per collection; overlapping changes are rejected. No full plans or draft repairs with scoped tokens.",
    body: "{operation:'replace'|'delete'|'insert-before'|'insert-after'|'move-before'|'move-after',source?:[refs],anchor?:ref,blocks?:[typed blocks],reason?:string}. Replace/delete/move source is an explicitly read contiguous range. Insert/move anchor must also be explicitly read and retained. Replacement/insertion uses the existing typed block contract. Delete needs a reason. Moves preserve the original source exactly.",
    objects:
      "{ref:returned-object-ref,edit:{operation:'update'|'delete'|'unwrap',...properties}}. Read the exact object. kind and native target are host-owned. Properties and supported operations follow structures.nativeEdit. The enclosing fragment is retained.",
    stories:
      "Existing story changes follow the stories contract and require a complete scoped read of that story. New notes/comments need an explicitly read, retained body anchor. New headers/footers need a read section and an association in the same scoped submission. Deleting a story also removes its anchors/section references. Other stories are preserved.",
    sections:
      "Sparse section changes: {id,after?,layout?,headers?,footers?} or {id,delete:true}. Existing sections must be read. Changing a boundary needs a read retained body anchor; after:null makes the selected section final. Splitting a section needs its read section plus boundary. Removing a boundary requires both affected sections. Header/footer associations require read stories or stories created in the same submission. Host retains other sections and their properties.",
    authorization:
      "Scope is bound to document identity, immutable snapshot and request. Context neighbors do not grant write permission. Source reuse requires read references. Full-document plans still require complete pagination. Success stores the complete plan for review; it is not model continuation context.",
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
  plan: "{version:1,snapshot,readToken,scope:'body'|'document',entries:[keep|replace|insert],deleted?:[{source:[refs],reason}],stories?:[],sections?:[]}; omitted deleted means []. Source coverage must still be complete.",
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
    "format:{alignment:left|center|right|justify,spacingBefore?,spacingAfter?,lineSpacing?:{value,rule:multiple|exact|atLeast},indentLeft?,indentRight?,firstLineIndent?,keepNext?,keepTogether?,pageBreakBefore?,widowControl?,shading?,borders?,font?:run-format}. Measurements are points except multiple line spacing. Negative firstLineIndent means hanging indent. styleRef must be a returned paragraph style.",
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
    "scope=document, fullDocument=true only. stories:[{kind:'upsert'|'delete',type:'header'|'footer'|'footnote'|'endnote'|'comment',id,blocks?,author?,initials?,anchor?:{block:'output-id-or-kept-body-ref',start?,end?}}]. Upsert replaces all story blocks (empty clears); an omitted existing story is preserved. Delete removes the story. New note/comment requires a body paragraph anchor. Offsets are UTF-16 positions; comments use start/end, notes a point. Existing note/comment anchors stay unless explicitly moved. Existing story native sourceRef is 'story_'+id for native-edit/table/image references. Author/initials only for comments.",
  trackedChanges:
    "Passages that contain pending tracked changes are returned as native anchored-content. They cannot be edited until the user accepts or rejects those changes in Word: keep them and tell the user. While Track Changes is on, accepted edits are written as tracked changes under the user's name, and changes that need a full-document rewrite (sections, new or relinked headers/footers, moves, objects, formatting, new lists) cannot be applied.",
  sections: `scope=document only. sections:[{id,source?:'section-1',after?:'output-id-or-kept-body-ref',layout?,headers?,footers?}]. The complete ordered section list replaces existing boundaries. The last section omits after; all others end after the named output block. The read record's afterBlock identifies its existing boundary. source retains that section's existing properties. An absent sections property preserves existing boundaries and requires their original relative order. ${WORD_SECTION_PROPERTIES}`,
} as const;
