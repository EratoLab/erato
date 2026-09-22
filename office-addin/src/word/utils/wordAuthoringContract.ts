/** Protocol vocabulary belongs here; model behavior instructions come from deployment configuration. */
export const WORD_AUTHORING_CONTRACT = {
  version: 1,
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
    "{id,type:'paragraph',text,runs?,styleRef?,format?}; heading: {id,type:'heading',text,level:1..9,runs?,format?}; list-item: {id,type:'list-item',text,list:'group-id',level:0..8,ordered:boolean,runs?,styleRef?,format?}. Each paragraph is a distinct block; text has no newline. All list items in a group share ordered. Runs concatenate exactly to text.",
  runFormatting:
    "Each run has text plus optional bold,italic,underline,strike,caps,smallCaps:boolean; underlineStyle:single|double|dotted|dash|wave; fontFamily; fontSize in points; color/shading:6-digit hex; highlight:Word named color; verticalAlign:baseline|superscript|subscript; characterSpacing in points; language:BCP47.",
  paragraphFormatting:
    "format:{alignment:left|center|right|justify,spacingBefore?,spacingAfter?,lineSpacing?:{value,rule:multiple|exact|atLeast},indentLeft?,indentRight?,firstLineIndent?,keepNext?,keepTogether?,pageBreakBefore?,widowControl?,shading?,borders?,font?:run-format}. Measurements are points except multiple line spacing. Negative firstLineIndent means hanging indent. styleRef must be a returned paragraph style.",
  borders:
    "{top?,left?,bottom?,right?,between?,insideH?,insideV?}; each border {style:none|single|double|dotted|dashed|thick,color?,width?,space?}. Colors are 6-digit hex, width/space points.",
  table: {
    shape:
      "{id,type:'table',sourceRef?,columns?:[width-in-points,...],format?,rows:[{sourceIndex?,format?,cells:[{sourceIndex?,colSpan?,rowSpan?,format?,blocks?:[nested blocks]}]}]}",
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
  sections:
    "scope=document only. sections:[{id,source?:'section-1',after?:'output-id-or-kept-body-ref',layout?,headers?,footers?}]. The complete ordered section list replaces existing boundaries. The last section omits after; all others end after the named output block. The read record's afterBlock identifies its existing boundary. source retains that section's existing properties. An absent sections property preserves existing boundaries and requires their original relative order. headers/footers:{default?:storyId|null,first?:storyId|null,even?:storyId|null}; null removes that reference. layout:{orientation:portrait|landscape,width?,height?,margins?:{top,right,bottom,left,header,footer,gutter},columns?,columnSpacing?,break:nextPage|continuous|evenPage|oddPage,pageNumberStart?,differentFirstPage?,differentOddEvenPages?}. All dimensions are points.",
} as const;
