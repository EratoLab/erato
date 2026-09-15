"use strict";
export const validateIndexingResetV1Result = validate10;
const schema11 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-reset-v1-result.schema.json","title":"IndexingResetV1Result","description":"Returned only after processing has stopped, database handles have closed, and every managed indexing file has been removed. Does not merely acknowledge scheduling a reset.","type":"object","properties":{"completed":{"const":true},"completedAt":{"type":"string","format":"date-time"},"state":{"const":"stopped"}},"required":["completed","completedAt","state"],"additionalProperties":true};
const formats0 = { validate: (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value)) };

function validate10(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-reset-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.completed === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "completed"},message:"must have required property '"+"completed"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.completedAt === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "completedAt"},message:"must have required property '"+"completedAt"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.state === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.completed !== undefined){
if(true !== data.completed){
const err3 = {instancePath:instancePath+"/completed",schemaPath:"#/properties/completed/const",keyword:"const",params:{allowedValue: true},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.completedAt !== undefined){
let data1 = data.completedAt;
if(typeof data1 === "string"){
if(!(formats0.validate(data1))){
const err4 = {instancePath:instancePath+"/completedAt",schemaPath:"#/properties/completedAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/completedAt",schemaPath:"#/properties/completedAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.state !== undefined){
if("stopped" !== data.state){
const err6 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/const",keyword:"const",params:{allowedValue: "stopped"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
else {
const err7 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
validate10.errors = vErrors;
return errors === 0;
}

export const validateIndexingResetV1Params = validate11;
const schema12 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-reset-v1-params.schema.json","title":"IndexingResetV1Params","description":"Fully reset all indexing storage managed by this sidecar for the current OS user. No mailbox, generation, or filesystem-path selector is supported. This command deletes index data; it is not a generation rebuild.","type":"object","properties":{},"additionalProperties":true};

function validate11(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-reset-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
}
else {
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
validate11.errors = vErrors;
return errors === 0;
}

export const validateIndexingStatusV1Result = validate12;
const schema13 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-status-v1-result.schema.json","title":"IndexingStatusV1Result","type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"sessionId":{"type":"string","minLength":1},"uptimeSeconds":{"type":"number","minimum":0},"state":{"type":"string","enum":["running","stopping","stopped","blocked"]},"effectiveConfiguration":{"$ref":"#/definitions/EffectiveIndexingConfiguration"},"resources":{"$ref":"#/definitions/Resources"},"generations":{"type":"array","items":{"$ref":"#/definitions/Generation"}},"discovery":{"type":"array","items":{"$ref":"#/definitions/DiscoverySource"}},"search":{"$ref":"#/definitions/SearchStatistics"},"resetInProgress":{"type":"boolean","default":false,"description":"True while a full reset is draining activity or deleting files. State is stopping during reset. Optional; absence means false."},"indexingDirectory":{"type":"string","minLength":1,"pattern":"^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)","description":"Absolute local filesystem path of the sidecar-managed indexing root, in the sidecar OS native path syntax (not a URI). Report it even before initialization or after reset, without creating the directory. Updated implementations must include it; optional in the wire schema for compatibility with older v1 servers."}},"required":["sampledAt","sessionId","uptimeSeconds","state","effectiveConfiguration","resources","generations","discovery","search"],"additionalProperties":true,"definitions":{"EffectiveIndexingConfiguration":{"type":"object","properties":{"parallelism":{"type":"integer","minimum":1,"maximum":9007199254740991},"documentsPerMinute":{"type":"integer","minimum":1,"maximum":9007199254740991}},"required":["parallelism","documentsPerMinute"],"additionalProperties":true},"UnavailableMetric":{"type":"object","properties":{"metric":{"type":"string","minLength":1},"reason":{"type":"string","minLength":1}},"required":["metric","reason"],"additionalProperties":true,"description":"Metric is a dotted path relative to its containing section. Every unavailable null measurement must have an entry; zero means an observed zero."},"ProcessResources":{"type":"object","properties":{"processCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"cpuCoresUsed":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"memoryResidentBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"memoryResidentPeakBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"diskReadBytesPerSecond":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"diskWriteBytesPerSecond":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableMetrics":{"type":"array","items":{"$ref":"#/definitions/UnavailableMetric"}}},"required":["processCount","cpuCoresUsed","memoryResidentBytes","memoryResidentPeakBytes","diskReadBytesPerSecond","diskWriteBytesPerSecond","unavailableMetrics"],"additionalProperties":true,"description":"Sidecar measurements include search and discovery. Worker measurements aggregate extraction children, including CPU/I/O accrued by children that exit between samples. Resident sums may double-count shared pages; peak is the maximum simultaneously observed aggregate since process startup."},"DiskUsage":{"type":"object","properties":{"allocatedBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"logicalBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]}},"required":["allocatedBytes","logicalBytes"],"additionalProperties":true},"Resources":{"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"observationSeconds":{"type":"number","minimum":0},"sidecar":{"$ref":"#/definitions/ProcessResources"},"extractionWorkers":{"$ref":"#/definitions/ProcessResources"},"disk":{"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"allocatedBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"logicalBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"availableBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"breakdown":{"type":"object","properties":{"control":{"$ref":"#/definitions/DiskUsage"},"catalog":{"$ref":"#/definitions/DiskUsage"},"activeIndex":{"$ref":"#/definitions/DiskUsage"},"buildingIndex":{"$ref":"#/definitions/DiskUsage"},"retiredIndexes":{"$ref":"#/definitions/DiskUsage"},"wal":{"$ref":"#/definitions/DiskUsage"},"temporary":{"$ref":"#/definitions/DiskUsage"}},"required":["control","catalog","activeIndex","buildingIndex","retiredIndexes","wal","temporary"],"additionalProperties":true},"unavailableMetrics":{"type":"array","items":{"$ref":"#/definitions/UnavailableMetric"}}},"required":["sampledAt","allocatedBytes","logicalBytes","availableBytes","breakdown","unavailableMetrics"],"additionalProperties":true},"liveExtractionWorkers":{"type":"array","description":"Individual currently live workers. Their memory sums can double-count shared pages. Aggregate CPU/I/O above also includes workers that exited during the sample.","items":{"type":"object","properties":{"processId":{"type":"integer","minimum":1,"maximum":9007199254740991},"sampledAt":{"type":"string","format":"date-time"},"resources":{"$ref":"#/definitions/ProcessResources"}},"required":["processId","sampledAt","resources"],"additionalProperties":true}}},"required":["sampledAt","observationSeconds","sidecar","extractionWorkers","disk","liveExtractionWorkers"],"additionalProperties":true},"ThroughputWindow":{"type":"object","properties":{"targetWindowSeconds":{"type":"integer","enum":[60,300]},"observationSeconds":{"type":"number","minimum":0},"sampleCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"indexedPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"emptyPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unindexablePerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"completedPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"attemptsPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"retriesPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"deletionsPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"extractedTextBytesPerSecond":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["targetWindowSeconds","observationSeconds","sampleCount","indexedPerMinute","emptyPerMinute","unindexablePerMinute","completedPerMinute","attemptsPerMinute","retriesPerMinute","deletionsPerMinute","extractedTextBytesPerSecond","unavailableReason"],"additionalProperties":true},"Backlog":{"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"discoveryComplete":{"type":"boolean"},"remaining":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"ready":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"inProgress":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"retryDeferred":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"blocked":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"firstTime":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"updates":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sampledAt","discoveryComplete","remaining","ready","inProgress","retryDeferred","blocked","firstTime","updates","unavailableReason"],"additionalProperties":true,"description":"Counts concern current eligible revisions, not queue entries. remaining = ready + inProgress + retryDeferred + blocked = firstTime + updates. Incomplete discovery still permits exact counts for known work. Terminal outcomes and deletion-only cleanup are excluded."},"Eta":{"type":"object","properties":{"state":{"type":"string","enum":["available","unavailable"]},"estimatedRemainingSeconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"estimatedCompletionAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"basis":{"const":"knownBacklog"},"rateWindowSeconds":{"type":"integer","enum":[60,300]},"observationSeconds":{"type":"number","minimum":0},"sampleCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["state","estimatedRemainingSeconds","estimatedCompletionAt","basis","rateWindowSeconds","observationSeconds","sampleCount","unavailableReason"],"additionalProperties":true,"allOf":[{"if":{"properties":{"state":{"const":"available"}},"required":["state"]},"then":{"properties":{"estimatedRemainingSeconds":{"type":"number","minimum":0},"estimatedCompletionAt":{"type":"string","format":"date-time"},"unavailableReason":{"type":"null"}}},"else":{"properties":{"estimatedRemainingSeconds":{"type":"null"},"estimatedCompletionAt":{"type":"null"},"unavailableReason":{"type":"string","minLength":1}}}}]},"Coverage":{"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"knownEligible":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"indexedCurrent":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"emptyCurrent":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unindexableCurrent":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"stale":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"neverProcessed":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"pendingDeletions":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sampledAt","knownEligible","indexedCurrent","emptyCurrent","unindexableCurrent","stale","neverProcessed","pendingDeletions","unavailableReason"],"additionalProperties":true,"description":"knownEligible is the sum of the five mutually exclusive revision states. stale means an older receipt exists, including an older failed receipt. pendingDeletions is separate. These counts do not imply discovery is complete."},"DepthBoundary":{"type":"object","properties":{"at":{"type":"string","format":"date-time"},"inclusive":{"type":"boolean"}},"required":["at","inclusive"],"additionalProperties":true,"description":"All known eligible dated documents between this boundary and the snapshot are covered; inclusive says whether documents exactly at the boundary are included. An old pending document makes an exclusive boundary possible without rounding timestamps."},"Depth":{"type":"object","properties":{"state":{"type":"string","enum":["applicable","notApplicable","unknown"]},"dateBasis":{"anyOf":[{"type":"string","enum":["emailReceivedAtThenSentAt","parentEmailReceivedAtThenSentAt","sourceDefined"]},{"type":"null"}]},"sourceDateField":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"discoveryComplete":{"type":"boolean"},"oldestIndexedDocumentAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"fullyIndexedSince":{"anyOf":[{"$ref":"#/definitions/DepthBoundary"},{"type":"null"}]},"processedSince":{"anyOf":[{"$ref":"#/definitions/DepthBoundary"},{"type":"null"}]},"pendingDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unindexableDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"undatedDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["state","dateBasis","sourceDateField","discoveryComplete","oldestIndexedDocumentAt","fullyIndexedSince","processedSince","pendingDocuments","unindexableDocuments","undatedDocuments","unavailableReason"],"additionalProperties":true,"description":"Only applicable to chronologically prioritized kinds. fullyIndexedSince requires current indexed/empty receipts; processedSince also accepts current terminal failures. Unknown dates are excluded from the boundary and counted explicitly. Oldest indexed date alone makes no coverage claim."},"Latency":{"type":"object","properties":{"observationSeconds":{"type":"number","minimum":0},"sampleCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"p50Seconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"p95Seconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["observationSeconds","sampleCount","p50Seconds","p95Seconds","unavailableReason"],"additionalProperties":true,"description":"Freshness is measured from discovery of a revision until its first searchable commit. Retry attempts do not reset the start; failed/empty/deleted revisions are excluded."},"ErrorCount":{"type":"object","properties":{"code":{"type":"string","minLength":1},"count":{"type":"integer","minimum":0,"maximum":9007199254740991},"lastOccurredAt":{"type":"string","format":"date-time"}},"required":["code","count","lastOccurredAt"],"additionalProperties":true},"ErrorWindow":{"type":"object","properties":{"observationSeconds":{"type":"number","minimum":0},"attemptFailures":{"type":"integer","minimum":0,"maximum":9007199254740991},"terminalFailures":{"type":"integer","minimum":0,"maximum":9007199254740991},"byCode":{"type":"array","items":{"$ref":"#/definitions/ErrorCount"}},"truncated":{"type":"boolean"}},"required":["observationSeconds","attemptFailures","terminalFailures","byCode","truncated"],"additionalProperties":true,"description":"Bounded recent error-code histogram, without content or filesystem paths. Counts include all failures even when byCode is truncated."},"Segment":{"type":"object","properties":{"kind":{"type":"string","enum":["email","file"]},"sourceId":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"mailboxId":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"fileType":{"anyOf":[{"type":"string","enum":["pdf","office","text","image","email","archive","other"]},{"type":"null"}]},"throughput":{"type":"array","items":{"$ref":"#/definitions/ThroughputWindow"}},"backlog":{"$ref":"#/definitions/Backlog"},"eta":{"$ref":"#/definitions/Eta"},"coverage":{"$ref":"#/definitions/Coverage"},"depth":{"$ref":"#/definitions/Depth"},"freshness":{"$ref":"#/definitions/Latency"},"errors":{"$ref":"#/definitions/ErrorWindow"}},"required":["kind","sourceId","mailboxId","fileType","throughput","backlog","eta","coverage","depth","freshness","errors"],"additionalProperties":true,"description":"Null source/mailbox denotes an all-source aggregate. Non-null scopes are independent views, not additional documents. Null fileType denotes all file types; breakdowns apply only to file rows. There must be one 60-second and one 300-second throughput window per segment."},"Generation":{"type":"object","properties":{"instanceId":{"type":"string","minLength":1},"role":{"type":"string","enum":["active","building"]},"sampledAt":{"type":"string","format":"date-time"},"segments":{"type":"array","items":{"$ref":"#/definitions/Segment"}},"chunks":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"terms":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"indexedAvgdl":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"observedAvgdl":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["instanceId","role","sampledAt","segments","chunks","terms","indexedAvgdl","observedAvgdl","unavailableReason"],"additionalProperties":true,"description":"Active and building counters have independent revision receipts. Never sum generations to estimate mailbox progress. An extraction shared across generations can appear in both generation throughput views."},"DiscoverySource":{"type":"object","properties":{"sourceId":{"type":"string","minLength":1},"mailboxId":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"state":{"type":"string","enum":["notStarted","scanning","complete","failed","disabled"]},"discoveryComplete":{"type":"boolean"},"scanStartedAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"lastSuccessfulScanAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"discoveredDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"accessible":{"type":"boolean"},"lastErrorCode":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sourceId","mailboxId","state","discoveryComplete","scanStartedAt","lastSuccessfulScanAt","discoveredDocuments","accessible","lastErrorCode"],"additionalProperties":true,"description":"discoveryComplete refers to the current inventory snapshot; a successful older scan does not imply a current scan is complete."},"SearchStatistics":{"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"observationSeconds":{"type":"number","minimum":0},"queryCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"errorCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"inFlight":{"type":"integer","minimum":0,"maximum":9007199254740991},"p50LatencyMilliseconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"p95LatencyMilliseconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sampledAt","observationSeconds","queryCount","errorCount","inFlight","p50LatencyMilliseconds","p95LatencyMilliseconds","unavailableReason"],"additionalProperties":true}}};
const schema14 = {"type":"object","properties":{"parallelism":{"type":"integer","minimum":1,"maximum":9007199254740991},"documentsPerMinute":{"type":"integer","minimum":1,"maximum":9007199254740991}},"required":["parallelism","documentsPerMinute"],"additionalProperties":true};
const schema38 = {"type":"object","properties":{"sourceId":{"type":"string","minLength":1},"mailboxId":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"state":{"type":"string","enum":["notStarted","scanning","complete","failed","disabled"]},"discoveryComplete":{"type":"boolean"},"scanStartedAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"lastSuccessfulScanAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"discoveredDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"accessible":{"type":"boolean"},"lastErrorCode":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sourceId","mailboxId","state","discoveryComplete","scanStartedAt","lastSuccessfulScanAt","discoveredDocuments","accessible","lastErrorCode"],"additionalProperties":true,"description":"discoveryComplete refers to the current inventory snapshot; a successful older scan does not imply a current scan is complete."};
const schema39 = {"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"observationSeconds":{"type":"number","minimum":0},"queryCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"errorCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"inFlight":{"type":"integer","minimum":0,"maximum":9007199254740991},"p50LatencyMilliseconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"p95LatencyMilliseconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sampledAt","observationSeconds","queryCount","errorCount","inFlight","p50LatencyMilliseconds","p95LatencyMilliseconds","unavailableReason"],"additionalProperties":true};
const func2 = (value) => Array.from(value).length;
const schema15 = {"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"observationSeconds":{"type":"number","minimum":0},"sidecar":{"$ref":"#/definitions/ProcessResources"},"extractionWorkers":{"$ref":"#/definitions/ProcessResources"},"disk":{"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"allocatedBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"logicalBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"availableBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"breakdown":{"type":"object","properties":{"control":{"$ref":"#/definitions/DiskUsage"},"catalog":{"$ref":"#/definitions/DiskUsage"},"activeIndex":{"$ref":"#/definitions/DiskUsage"},"buildingIndex":{"$ref":"#/definitions/DiskUsage"},"retiredIndexes":{"$ref":"#/definitions/DiskUsage"},"wal":{"$ref":"#/definitions/DiskUsage"},"temporary":{"$ref":"#/definitions/DiskUsage"}},"required":["control","catalog","activeIndex","buildingIndex","retiredIndexes","wal","temporary"],"additionalProperties":true},"unavailableMetrics":{"type":"array","items":{"$ref":"#/definitions/UnavailableMetric"}}},"required":["sampledAt","allocatedBytes","logicalBytes","availableBytes","breakdown","unavailableMetrics"],"additionalProperties":true},"liveExtractionWorkers":{"type":"array","description":"Individual currently live workers. Their memory sums can double-count shared pages. Aggregate CPU/I/O above also includes workers that exited during the sample.","items":{"type":"object","properties":{"processId":{"type":"integer","minimum":1,"maximum":9007199254740991},"sampledAt":{"type":"string","format":"date-time"},"resources":{"$ref":"#/definitions/ProcessResources"}},"required":["processId","sampledAt","resources"],"additionalProperties":true}}},"required":["sampledAt","observationSeconds","sidecar","extractionWorkers","disk","liveExtractionWorkers"],"additionalProperties":true};
const schema18 = {"type":"object","properties":{"allocatedBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"logicalBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]}},"required":["allocatedBytes","logicalBytes"],"additionalProperties":true};
const schema17 = {"type":"object","properties":{"metric":{"type":"string","minLength":1},"reason":{"type":"string","minLength":1}},"required":["metric","reason"],"additionalProperties":true,"description":"Metric is a dotted path relative to its containing section. Every unavailable null measurement must have an entry; zero means an observed zero."};
const schema16 = {"type":"object","properties":{"processCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"cpuCoresUsed":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"memoryResidentBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"memoryResidentPeakBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"diskReadBytesPerSecond":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"diskWriteBytesPerSecond":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableMetrics":{"type":"array","items":{"$ref":"#/definitions/UnavailableMetric"}}},"required":["processCount","cpuCoresUsed","memoryResidentBytes","memoryResidentPeakBytes","diskReadBytesPerSecond","diskWriteBytesPerSecond","unavailableMetrics"],"additionalProperties":true,"description":"Sidecar measurements include search and discovery. Worker measurements aggregate extraction children, including CPU/I/O accrued by children that exit between samples. Resident sums may double-count shared pages; peak is the maximum simultaneously observed aggregate since process startup."};

function validate14(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.processCount === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "processCount"},message:"must have required property '"+"processCount"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.cpuCoresUsed === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "cpuCoresUsed"},message:"must have required property '"+"cpuCoresUsed"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.memoryResidentBytes === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "memoryResidentBytes"},message:"must have required property '"+"memoryResidentBytes"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.memoryResidentPeakBytes === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "memoryResidentPeakBytes"},message:"must have required property '"+"memoryResidentPeakBytes"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.diskReadBytesPerSecond === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "diskReadBytesPerSecond"},message:"must have required property '"+"diskReadBytesPerSecond"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.diskWriteBytesPerSecond === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "diskWriteBytesPerSecond"},message:"must have required property '"+"diskWriteBytesPerSecond"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.unavailableMetrics === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "unavailableMetrics"},message:"must have required property '"+"unavailableMetrics"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.processCount !== undefined){
let data0 = data.processCount;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err7 = {instancePath:instancePath+"/processCount",schemaPath:"#/properties/processCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if((typeof data0 == "number") && (isFinite(data0))){
if(data0 > 9007199254740991 || isNaN(data0)){
const err8 = {instancePath:instancePath+"/processCount",schemaPath:"#/properties/processCount/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data0 < 0 || isNaN(data0)){
const err9 = {instancePath:instancePath+"/processCount",schemaPath:"#/properties/processCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.cpuCoresUsed !== undefined){
let data1 = data.cpuCoresUsed;
const _errs5 = errors;
let valid1 = false;
const _errs6 = errors;
if((typeof data1 == "number") && (isFinite(data1))){
if(data1 < 0 || isNaN(data1)){
const err10 = {instancePath:instancePath+"/cpuCoresUsed",schemaPath:"#/properties/cpuCoresUsed/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/cpuCoresUsed",schemaPath:"#/properties/cpuCoresUsed/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
var _valid0 = _errs6 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs8 = errors;
if(data1 !== null){
const err12 = {instancePath:instancePath+"/cpuCoresUsed",schemaPath:"#/properties/cpuCoresUsed/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
var _valid0 = _errs8 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err13 = {instancePath:instancePath+"/cpuCoresUsed",schemaPath:"#/properties/cpuCoresUsed/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
else {
errors = _errs5;
if(vErrors !== null){
if(_errs5){
vErrors.length = _errs5;
}
else {
vErrors = null;
}
}
}
}
if(data.memoryResidentBytes !== undefined){
let data2 = data.memoryResidentBytes;
const _errs11 = errors;
let valid2 = false;
const _errs12 = errors;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err14 = {instancePath:instancePath+"/memoryResidentBytes",schemaPath:"#/properties/memoryResidentBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 > 9007199254740991 || isNaN(data2)){
const err15 = {instancePath:instancePath+"/memoryResidentBytes",schemaPath:"#/properties/memoryResidentBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data2 < 0 || isNaN(data2)){
const err16 = {instancePath:instancePath+"/memoryResidentBytes",schemaPath:"#/properties/memoryResidentBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
var _valid1 = _errs12 === errors;
valid2 = valid2 || _valid1;
if(!valid2){
const _errs14 = errors;
if(data2 !== null){
const err17 = {instancePath:instancePath+"/memoryResidentBytes",schemaPath:"#/properties/memoryResidentBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
var _valid1 = _errs14 === errors;
valid2 = valid2 || _valid1;
}
if(!valid2){
const err18 = {instancePath:instancePath+"/memoryResidentBytes",schemaPath:"#/properties/memoryResidentBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
else {
errors = _errs11;
if(vErrors !== null){
if(_errs11){
vErrors.length = _errs11;
}
else {
vErrors = null;
}
}
}
}
if(data.memoryResidentPeakBytes !== undefined){
let data3 = data.memoryResidentPeakBytes;
const _errs17 = errors;
let valid3 = false;
const _errs18 = errors;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err19 = {instancePath:instancePath+"/memoryResidentPeakBytes",schemaPath:"#/properties/memoryResidentPeakBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 > 9007199254740991 || isNaN(data3)){
const err20 = {instancePath:instancePath+"/memoryResidentPeakBytes",schemaPath:"#/properties/memoryResidentPeakBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(data3 < 0 || isNaN(data3)){
const err21 = {instancePath:instancePath+"/memoryResidentPeakBytes",schemaPath:"#/properties/memoryResidentPeakBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
var _valid2 = _errs18 === errors;
valid3 = valid3 || _valid2;
if(!valid3){
const _errs20 = errors;
if(data3 !== null){
const err22 = {instancePath:instancePath+"/memoryResidentPeakBytes",schemaPath:"#/properties/memoryResidentPeakBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
var _valid2 = _errs20 === errors;
valid3 = valid3 || _valid2;
}
if(!valid3){
const err23 = {instancePath:instancePath+"/memoryResidentPeakBytes",schemaPath:"#/properties/memoryResidentPeakBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
else {
errors = _errs17;
if(vErrors !== null){
if(_errs17){
vErrors.length = _errs17;
}
else {
vErrors = null;
}
}
}
}
if(data.diskReadBytesPerSecond !== undefined){
let data4 = data.diskReadBytesPerSecond;
const _errs23 = errors;
let valid4 = false;
const _errs24 = errors;
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 < 0 || isNaN(data4)){
const err24 = {instancePath:instancePath+"/diskReadBytesPerSecond",schemaPath:"#/properties/diskReadBytesPerSecond/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
else {
const err25 = {instancePath:instancePath+"/diskReadBytesPerSecond",schemaPath:"#/properties/diskReadBytesPerSecond/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
var _valid3 = _errs24 === errors;
valid4 = valid4 || _valid3;
if(!valid4){
const _errs26 = errors;
if(data4 !== null){
const err26 = {instancePath:instancePath+"/diskReadBytesPerSecond",schemaPath:"#/properties/diskReadBytesPerSecond/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
var _valid3 = _errs26 === errors;
valid4 = valid4 || _valid3;
}
if(!valid4){
const err27 = {instancePath:instancePath+"/diskReadBytesPerSecond",schemaPath:"#/properties/diskReadBytesPerSecond/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
else {
errors = _errs23;
if(vErrors !== null){
if(_errs23){
vErrors.length = _errs23;
}
else {
vErrors = null;
}
}
}
}
if(data.diskWriteBytesPerSecond !== undefined){
let data5 = data.diskWriteBytesPerSecond;
const _errs29 = errors;
let valid5 = false;
const _errs30 = errors;
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 < 0 || isNaN(data5)){
const err28 = {instancePath:instancePath+"/diskWriteBytesPerSecond",schemaPath:"#/properties/diskWriteBytesPerSecond/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
else {
const err29 = {instancePath:instancePath+"/diskWriteBytesPerSecond",schemaPath:"#/properties/diskWriteBytesPerSecond/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
var _valid4 = _errs30 === errors;
valid5 = valid5 || _valid4;
if(!valid5){
const _errs32 = errors;
if(data5 !== null){
const err30 = {instancePath:instancePath+"/diskWriteBytesPerSecond",schemaPath:"#/properties/diskWriteBytesPerSecond/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
var _valid4 = _errs32 === errors;
valid5 = valid5 || _valid4;
}
if(!valid5){
const err31 = {instancePath:instancePath+"/diskWriteBytesPerSecond",schemaPath:"#/properties/diskWriteBytesPerSecond/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
else {
errors = _errs29;
if(vErrors !== null){
if(_errs29){
vErrors.length = _errs29;
}
else {
vErrors = null;
}
}
}
}
if(data.unavailableMetrics !== undefined){
let data6 = data.unavailableMetrics;
if(Array.isArray(data6)){
const len0 = data6.length;
for(let i0=0; i0<len0; i0++){
let data7 = data6[i0];
if(data7 && typeof data7 == "object" && !Array.isArray(data7)){
if(data7.metric === undefined){
const err32 = {instancePath:instancePath+"/unavailableMetrics/" + i0,schemaPath:"#/definitions/UnavailableMetric/required",keyword:"required",params:{missingProperty: "metric"},message:"must have required property '"+"metric"+"'"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(data7.reason === undefined){
const err33 = {instancePath:instancePath+"/unavailableMetrics/" + i0,schemaPath:"#/definitions/UnavailableMetric/required",keyword:"required",params:{missingProperty: "reason"},message:"must have required property '"+"reason"+"'"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(data7.metric !== undefined){
let data8 = data7.metric;
if(typeof data8 === "string"){
if(func2(data8) < 1){
const err34 = {instancePath:instancePath+"/unavailableMetrics/" + i0+"/metric",schemaPath:"#/definitions/UnavailableMetric/properties/metric/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
else {
const err35 = {instancePath:instancePath+"/unavailableMetrics/" + i0+"/metric",schemaPath:"#/definitions/UnavailableMetric/properties/metric/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
if(data7.reason !== undefined){
let data9 = data7.reason;
if(typeof data9 === "string"){
if(func2(data9) < 1){
const err36 = {instancePath:instancePath+"/unavailableMetrics/" + i0+"/reason",schemaPath:"#/definitions/UnavailableMetric/properties/reason/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
else {
const err37 = {instancePath:instancePath+"/unavailableMetrics/" + i0+"/reason",schemaPath:"#/definitions/UnavailableMetric/properties/reason/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
}
else {
const err38 = {instancePath:instancePath+"/unavailableMetrics/" + i0,schemaPath:"#/definitions/UnavailableMetric/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
}
else {
const err39 = {instancePath:instancePath+"/unavailableMetrics",schemaPath:"#/properties/unavailableMetrics/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
}
else {
const err40 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
validate14.errors = vErrors;
return errors === 0;
}


function validate13(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.sampledAt === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sampledAt"},message:"must have required property '"+"sampledAt"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.observationSeconds === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "observationSeconds"},message:"must have required property '"+"observationSeconds"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.sidecar === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sidecar"},message:"must have required property '"+"sidecar"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.extractionWorkers === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "extractionWorkers"},message:"must have required property '"+"extractionWorkers"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.disk === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "disk"},message:"must have required property '"+"disk"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.liveExtractionWorkers === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "liveExtractionWorkers"},message:"must have required property '"+"liveExtractionWorkers"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.sampledAt !== undefined){
let data0 = data.sampledAt;
if(typeof data0 === "string"){
if(!(formats0.validate(data0))){
const err6 = {instancePath:instancePath+"/sampledAt",schemaPath:"#/properties/sampledAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/sampledAt",schemaPath:"#/properties/sampledAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.observationSeconds !== undefined){
let data1 = data.observationSeconds;
if((typeof data1 == "number") && (isFinite(data1))){
if(data1 < 0 || isNaN(data1)){
const err8 = {instancePath:instancePath+"/observationSeconds",schemaPath:"#/properties/observationSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/observationSeconds",schemaPath:"#/properties/observationSeconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.sidecar !== undefined){
if(!(validate14(data.sidecar, {instancePath:instancePath+"/sidecar",parentData:data,parentDataProperty:"sidecar",rootData}))){
vErrors = vErrors === null ? validate14.errors : vErrors.concat(validate14.errors);
errors = vErrors.length;
}
}
if(data.extractionWorkers !== undefined){
if(!(validate14(data.extractionWorkers, {instancePath:instancePath+"/extractionWorkers",parentData:data,parentDataProperty:"extractionWorkers",rootData}))){
vErrors = vErrors === null ? validate14.errors : vErrors.concat(validate14.errors);
errors = vErrors.length;
}
}
if(data.disk !== undefined){
let data4 = data.disk;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.sampledAt === undefined){
const err10 = {instancePath:instancePath+"/disk",schemaPath:"#/properties/disk/required",keyword:"required",params:{missingProperty: "sampledAt"},message:"must have required property '"+"sampledAt"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data4.allocatedBytes === undefined){
const err11 = {instancePath:instancePath+"/disk",schemaPath:"#/properties/disk/required",keyword:"required",params:{missingProperty: "allocatedBytes"},message:"must have required property '"+"allocatedBytes"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data4.logicalBytes === undefined){
const err12 = {instancePath:instancePath+"/disk",schemaPath:"#/properties/disk/required",keyword:"required",params:{missingProperty: "logicalBytes"},message:"must have required property '"+"logicalBytes"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data4.availableBytes === undefined){
const err13 = {instancePath:instancePath+"/disk",schemaPath:"#/properties/disk/required",keyword:"required",params:{missingProperty: "availableBytes"},message:"must have required property '"+"availableBytes"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data4.breakdown === undefined){
const err14 = {instancePath:instancePath+"/disk",schemaPath:"#/properties/disk/required",keyword:"required",params:{missingProperty: "breakdown"},message:"must have required property '"+"breakdown"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data4.unavailableMetrics === undefined){
const err15 = {instancePath:instancePath+"/disk",schemaPath:"#/properties/disk/required",keyword:"required",params:{missingProperty: "unavailableMetrics"},message:"must have required property '"+"unavailableMetrics"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data4.sampledAt !== undefined){
let data5 = data4.sampledAt;
if(typeof data5 === "string"){
if(!(formats0.validate(data5))){
const err16 = {instancePath:instancePath+"/disk/sampledAt",schemaPath:"#/properties/disk/properties/sampledAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/disk/sampledAt",schemaPath:"#/properties/disk/properties/sampledAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data4.allocatedBytes !== undefined){
let data6 = data4.allocatedBytes;
const _errs14 = errors;
let valid2 = false;
const _errs15 = errors;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err18 = {instancePath:instancePath+"/disk/allocatedBytes",schemaPath:"#/properties/disk/properties/allocatedBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 > 9007199254740991 || isNaN(data6)){
const err19 = {instancePath:instancePath+"/disk/allocatedBytes",schemaPath:"#/properties/disk/properties/allocatedBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data6 < 0 || isNaN(data6)){
const err20 = {instancePath:instancePath+"/disk/allocatedBytes",schemaPath:"#/properties/disk/properties/allocatedBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
var _valid0 = _errs15 === errors;
valid2 = valid2 || _valid0;
if(!valid2){
const _errs17 = errors;
if(data6 !== null){
const err21 = {instancePath:instancePath+"/disk/allocatedBytes",schemaPath:"#/properties/disk/properties/allocatedBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
var _valid0 = _errs17 === errors;
valid2 = valid2 || _valid0;
}
if(!valid2){
const err22 = {instancePath:instancePath+"/disk/allocatedBytes",schemaPath:"#/properties/disk/properties/allocatedBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
else {
errors = _errs14;
if(vErrors !== null){
if(_errs14){
vErrors.length = _errs14;
}
else {
vErrors = null;
}
}
}
}
if(data4.logicalBytes !== undefined){
let data7 = data4.logicalBytes;
const _errs20 = errors;
let valid3 = false;
const _errs21 = errors;
if(!(((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7))) && (isFinite(data7)))){
const err23 = {instancePath:instancePath+"/disk/logicalBytes",schemaPath:"#/properties/disk/properties/logicalBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if((typeof data7 == "number") && (isFinite(data7))){
if(data7 > 9007199254740991 || isNaN(data7)){
const err24 = {instancePath:instancePath+"/disk/logicalBytes",schemaPath:"#/properties/disk/properties/logicalBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data7 < 0 || isNaN(data7)){
const err25 = {instancePath:instancePath+"/disk/logicalBytes",schemaPath:"#/properties/disk/properties/logicalBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
var _valid1 = _errs21 === errors;
valid3 = valid3 || _valid1;
if(!valid3){
const _errs23 = errors;
if(data7 !== null){
const err26 = {instancePath:instancePath+"/disk/logicalBytes",schemaPath:"#/properties/disk/properties/logicalBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
var _valid1 = _errs23 === errors;
valid3 = valid3 || _valid1;
}
if(!valid3){
const err27 = {instancePath:instancePath+"/disk/logicalBytes",schemaPath:"#/properties/disk/properties/logicalBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
else {
errors = _errs20;
if(vErrors !== null){
if(_errs20){
vErrors.length = _errs20;
}
else {
vErrors = null;
}
}
}
}
if(data4.availableBytes !== undefined){
let data8 = data4.availableBytes;
const _errs26 = errors;
let valid4 = false;
const _errs27 = errors;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err28 = {instancePath:instancePath+"/disk/availableBytes",schemaPath:"#/properties/disk/properties/availableBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 > 9007199254740991 || isNaN(data8)){
const err29 = {instancePath:instancePath+"/disk/availableBytes",schemaPath:"#/properties/disk/properties/availableBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(data8 < 0 || isNaN(data8)){
const err30 = {instancePath:instancePath+"/disk/availableBytes",schemaPath:"#/properties/disk/properties/availableBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
var _valid2 = _errs27 === errors;
valid4 = valid4 || _valid2;
if(!valid4){
const _errs29 = errors;
if(data8 !== null){
const err31 = {instancePath:instancePath+"/disk/availableBytes",schemaPath:"#/properties/disk/properties/availableBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
var _valid2 = _errs29 === errors;
valid4 = valid4 || _valid2;
}
if(!valid4){
const err32 = {instancePath:instancePath+"/disk/availableBytes",schemaPath:"#/properties/disk/properties/availableBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
else {
errors = _errs26;
if(vErrors !== null){
if(_errs26){
vErrors.length = _errs26;
}
else {
vErrors = null;
}
}
}
}
if(data4.breakdown !== undefined){
let data9 = data4.breakdown;
if(data9 && typeof data9 == "object" && !Array.isArray(data9)){
if(data9.control === undefined){
const err33 = {instancePath:instancePath+"/disk/breakdown",schemaPath:"#/properties/disk/properties/breakdown/required",keyword:"required",params:{missingProperty: "control"},message:"must have required property '"+"control"+"'"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(data9.catalog === undefined){
const err34 = {instancePath:instancePath+"/disk/breakdown",schemaPath:"#/properties/disk/properties/breakdown/required",keyword:"required",params:{missingProperty: "catalog"},message:"must have required property '"+"catalog"+"'"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(data9.activeIndex === undefined){
const err35 = {instancePath:instancePath+"/disk/breakdown",schemaPath:"#/properties/disk/properties/breakdown/required",keyword:"required",params:{missingProperty: "activeIndex"},message:"must have required property '"+"activeIndex"+"'"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(data9.buildingIndex === undefined){
const err36 = {instancePath:instancePath+"/disk/breakdown",schemaPath:"#/properties/disk/properties/breakdown/required",keyword:"required",params:{missingProperty: "buildingIndex"},message:"must have required property '"+"buildingIndex"+"'"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if(data9.retiredIndexes === undefined){
const err37 = {instancePath:instancePath+"/disk/breakdown",schemaPath:"#/properties/disk/properties/breakdown/required",keyword:"required",params:{missingProperty: "retiredIndexes"},message:"must have required property '"+"retiredIndexes"+"'"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(data9.wal === undefined){
const err38 = {instancePath:instancePath+"/disk/breakdown",schemaPath:"#/properties/disk/properties/breakdown/required",keyword:"required",params:{missingProperty: "wal"},message:"must have required property '"+"wal"+"'"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(data9.temporary === undefined){
const err39 = {instancePath:instancePath+"/disk/breakdown",schemaPath:"#/properties/disk/properties/breakdown/required",keyword:"required",params:{missingProperty: "temporary"},message:"must have required property '"+"temporary"+"'"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(data9.control !== undefined){
let data10 = data9.control;
if(data10 && typeof data10 == "object" && !Array.isArray(data10)){
if(data10.allocatedBytes === undefined){
const err40 = {instancePath:instancePath+"/disk/breakdown/control",schemaPath:"#/definitions/DiskUsage/required",keyword:"required",params:{missingProperty: "allocatedBytes"},message:"must have required property '"+"allocatedBytes"+"'"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
if(data10.logicalBytes === undefined){
const err41 = {instancePath:instancePath+"/disk/breakdown/control",schemaPath:"#/definitions/DiskUsage/required",keyword:"required",params:{missingProperty: "logicalBytes"},message:"must have required property '"+"logicalBytes"+"'"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
if(data10.allocatedBytes !== undefined){
let data11 = data10.allocatedBytes;
const _errs39 = errors;
let valid8 = false;
const _errs40 = errors;
if(!(((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11))) && (isFinite(data11)))){
const err42 = {instancePath:instancePath+"/disk/breakdown/control/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if((typeof data11 == "number") && (isFinite(data11))){
if(data11 > 9007199254740991 || isNaN(data11)){
const err43 = {instancePath:instancePath+"/disk/breakdown/control/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if(data11 < 0 || isNaN(data11)){
const err44 = {instancePath:instancePath+"/disk/breakdown/control/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
var _valid3 = _errs40 === errors;
valid8 = valid8 || _valid3;
if(!valid8){
const _errs42 = errors;
if(data11 !== null){
const err45 = {instancePath:instancePath+"/disk/breakdown/control/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
var _valid3 = _errs42 === errors;
valid8 = valid8 || _valid3;
}
if(!valid8){
const err46 = {instancePath:instancePath+"/disk/breakdown/control/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
else {
errors = _errs39;
if(vErrors !== null){
if(_errs39){
vErrors.length = _errs39;
}
else {
vErrors = null;
}
}
}
}
if(data10.logicalBytes !== undefined){
let data12 = data10.logicalBytes;
const _errs45 = errors;
let valid9 = false;
const _errs46 = errors;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err47 = {instancePath:instancePath+"/disk/breakdown/control/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
if((typeof data12 == "number") && (isFinite(data12))){
if(data12 > 9007199254740991 || isNaN(data12)){
const err48 = {instancePath:instancePath+"/disk/breakdown/control/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
if(data12 < 0 || isNaN(data12)){
const err49 = {instancePath:instancePath+"/disk/breakdown/control/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
var _valid4 = _errs46 === errors;
valid9 = valid9 || _valid4;
if(!valid9){
const _errs48 = errors;
if(data12 !== null){
const err50 = {instancePath:instancePath+"/disk/breakdown/control/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
var _valid4 = _errs48 === errors;
valid9 = valid9 || _valid4;
}
if(!valid9){
const err51 = {instancePath:instancePath+"/disk/breakdown/control/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
else {
errors = _errs45;
if(vErrors !== null){
if(_errs45){
vErrors.length = _errs45;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err52 = {instancePath:instancePath+"/disk/breakdown/control",schemaPath:"#/definitions/DiskUsage/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
if(data9.catalog !== undefined){
let data13 = data9.catalog;
if(data13 && typeof data13 == "object" && !Array.isArray(data13)){
if(data13.allocatedBytes === undefined){
const err53 = {instancePath:instancePath+"/disk/breakdown/catalog",schemaPath:"#/definitions/DiskUsage/required",keyword:"required",params:{missingProperty: "allocatedBytes"},message:"must have required property '"+"allocatedBytes"+"'"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
if(data13.logicalBytes === undefined){
const err54 = {instancePath:instancePath+"/disk/breakdown/catalog",schemaPath:"#/definitions/DiskUsage/required",keyword:"required",params:{missingProperty: "logicalBytes"},message:"must have required property '"+"logicalBytes"+"'"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
if(data13.allocatedBytes !== undefined){
let data14 = data13.allocatedBytes;
const _errs55 = errors;
let valid12 = false;
const _errs56 = errors;
if(!(((typeof data14 == "number") && (!(data14 % 1) && !isNaN(data14))) && (isFinite(data14)))){
const err55 = {instancePath:instancePath+"/disk/breakdown/catalog/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
if((typeof data14 == "number") && (isFinite(data14))){
if(data14 > 9007199254740991 || isNaN(data14)){
const err56 = {instancePath:instancePath+"/disk/breakdown/catalog/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
if(data14 < 0 || isNaN(data14)){
const err57 = {instancePath:instancePath+"/disk/breakdown/catalog/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
}
var _valid5 = _errs56 === errors;
valid12 = valid12 || _valid5;
if(!valid12){
const _errs58 = errors;
if(data14 !== null){
const err58 = {instancePath:instancePath+"/disk/breakdown/catalog/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
var _valid5 = _errs58 === errors;
valid12 = valid12 || _valid5;
}
if(!valid12){
const err59 = {instancePath:instancePath+"/disk/breakdown/catalog/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
else {
errors = _errs55;
if(vErrors !== null){
if(_errs55){
vErrors.length = _errs55;
}
else {
vErrors = null;
}
}
}
}
if(data13.logicalBytes !== undefined){
let data15 = data13.logicalBytes;
const _errs61 = errors;
let valid13 = false;
const _errs62 = errors;
if(!(((typeof data15 == "number") && (!(data15 % 1) && !isNaN(data15))) && (isFinite(data15)))){
const err60 = {instancePath:instancePath+"/disk/breakdown/catalog/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
if((typeof data15 == "number") && (isFinite(data15))){
if(data15 > 9007199254740991 || isNaN(data15)){
const err61 = {instancePath:instancePath+"/disk/breakdown/catalog/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
if(data15 < 0 || isNaN(data15)){
const err62 = {instancePath:instancePath+"/disk/breakdown/catalog/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
}
var _valid6 = _errs62 === errors;
valid13 = valid13 || _valid6;
if(!valid13){
const _errs64 = errors;
if(data15 !== null){
const err63 = {instancePath:instancePath+"/disk/breakdown/catalog/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
var _valid6 = _errs64 === errors;
valid13 = valid13 || _valid6;
}
if(!valid13){
const err64 = {instancePath:instancePath+"/disk/breakdown/catalog/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
else {
errors = _errs61;
if(vErrors !== null){
if(_errs61){
vErrors.length = _errs61;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err65 = {instancePath:instancePath+"/disk/breakdown/catalog",schemaPath:"#/definitions/DiskUsage/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
}
if(data9.activeIndex !== undefined){
let data16 = data9.activeIndex;
if(data16 && typeof data16 == "object" && !Array.isArray(data16)){
if(data16.allocatedBytes === undefined){
const err66 = {instancePath:instancePath+"/disk/breakdown/activeIndex",schemaPath:"#/definitions/DiskUsage/required",keyword:"required",params:{missingProperty: "allocatedBytes"},message:"must have required property '"+"allocatedBytes"+"'"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
if(data16.logicalBytes === undefined){
const err67 = {instancePath:instancePath+"/disk/breakdown/activeIndex",schemaPath:"#/definitions/DiskUsage/required",keyword:"required",params:{missingProperty: "logicalBytes"},message:"must have required property '"+"logicalBytes"+"'"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
if(data16.allocatedBytes !== undefined){
let data17 = data16.allocatedBytes;
const _errs71 = errors;
let valid16 = false;
const _errs72 = errors;
if(!(((typeof data17 == "number") && (!(data17 % 1) && !isNaN(data17))) && (isFinite(data17)))){
const err68 = {instancePath:instancePath+"/disk/breakdown/activeIndex/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
if((typeof data17 == "number") && (isFinite(data17))){
if(data17 > 9007199254740991 || isNaN(data17)){
const err69 = {instancePath:instancePath+"/disk/breakdown/activeIndex/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
if(data17 < 0 || isNaN(data17)){
const err70 = {instancePath:instancePath+"/disk/breakdown/activeIndex/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
}
var _valid7 = _errs72 === errors;
valid16 = valid16 || _valid7;
if(!valid16){
const _errs74 = errors;
if(data17 !== null){
const err71 = {instancePath:instancePath+"/disk/breakdown/activeIndex/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
var _valid7 = _errs74 === errors;
valid16 = valid16 || _valid7;
}
if(!valid16){
const err72 = {instancePath:instancePath+"/disk/breakdown/activeIndex/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
}
else {
errors = _errs71;
if(vErrors !== null){
if(_errs71){
vErrors.length = _errs71;
}
else {
vErrors = null;
}
}
}
}
if(data16.logicalBytes !== undefined){
let data18 = data16.logicalBytes;
const _errs77 = errors;
let valid17 = false;
const _errs78 = errors;
if(!(((typeof data18 == "number") && (!(data18 % 1) && !isNaN(data18))) && (isFinite(data18)))){
const err73 = {instancePath:instancePath+"/disk/breakdown/activeIndex/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
if((typeof data18 == "number") && (isFinite(data18))){
if(data18 > 9007199254740991 || isNaN(data18)){
const err74 = {instancePath:instancePath+"/disk/breakdown/activeIndex/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
if(data18 < 0 || isNaN(data18)){
const err75 = {instancePath:instancePath+"/disk/breakdown/activeIndex/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
}
var _valid8 = _errs78 === errors;
valid17 = valid17 || _valid8;
if(!valid17){
const _errs80 = errors;
if(data18 !== null){
const err76 = {instancePath:instancePath+"/disk/breakdown/activeIndex/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
var _valid8 = _errs80 === errors;
valid17 = valid17 || _valid8;
}
if(!valid17){
const err77 = {instancePath:instancePath+"/disk/breakdown/activeIndex/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
}
else {
errors = _errs77;
if(vErrors !== null){
if(_errs77){
vErrors.length = _errs77;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err78 = {instancePath:instancePath+"/disk/breakdown/activeIndex",schemaPath:"#/definitions/DiskUsage/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
}
if(data9.buildingIndex !== undefined){
let data19 = data9.buildingIndex;
if(data19 && typeof data19 == "object" && !Array.isArray(data19)){
if(data19.allocatedBytes === undefined){
const err79 = {instancePath:instancePath+"/disk/breakdown/buildingIndex",schemaPath:"#/definitions/DiskUsage/required",keyword:"required",params:{missingProperty: "allocatedBytes"},message:"must have required property '"+"allocatedBytes"+"'"};
if(vErrors === null){
vErrors = [err79];
}
else {
vErrors.push(err79);
}
errors++;
}
if(data19.logicalBytes === undefined){
const err80 = {instancePath:instancePath+"/disk/breakdown/buildingIndex",schemaPath:"#/definitions/DiskUsage/required",keyword:"required",params:{missingProperty: "logicalBytes"},message:"must have required property '"+"logicalBytes"+"'"};
if(vErrors === null){
vErrors = [err80];
}
else {
vErrors.push(err80);
}
errors++;
}
if(data19.allocatedBytes !== undefined){
let data20 = data19.allocatedBytes;
const _errs87 = errors;
let valid20 = false;
const _errs88 = errors;
if(!(((typeof data20 == "number") && (!(data20 % 1) && !isNaN(data20))) && (isFinite(data20)))){
const err81 = {instancePath:instancePath+"/disk/breakdown/buildingIndex/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err81];
}
else {
vErrors.push(err81);
}
errors++;
}
if((typeof data20 == "number") && (isFinite(data20))){
if(data20 > 9007199254740991 || isNaN(data20)){
const err82 = {instancePath:instancePath+"/disk/breakdown/buildingIndex/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err82];
}
else {
vErrors.push(err82);
}
errors++;
}
if(data20 < 0 || isNaN(data20)){
const err83 = {instancePath:instancePath+"/disk/breakdown/buildingIndex/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err83];
}
else {
vErrors.push(err83);
}
errors++;
}
}
var _valid9 = _errs88 === errors;
valid20 = valid20 || _valid9;
if(!valid20){
const _errs90 = errors;
if(data20 !== null){
const err84 = {instancePath:instancePath+"/disk/breakdown/buildingIndex/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err84];
}
else {
vErrors.push(err84);
}
errors++;
}
var _valid9 = _errs90 === errors;
valid20 = valid20 || _valid9;
}
if(!valid20){
const err85 = {instancePath:instancePath+"/disk/breakdown/buildingIndex/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err85];
}
else {
vErrors.push(err85);
}
errors++;
}
else {
errors = _errs87;
if(vErrors !== null){
if(_errs87){
vErrors.length = _errs87;
}
else {
vErrors = null;
}
}
}
}
if(data19.logicalBytes !== undefined){
let data21 = data19.logicalBytes;
const _errs93 = errors;
let valid21 = false;
const _errs94 = errors;
if(!(((typeof data21 == "number") && (!(data21 % 1) && !isNaN(data21))) && (isFinite(data21)))){
const err86 = {instancePath:instancePath+"/disk/breakdown/buildingIndex/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err86];
}
else {
vErrors.push(err86);
}
errors++;
}
if((typeof data21 == "number") && (isFinite(data21))){
if(data21 > 9007199254740991 || isNaN(data21)){
const err87 = {instancePath:instancePath+"/disk/breakdown/buildingIndex/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err87];
}
else {
vErrors.push(err87);
}
errors++;
}
if(data21 < 0 || isNaN(data21)){
const err88 = {instancePath:instancePath+"/disk/breakdown/buildingIndex/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err88];
}
else {
vErrors.push(err88);
}
errors++;
}
}
var _valid10 = _errs94 === errors;
valid21 = valid21 || _valid10;
if(!valid21){
const _errs96 = errors;
if(data21 !== null){
const err89 = {instancePath:instancePath+"/disk/breakdown/buildingIndex/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err89];
}
else {
vErrors.push(err89);
}
errors++;
}
var _valid10 = _errs96 === errors;
valid21 = valid21 || _valid10;
}
if(!valid21){
const err90 = {instancePath:instancePath+"/disk/breakdown/buildingIndex/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err90];
}
else {
vErrors.push(err90);
}
errors++;
}
else {
errors = _errs93;
if(vErrors !== null){
if(_errs93){
vErrors.length = _errs93;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err91 = {instancePath:instancePath+"/disk/breakdown/buildingIndex",schemaPath:"#/definitions/DiskUsage/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err91];
}
else {
vErrors.push(err91);
}
errors++;
}
}
if(data9.retiredIndexes !== undefined){
let data22 = data9.retiredIndexes;
if(data22 && typeof data22 == "object" && !Array.isArray(data22)){
if(data22.allocatedBytes === undefined){
const err92 = {instancePath:instancePath+"/disk/breakdown/retiredIndexes",schemaPath:"#/definitions/DiskUsage/required",keyword:"required",params:{missingProperty: "allocatedBytes"},message:"must have required property '"+"allocatedBytes"+"'"};
if(vErrors === null){
vErrors = [err92];
}
else {
vErrors.push(err92);
}
errors++;
}
if(data22.logicalBytes === undefined){
const err93 = {instancePath:instancePath+"/disk/breakdown/retiredIndexes",schemaPath:"#/definitions/DiskUsage/required",keyword:"required",params:{missingProperty: "logicalBytes"},message:"must have required property '"+"logicalBytes"+"'"};
if(vErrors === null){
vErrors = [err93];
}
else {
vErrors.push(err93);
}
errors++;
}
if(data22.allocatedBytes !== undefined){
let data23 = data22.allocatedBytes;
const _errs103 = errors;
let valid24 = false;
const _errs104 = errors;
if(!(((typeof data23 == "number") && (!(data23 % 1) && !isNaN(data23))) && (isFinite(data23)))){
const err94 = {instancePath:instancePath+"/disk/breakdown/retiredIndexes/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err94];
}
else {
vErrors.push(err94);
}
errors++;
}
if((typeof data23 == "number") && (isFinite(data23))){
if(data23 > 9007199254740991 || isNaN(data23)){
const err95 = {instancePath:instancePath+"/disk/breakdown/retiredIndexes/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err95];
}
else {
vErrors.push(err95);
}
errors++;
}
if(data23 < 0 || isNaN(data23)){
const err96 = {instancePath:instancePath+"/disk/breakdown/retiredIndexes/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err96];
}
else {
vErrors.push(err96);
}
errors++;
}
}
var _valid11 = _errs104 === errors;
valid24 = valid24 || _valid11;
if(!valid24){
const _errs106 = errors;
if(data23 !== null){
const err97 = {instancePath:instancePath+"/disk/breakdown/retiredIndexes/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err97];
}
else {
vErrors.push(err97);
}
errors++;
}
var _valid11 = _errs106 === errors;
valid24 = valid24 || _valid11;
}
if(!valid24){
const err98 = {instancePath:instancePath+"/disk/breakdown/retiredIndexes/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err98];
}
else {
vErrors.push(err98);
}
errors++;
}
else {
errors = _errs103;
if(vErrors !== null){
if(_errs103){
vErrors.length = _errs103;
}
else {
vErrors = null;
}
}
}
}
if(data22.logicalBytes !== undefined){
let data24 = data22.logicalBytes;
const _errs109 = errors;
let valid25 = false;
const _errs110 = errors;
if(!(((typeof data24 == "number") && (!(data24 % 1) && !isNaN(data24))) && (isFinite(data24)))){
const err99 = {instancePath:instancePath+"/disk/breakdown/retiredIndexes/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err99];
}
else {
vErrors.push(err99);
}
errors++;
}
if((typeof data24 == "number") && (isFinite(data24))){
if(data24 > 9007199254740991 || isNaN(data24)){
const err100 = {instancePath:instancePath+"/disk/breakdown/retiredIndexes/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err100];
}
else {
vErrors.push(err100);
}
errors++;
}
if(data24 < 0 || isNaN(data24)){
const err101 = {instancePath:instancePath+"/disk/breakdown/retiredIndexes/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err101];
}
else {
vErrors.push(err101);
}
errors++;
}
}
var _valid12 = _errs110 === errors;
valid25 = valid25 || _valid12;
if(!valid25){
const _errs112 = errors;
if(data24 !== null){
const err102 = {instancePath:instancePath+"/disk/breakdown/retiredIndexes/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err102];
}
else {
vErrors.push(err102);
}
errors++;
}
var _valid12 = _errs112 === errors;
valid25 = valid25 || _valid12;
}
if(!valid25){
const err103 = {instancePath:instancePath+"/disk/breakdown/retiredIndexes/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err103];
}
else {
vErrors.push(err103);
}
errors++;
}
else {
errors = _errs109;
if(vErrors !== null){
if(_errs109){
vErrors.length = _errs109;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err104 = {instancePath:instancePath+"/disk/breakdown/retiredIndexes",schemaPath:"#/definitions/DiskUsage/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err104];
}
else {
vErrors.push(err104);
}
errors++;
}
}
if(data9.wal !== undefined){
let data25 = data9.wal;
if(data25 && typeof data25 == "object" && !Array.isArray(data25)){
if(data25.allocatedBytes === undefined){
const err105 = {instancePath:instancePath+"/disk/breakdown/wal",schemaPath:"#/definitions/DiskUsage/required",keyword:"required",params:{missingProperty: "allocatedBytes"},message:"must have required property '"+"allocatedBytes"+"'"};
if(vErrors === null){
vErrors = [err105];
}
else {
vErrors.push(err105);
}
errors++;
}
if(data25.logicalBytes === undefined){
const err106 = {instancePath:instancePath+"/disk/breakdown/wal",schemaPath:"#/definitions/DiskUsage/required",keyword:"required",params:{missingProperty: "logicalBytes"},message:"must have required property '"+"logicalBytes"+"'"};
if(vErrors === null){
vErrors = [err106];
}
else {
vErrors.push(err106);
}
errors++;
}
if(data25.allocatedBytes !== undefined){
let data26 = data25.allocatedBytes;
const _errs119 = errors;
let valid28 = false;
const _errs120 = errors;
if(!(((typeof data26 == "number") && (!(data26 % 1) && !isNaN(data26))) && (isFinite(data26)))){
const err107 = {instancePath:instancePath+"/disk/breakdown/wal/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err107];
}
else {
vErrors.push(err107);
}
errors++;
}
if((typeof data26 == "number") && (isFinite(data26))){
if(data26 > 9007199254740991 || isNaN(data26)){
const err108 = {instancePath:instancePath+"/disk/breakdown/wal/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err108];
}
else {
vErrors.push(err108);
}
errors++;
}
if(data26 < 0 || isNaN(data26)){
const err109 = {instancePath:instancePath+"/disk/breakdown/wal/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err109];
}
else {
vErrors.push(err109);
}
errors++;
}
}
var _valid13 = _errs120 === errors;
valid28 = valid28 || _valid13;
if(!valid28){
const _errs122 = errors;
if(data26 !== null){
const err110 = {instancePath:instancePath+"/disk/breakdown/wal/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err110];
}
else {
vErrors.push(err110);
}
errors++;
}
var _valid13 = _errs122 === errors;
valid28 = valid28 || _valid13;
}
if(!valid28){
const err111 = {instancePath:instancePath+"/disk/breakdown/wal/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err111];
}
else {
vErrors.push(err111);
}
errors++;
}
else {
errors = _errs119;
if(vErrors !== null){
if(_errs119){
vErrors.length = _errs119;
}
else {
vErrors = null;
}
}
}
}
if(data25.logicalBytes !== undefined){
let data27 = data25.logicalBytes;
const _errs125 = errors;
let valid29 = false;
const _errs126 = errors;
if(!(((typeof data27 == "number") && (!(data27 % 1) && !isNaN(data27))) && (isFinite(data27)))){
const err112 = {instancePath:instancePath+"/disk/breakdown/wal/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err112];
}
else {
vErrors.push(err112);
}
errors++;
}
if((typeof data27 == "number") && (isFinite(data27))){
if(data27 > 9007199254740991 || isNaN(data27)){
const err113 = {instancePath:instancePath+"/disk/breakdown/wal/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err113];
}
else {
vErrors.push(err113);
}
errors++;
}
if(data27 < 0 || isNaN(data27)){
const err114 = {instancePath:instancePath+"/disk/breakdown/wal/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err114];
}
else {
vErrors.push(err114);
}
errors++;
}
}
var _valid14 = _errs126 === errors;
valid29 = valid29 || _valid14;
if(!valid29){
const _errs128 = errors;
if(data27 !== null){
const err115 = {instancePath:instancePath+"/disk/breakdown/wal/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err115];
}
else {
vErrors.push(err115);
}
errors++;
}
var _valid14 = _errs128 === errors;
valid29 = valid29 || _valid14;
}
if(!valid29){
const err116 = {instancePath:instancePath+"/disk/breakdown/wal/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err116];
}
else {
vErrors.push(err116);
}
errors++;
}
else {
errors = _errs125;
if(vErrors !== null){
if(_errs125){
vErrors.length = _errs125;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err117 = {instancePath:instancePath+"/disk/breakdown/wal",schemaPath:"#/definitions/DiskUsage/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err117];
}
else {
vErrors.push(err117);
}
errors++;
}
}
if(data9.temporary !== undefined){
let data28 = data9.temporary;
if(data28 && typeof data28 == "object" && !Array.isArray(data28)){
if(data28.allocatedBytes === undefined){
const err118 = {instancePath:instancePath+"/disk/breakdown/temporary",schemaPath:"#/definitions/DiskUsage/required",keyword:"required",params:{missingProperty: "allocatedBytes"},message:"must have required property '"+"allocatedBytes"+"'"};
if(vErrors === null){
vErrors = [err118];
}
else {
vErrors.push(err118);
}
errors++;
}
if(data28.logicalBytes === undefined){
const err119 = {instancePath:instancePath+"/disk/breakdown/temporary",schemaPath:"#/definitions/DiskUsage/required",keyword:"required",params:{missingProperty: "logicalBytes"},message:"must have required property '"+"logicalBytes"+"'"};
if(vErrors === null){
vErrors = [err119];
}
else {
vErrors.push(err119);
}
errors++;
}
if(data28.allocatedBytes !== undefined){
let data29 = data28.allocatedBytes;
const _errs135 = errors;
let valid32 = false;
const _errs136 = errors;
if(!(((typeof data29 == "number") && (!(data29 % 1) && !isNaN(data29))) && (isFinite(data29)))){
const err120 = {instancePath:instancePath+"/disk/breakdown/temporary/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err120];
}
else {
vErrors.push(err120);
}
errors++;
}
if((typeof data29 == "number") && (isFinite(data29))){
if(data29 > 9007199254740991 || isNaN(data29)){
const err121 = {instancePath:instancePath+"/disk/breakdown/temporary/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err121];
}
else {
vErrors.push(err121);
}
errors++;
}
if(data29 < 0 || isNaN(data29)){
const err122 = {instancePath:instancePath+"/disk/breakdown/temporary/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err122];
}
else {
vErrors.push(err122);
}
errors++;
}
}
var _valid15 = _errs136 === errors;
valid32 = valid32 || _valid15;
if(!valid32){
const _errs138 = errors;
if(data29 !== null){
const err123 = {instancePath:instancePath+"/disk/breakdown/temporary/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err123];
}
else {
vErrors.push(err123);
}
errors++;
}
var _valid15 = _errs138 === errors;
valid32 = valid32 || _valid15;
}
if(!valid32){
const err124 = {instancePath:instancePath+"/disk/breakdown/temporary/allocatedBytes",schemaPath:"#/definitions/DiskUsage/properties/allocatedBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err124];
}
else {
vErrors.push(err124);
}
errors++;
}
else {
errors = _errs135;
if(vErrors !== null){
if(_errs135){
vErrors.length = _errs135;
}
else {
vErrors = null;
}
}
}
}
if(data28.logicalBytes !== undefined){
let data30 = data28.logicalBytes;
const _errs141 = errors;
let valid33 = false;
const _errs142 = errors;
if(!(((typeof data30 == "number") && (!(data30 % 1) && !isNaN(data30))) && (isFinite(data30)))){
const err125 = {instancePath:instancePath+"/disk/breakdown/temporary/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err125];
}
else {
vErrors.push(err125);
}
errors++;
}
if((typeof data30 == "number") && (isFinite(data30))){
if(data30 > 9007199254740991 || isNaN(data30)){
const err126 = {instancePath:instancePath+"/disk/breakdown/temporary/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err126];
}
else {
vErrors.push(err126);
}
errors++;
}
if(data30 < 0 || isNaN(data30)){
const err127 = {instancePath:instancePath+"/disk/breakdown/temporary/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err127];
}
else {
vErrors.push(err127);
}
errors++;
}
}
var _valid16 = _errs142 === errors;
valid33 = valid33 || _valid16;
if(!valid33){
const _errs144 = errors;
if(data30 !== null){
const err128 = {instancePath:instancePath+"/disk/breakdown/temporary/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err128];
}
else {
vErrors.push(err128);
}
errors++;
}
var _valid16 = _errs144 === errors;
valid33 = valid33 || _valid16;
}
if(!valid33){
const err129 = {instancePath:instancePath+"/disk/breakdown/temporary/logicalBytes",schemaPath:"#/definitions/DiskUsage/properties/logicalBytes/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err129];
}
else {
vErrors.push(err129);
}
errors++;
}
else {
errors = _errs141;
if(vErrors !== null){
if(_errs141){
vErrors.length = _errs141;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err130 = {instancePath:instancePath+"/disk/breakdown/temporary",schemaPath:"#/definitions/DiskUsage/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err130];
}
else {
vErrors.push(err130);
}
errors++;
}
}
}
else {
const err131 = {instancePath:instancePath+"/disk/breakdown",schemaPath:"#/properties/disk/properties/breakdown/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err131];
}
else {
vErrors.push(err131);
}
errors++;
}
}
if(data4.unavailableMetrics !== undefined){
let data31 = data4.unavailableMetrics;
if(Array.isArray(data31)){
const len0 = data31.length;
for(let i0=0; i0<len0; i0++){
let data32 = data31[i0];
if(data32 && typeof data32 == "object" && !Array.isArray(data32)){
if(data32.metric === undefined){
const err132 = {instancePath:instancePath+"/disk/unavailableMetrics/" + i0,schemaPath:"#/definitions/UnavailableMetric/required",keyword:"required",params:{missingProperty: "metric"},message:"must have required property '"+"metric"+"'"};
if(vErrors === null){
vErrors = [err132];
}
else {
vErrors.push(err132);
}
errors++;
}
if(data32.reason === undefined){
const err133 = {instancePath:instancePath+"/disk/unavailableMetrics/" + i0,schemaPath:"#/definitions/UnavailableMetric/required",keyword:"required",params:{missingProperty: "reason"},message:"must have required property '"+"reason"+"'"};
if(vErrors === null){
vErrors = [err133];
}
else {
vErrors.push(err133);
}
errors++;
}
if(data32.metric !== undefined){
let data33 = data32.metric;
if(typeof data33 === "string"){
if(func2(data33) < 1){
const err134 = {instancePath:instancePath+"/disk/unavailableMetrics/" + i0+"/metric",schemaPath:"#/definitions/UnavailableMetric/properties/metric/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err134];
}
else {
vErrors.push(err134);
}
errors++;
}
}
else {
const err135 = {instancePath:instancePath+"/disk/unavailableMetrics/" + i0+"/metric",schemaPath:"#/definitions/UnavailableMetric/properties/metric/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err135];
}
else {
vErrors.push(err135);
}
errors++;
}
}
if(data32.reason !== undefined){
let data34 = data32.reason;
if(typeof data34 === "string"){
if(func2(data34) < 1){
const err136 = {instancePath:instancePath+"/disk/unavailableMetrics/" + i0+"/reason",schemaPath:"#/definitions/UnavailableMetric/properties/reason/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err136];
}
else {
vErrors.push(err136);
}
errors++;
}
}
else {
const err137 = {instancePath:instancePath+"/disk/unavailableMetrics/" + i0+"/reason",schemaPath:"#/definitions/UnavailableMetric/properties/reason/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err137];
}
else {
vErrors.push(err137);
}
errors++;
}
}
}
else {
const err138 = {instancePath:instancePath+"/disk/unavailableMetrics/" + i0,schemaPath:"#/definitions/UnavailableMetric/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err138];
}
else {
vErrors.push(err138);
}
errors++;
}
}
}
else {
const err139 = {instancePath:instancePath+"/disk/unavailableMetrics",schemaPath:"#/properties/disk/properties/unavailableMetrics/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err139];
}
else {
vErrors.push(err139);
}
errors++;
}
}
}
else {
const err140 = {instancePath:instancePath+"/disk",schemaPath:"#/properties/disk/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err140];
}
else {
vErrors.push(err140);
}
errors++;
}
}
if(data.liveExtractionWorkers !== undefined){
let data35 = data.liveExtractionWorkers;
if(Array.isArray(data35)){
const len1 = data35.length;
for(let i1=0; i1<len1; i1++){
let data36 = data35[i1];
if(data36 && typeof data36 == "object" && !Array.isArray(data36)){
if(data36.processId === undefined){
const err141 = {instancePath:instancePath+"/liveExtractionWorkers/" + i1,schemaPath:"#/properties/liveExtractionWorkers/items/required",keyword:"required",params:{missingProperty: "processId"},message:"must have required property '"+"processId"+"'"};
if(vErrors === null){
vErrors = [err141];
}
else {
vErrors.push(err141);
}
errors++;
}
if(data36.sampledAt === undefined){
const err142 = {instancePath:instancePath+"/liveExtractionWorkers/" + i1,schemaPath:"#/properties/liveExtractionWorkers/items/required",keyword:"required",params:{missingProperty: "sampledAt"},message:"must have required property '"+"sampledAt"+"'"};
if(vErrors === null){
vErrors = [err142];
}
else {
vErrors.push(err142);
}
errors++;
}
if(data36.resources === undefined){
const err143 = {instancePath:instancePath+"/liveExtractionWorkers/" + i1,schemaPath:"#/properties/liveExtractionWorkers/items/required",keyword:"required",params:{missingProperty: "resources"},message:"must have required property '"+"resources"+"'"};
if(vErrors === null){
vErrors = [err143];
}
else {
vErrors.push(err143);
}
errors++;
}
if(data36.processId !== undefined){
let data37 = data36.processId;
if(!(((typeof data37 == "number") && (!(data37 % 1) && !isNaN(data37))) && (isFinite(data37)))){
const err144 = {instancePath:instancePath+"/liveExtractionWorkers/" + i1+"/processId",schemaPath:"#/properties/liveExtractionWorkers/items/properties/processId/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err144];
}
else {
vErrors.push(err144);
}
errors++;
}
if((typeof data37 == "number") && (isFinite(data37))){
if(data37 > 9007199254740991 || isNaN(data37)){
const err145 = {instancePath:instancePath+"/liveExtractionWorkers/" + i1+"/processId",schemaPath:"#/properties/liveExtractionWorkers/items/properties/processId/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err145];
}
else {
vErrors.push(err145);
}
errors++;
}
if(data37 < 1 || isNaN(data37)){
const err146 = {instancePath:instancePath+"/liveExtractionWorkers/" + i1+"/processId",schemaPath:"#/properties/liveExtractionWorkers/items/properties/processId/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err146];
}
else {
vErrors.push(err146);
}
errors++;
}
}
}
if(data36.sampledAt !== undefined){
let data38 = data36.sampledAt;
if(typeof data38 === "string"){
if(!(formats0.validate(data38))){
const err147 = {instancePath:instancePath+"/liveExtractionWorkers/" + i1+"/sampledAt",schemaPath:"#/properties/liveExtractionWorkers/items/properties/sampledAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err147];
}
else {
vErrors.push(err147);
}
errors++;
}
}
else {
const err148 = {instancePath:instancePath+"/liveExtractionWorkers/" + i1+"/sampledAt",schemaPath:"#/properties/liveExtractionWorkers/items/properties/sampledAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err148];
}
else {
vErrors.push(err148);
}
errors++;
}
}
if(data36.resources !== undefined){
if(!(validate14(data36.resources, {instancePath:instancePath+"/liveExtractionWorkers/" + i1+"/resources",parentData:data36,parentDataProperty:"resources",rootData}))){
vErrors = vErrors === null ? validate14.errors : vErrors.concat(validate14.errors);
errors = vErrors.length;
}
}
}
else {
const err149 = {instancePath:instancePath+"/liveExtractionWorkers/" + i1,schemaPath:"#/properties/liveExtractionWorkers/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err149];
}
else {
vErrors.push(err149);
}
errors++;
}
}
}
else {
const err150 = {instancePath:instancePath+"/liveExtractionWorkers",schemaPath:"#/properties/liveExtractionWorkers/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err150];
}
else {
vErrors.push(err150);
}
errors++;
}
}
}
else {
const err151 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err151];
}
else {
vErrors.push(err151);
}
errors++;
}
validate13.errors = vErrors;
return errors === 0;
}

const schema26 = {"type":"object","properties":{"instanceId":{"type":"string","minLength":1},"role":{"type":"string","enum":["active","building"]},"sampledAt":{"type":"string","format":"date-time"},"segments":{"type":"array","items":{"$ref":"#/definitions/Segment"}},"chunks":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"terms":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"indexedAvgdl":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"observedAvgdl":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["instanceId","role","sampledAt","segments","chunks","terms","indexedAvgdl","observedAvgdl","unavailableReason"],"additionalProperties":true,"description":"Active and building counters have independent revision receipts. Never sum generations to estimate mailbox progress. An extraction shared across generations can appear in both generation throughput views."};
const schema27 = {"type":"object","properties":{"kind":{"type":"string","enum":["email","file"]},"sourceId":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"mailboxId":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"fileType":{"anyOf":[{"type":"string","enum":["pdf","office","text","image","email","archive","other"]},{"type":"null"}]},"throughput":{"type":"array","items":{"$ref":"#/definitions/ThroughputWindow"}},"backlog":{"$ref":"#/definitions/Backlog"},"eta":{"$ref":"#/definitions/Eta"},"coverage":{"$ref":"#/definitions/Coverage"},"depth":{"$ref":"#/definitions/Depth"},"freshness":{"$ref":"#/definitions/Latency"},"errors":{"$ref":"#/definitions/ErrorWindow"}},"required":["kind","sourceId","mailboxId","fileType","throughput","backlog","eta","coverage","depth","freshness","errors"],"additionalProperties":true,"description":"Null source/mailbox denotes an all-source aggregate. Non-null scopes are independent views, not additional documents. Null fileType denotes all file types; breakdowns apply only to file rows. There must be one 60-second and one 300-second throughput window per segment."};
const schema28 = {"type":"object","properties":{"targetWindowSeconds":{"type":"integer","enum":[60,300]},"observationSeconds":{"type":"number","minimum":0},"sampleCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"indexedPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"emptyPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unindexablePerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"completedPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"attemptsPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"retriesPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"deletionsPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"extractedTextBytesPerSecond":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["targetWindowSeconds","observationSeconds","sampleCount","indexedPerMinute","emptyPerMinute","unindexablePerMinute","completedPerMinute","attemptsPerMinute","retriesPerMinute","deletionsPerMinute","extractedTextBytesPerSecond","unavailableReason"],"additionalProperties":true};
const schema29 = {"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"discoveryComplete":{"type":"boolean"},"remaining":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"ready":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"inProgress":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"retryDeferred":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"blocked":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"firstTime":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"updates":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sampledAt","discoveryComplete","remaining","ready","inProgress","retryDeferred","blocked","firstTime","updates","unavailableReason"],"additionalProperties":true,"description":"Counts concern current eligible revisions, not queue entries. remaining = ready + inProgress + retryDeferred + blocked = firstTime + updates. Incomplete discovery still permits exact counts for known work. Terminal outcomes and deletion-only cleanup are excluded."};
const schema30 = {"type":"object","properties":{"state":{"type":"string","enum":["available","unavailable"]},"estimatedRemainingSeconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"estimatedCompletionAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"basis":{"const":"knownBacklog"},"rateWindowSeconds":{"type":"integer","enum":[60,300]},"observationSeconds":{"type":"number","minimum":0},"sampleCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["state","estimatedRemainingSeconds","estimatedCompletionAt","basis","rateWindowSeconds","observationSeconds","sampleCount","unavailableReason"],"additionalProperties":true,"allOf":[{"if":{"properties":{"state":{"const":"available"}},"required":["state"]},"then":{"properties":{"estimatedRemainingSeconds":{"type":"number","minimum":0},"estimatedCompletionAt":{"type":"string","format":"date-time"},"unavailableReason":{"type":"null"}}},"else":{"properties":{"estimatedRemainingSeconds":{"type":"null"},"estimatedCompletionAt":{"type":"null"},"unavailableReason":{"type":"string","minLength":1}}}}]};
const schema31 = {"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"knownEligible":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"indexedCurrent":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"emptyCurrent":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unindexableCurrent":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"stale":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"neverProcessed":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"pendingDeletions":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sampledAt","knownEligible","indexedCurrent","emptyCurrent","unindexableCurrent","stale","neverProcessed","pendingDeletions","unavailableReason"],"additionalProperties":true,"description":"knownEligible is the sum of the five mutually exclusive revision states. stale means an older receipt exists, including an older failed receipt. pendingDeletions is separate. These counts do not imply discovery is complete."};
const schema35 = {"type":"object","properties":{"observationSeconds":{"type":"number","minimum":0},"sampleCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"p50Seconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"p95Seconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["observationSeconds","sampleCount","p50Seconds","p95Seconds","unavailableReason"],"additionalProperties":true,"description":"Freshness is measured from discovery of a revision until its first searchable commit. Retry attempts do not reset the start; failed/empty/deleted revisions are excluded."};
const schema32 = {"type":"object","properties":{"state":{"type":"string","enum":["applicable","notApplicable","unknown"]},"dateBasis":{"anyOf":[{"type":"string","enum":["emailReceivedAtThenSentAt","parentEmailReceivedAtThenSentAt","sourceDefined"]},{"type":"null"}]},"sourceDateField":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"discoveryComplete":{"type":"boolean"},"oldestIndexedDocumentAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"fullyIndexedSince":{"anyOf":[{"$ref":"#/definitions/DepthBoundary"},{"type":"null"}]},"processedSince":{"anyOf":[{"$ref":"#/definitions/DepthBoundary"},{"type":"null"}]},"pendingDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unindexableDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"undatedDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["state","dateBasis","sourceDateField","discoveryComplete","oldestIndexedDocumentAt","fullyIndexedSince","processedSince","pendingDocuments","unindexableDocuments","undatedDocuments","unavailableReason"],"additionalProperties":true,"description":"Only applicable to chronologically prioritized kinds. fullyIndexedSince requires current indexed/empty receipts; processedSince also accepts current terminal failures. Unknown dates are excluded from the boundary and counted explicitly. Oldest indexed date alone makes no coverage claim."};
const schema33 = {"type":"object","properties":{"at":{"type":"string","format":"date-time"},"inclusive":{"type":"boolean"}},"required":["at","inclusive"],"additionalProperties":true,"description":"All known eligible dated documents between this boundary and the snapshot are covered; inclusive says whether documents exactly at the boundary are included. An old pending document makes an exclusive boundary possible without rounding timestamps."};

function validate21(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.state === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.dateBasis === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "dateBasis"},message:"must have required property '"+"dateBasis"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.sourceDateField === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sourceDateField"},message:"must have required property '"+"sourceDateField"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.discoveryComplete === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "discoveryComplete"},message:"must have required property '"+"discoveryComplete"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.oldestIndexedDocumentAt === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "oldestIndexedDocumentAt"},message:"must have required property '"+"oldestIndexedDocumentAt"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.fullyIndexedSince === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "fullyIndexedSince"},message:"must have required property '"+"fullyIndexedSince"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.processedSince === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "processedSince"},message:"must have required property '"+"processedSince"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.pendingDocuments === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "pendingDocuments"},message:"must have required property '"+"pendingDocuments"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.unindexableDocuments === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "unindexableDocuments"},message:"must have required property '"+"unindexableDocuments"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.undatedDocuments === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "undatedDocuments"},message:"must have required property '"+"undatedDocuments"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.unavailableReason === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "unavailableReason"},message:"must have required property '"+"unavailableReason"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.state !== undefined){
let data0 = data.state;
if(typeof data0 !== "string"){
const err11 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!(((data0 === "applicable") || (data0 === "notApplicable")) || (data0 === "unknown"))){
const err12 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/enum",keyword:"enum",params:{allowedValues: schema32.properties.state.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.dateBasis !== undefined){
let data1 = data.dateBasis;
const _errs5 = errors;
let valid1 = false;
const _errs6 = errors;
if(typeof data1 !== "string"){
const err13 = {instancePath:instancePath+"/dateBasis",schemaPath:"#/properties/dateBasis/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(!(((data1 === "emailReceivedAtThenSentAt") || (data1 === "parentEmailReceivedAtThenSentAt")) || (data1 === "sourceDefined"))){
const err14 = {instancePath:instancePath+"/dateBasis",schemaPath:"#/properties/dateBasis/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema32.properties.dateBasis.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
var _valid0 = _errs6 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs8 = errors;
if(data1 !== null){
const err15 = {instancePath:instancePath+"/dateBasis",schemaPath:"#/properties/dateBasis/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
var _valid0 = _errs8 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err16 = {instancePath:instancePath+"/dateBasis",schemaPath:"#/properties/dateBasis/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
else {
errors = _errs5;
if(vErrors !== null){
if(_errs5){
vErrors.length = _errs5;
}
else {
vErrors = null;
}
}
}
}
if(data.sourceDateField !== undefined){
let data2 = data.sourceDateField;
const _errs11 = errors;
let valid2 = false;
const _errs12 = errors;
if(typeof data2 === "string"){
if(func2(data2) < 1){
const err17 = {instancePath:instancePath+"/sourceDateField",schemaPath:"#/properties/sourceDateField/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
else {
const err18 = {instancePath:instancePath+"/sourceDateField",schemaPath:"#/properties/sourceDateField/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
var _valid1 = _errs12 === errors;
valid2 = valid2 || _valid1;
if(!valid2){
const _errs14 = errors;
if(data2 !== null){
const err19 = {instancePath:instancePath+"/sourceDateField",schemaPath:"#/properties/sourceDateField/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
var _valid1 = _errs14 === errors;
valid2 = valid2 || _valid1;
}
if(!valid2){
const err20 = {instancePath:instancePath+"/sourceDateField",schemaPath:"#/properties/sourceDateField/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
else {
errors = _errs11;
if(vErrors !== null){
if(_errs11){
vErrors.length = _errs11;
}
else {
vErrors = null;
}
}
}
}
if(data.discoveryComplete !== undefined){
if(typeof data.discoveryComplete !== "boolean"){
const err21 = {instancePath:instancePath+"/discoveryComplete",schemaPath:"#/properties/discoveryComplete/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.oldestIndexedDocumentAt !== undefined){
let data4 = data.oldestIndexedDocumentAt;
const _errs19 = errors;
let valid3 = false;
const _errs20 = errors;
if(typeof data4 === "string"){
if(!(formats0.validate(data4))){
const err22 = {instancePath:instancePath+"/oldestIndexedDocumentAt",schemaPath:"#/properties/oldestIndexedDocumentAt/anyOf/0/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
else {
const err23 = {instancePath:instancePath+"/oldestIndexedDocumentAt",schemaPath:"#/properties/oldestIndexedDocumentAt/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
var _valid2 = _errs20 === errors;
valid3 = valid3 || _valid2;
if(!valid3){
const _errs22 = errors;
if(data4 !== null){
const err24 = {instancePath:instancePath+"/oldestIndexedDocumentAt",schemaPath:"#/properties/oldestIndexedDocumentAt/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
var _valid2 = _errs22 === errors;
valid3 = valid3 || _valid2;
}
if(!valid3){
const err25 = {instancePath:instancePath+"/oldestIndexedDocumentAt",schemaPath:"#/properties/oldestIndexedDocumentAt/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
else {
errors = _errs19;
if(vErrors !== null){
if(_errs19){
vErrors.length = _errs19;
}
else {
vErrors = null;
}
}
}
}
if(data.fullyIndexedSince !== undefined){
let data5 = data.fullyIndexedSince;
const _errs25 = errors;
let valid4 = false;
const _errs26 = errors;
if(data5 && typeof data5 == "object" && !Array.isArray(data5)){
if(data5.at === undefined){
const err26 = {instancePath:instancePath+"/fullyIndexedSince",schemaPath:"#/definitions/DepthBoundary/required",keyword:"required",params:{missingProperty: "at"},message:"must have required property '"+"at"+"'"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(data5.inclusive === undefined){
const err27 = {instancePath:instancePath+"/fullyIndexedSince",schemaPath:"#/definitions/DepthBoundary/required",keyword:"required",params:{missingProperty: "inclusive"},message:"must have required property '"+"inclusive"+"'"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(data5.at !== undefined){
let data6 = data5.at;
if(typeof data6 === "string"){
if(!(formats0.validate(data6))){
const err28 = {instancePath:instancePath+"/fullyIndexedSince/at",schemaPath:"#/definitions/DepthBoundary/properties/at/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
else {
const err29 = {instancePath:instancePath+"/fullyIndexedSince/at",schemaPath:"#/definitions/DepthBoundary/properties/at/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data5.inclusive !== undefined){
if(typeof data5.inclusive !== "boolean"){
const err30 = {instancePath:instancePath+"/fullyIndexedSince/inclusive",schemaPath:"#/definitions/DepthBoundary/properties/inclusive/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
}
else {
const err31 = {instancePath:instancePath+"/fullyIndexedSince",schemaPath:"#/definitions/DepthBoundary/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
var _valid3 = _errs26 === errors;
valid4 = valid4 || _valid3;
if(!valid4){
const _errs34 = errors;
if(data5 !== null){
const err32 = {instancePath:instancePath+"/fullyIndexedSince",schemaPath:"#/properties/fullyIndexedSince/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
var _valid3 = _errs34 === errors;
valid4 = valid4 || _valid3;
}
if(!valid4){
const err33 = {instancePath:instancePath+"/fullyIndexedSince",schemaPath:"#/properties/fullyIndexedSince/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
else {
errors = _errs25;
if(vErrors !== null){
if(_errs25){
vErrors.length = _errs25;
}
else {
vErrors = null;
}
}
}
}
if(data.processedSince !== undefined){
let data8 = data.processedSince;
const _errs37 = errors;
let valid7 = false;
const _errs38 = errors;
if(data8 && typeof data8 == "object" && !Array.isArray(data8)){
if(data8.at === undefined){
const err34 = {instancePath:instancePath+"/processedSince",schemaPath:"#/definitions/DepthBoundary/required",keyword:"required",params:{missingProperty: "at"},message:"must have required property '"+"at"+"'"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(data8.inclusive === undefined){
const err35 = {instancePath:instancePath+"/processedSince",schemaPath:"#/definitions/DepthBoundary/required",keyword:"required",params:{missingProperty: "inclusive"},message:"must have required property '"+"inclusive"+"'"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(data8.at !== undefined){
let data9 = data8.at;
if(typeof data9 === "string"){
if(!(formats0.validate(data9))){
const err36 = {instancePath:instancePath+"/processedSince/at",schemaPath:"#/definitions/DepthBoundary/properties/at/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
else {
const err37 = {instancePath:instancePath+"/processedSince/at",schemaPath:"#/definitions/DepthBoundary/properties/at/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data8.inclusive !== undefined){
if(typeof data8.inclusive !== "boolean"){
const err38 = {instancePath:instancePath+"/processedSince/inclusive",schemaPath:"#/definitions/DepthBoundary/properties/inclusive/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
}
else {
const err39 = {instancePath:instancePath+"/processedSince",schemaPath:"#/definitions/DepthBoundary/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
var _valid4 = _errs38 === errors;
valid7 = valid7 || _valid4;
if(!valid7){
const _errs46 = errors;
if(data8 !== null){
const err40 = {instancePath:instancePath+"/processedSince",schemaPath:"#/properties/processedSince/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
var _valid4 = _errs46 === errors;
valid7 = valid7 || _valid4;
}
if(!valid7){
const err41 = {instancePath:instancePath+"/processedSince",schemaPath:"#/properties/processedSince/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
else {
errors = _errs37;
if(vErrors !== null){
if(_errs37){
vErrors.length = _errs37;
}
else {
vErrors = null;
}
}
}
}
if(data.pendingDocuments !== undefined){
let data11 = data.pendingDocuments;
const _errs49 = errors;
let valid10 = false;
const _errs50 = errors;
if(!(((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11))) && (isFinite(data11)))){
const err42 = {instancePath:instancePath+"/pendingDocuments",schemaPath:"#/properties/pendingDocuments/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if((typeof data11 == "number") && (isFinite(data11))){
if(data11 > 9007199254740991 || isNaN(data11)){
const err43 = {instancePath:instancePath+"/pendingDocuments",schemaPath:"#/properties/pendingDocuments/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if(data11 < 0 || isNaN(data11)){
const err44 = {instancePath:instancePath+"/pendingDocuments",schemaPath:"#/properties/pendingDocuments/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
var _valid5 = _errs50 === errors;
valid10 = valid10 || _valid5;
if(!valid10){
const _errs52 = errors;
if(data11 !== null){
const err45 = {instancePath:instancePath+"/pendingDocuments",schemaPath:"#/properties/pendingDocuments/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
var _valid5 = _errs52 === errors;
valid10 = valid10 || _valid5;
}
if(!valid10){
const err46 = {instancePath:instancePath+"/pendingDocuments",schemaPath:"#/properties/pendingDocuments/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
else {
errors = _errs49;
if(vErrors !== null){
if(_errs49){
vErrors.length = _errs49;
}
else {
vErrors = null;
}
}
}
}
if(data.unindexableDocuments !== undefined){
let data12 = data.unindexableDocuments;
const _errs55 = errors;
let valid11 = false;
const _errs56 = errors;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err47 = {instancePath:instancePath+"/unindexableDocuments",schemaPath:"#/properties/unindexableDocuments/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
if((typeof data12 == "number") && (isFinite(data12))){
if(data12 > 9007199254740991 || isNaN(data12)){
const err48 = {instancePath:instancePath+"/unindexableDocuments",schemaPath:"#/properties/unindexableDocuments/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
if(data12 < 0 || isNaN(data12)){
const err49 = {instancePath:instancePath+"/unindexableDocuments",schemaPath:"#/properties/unindexableDocuments/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
var _valid6 = _errs56 === errors;
valid11 = valid11 || _valid6;
if(!valid11){
const _errs58 = errors;
if(data12 !== null){
const err50 = {instancePath:instancePath+"/unindexableDocuments",schemaPath:"#/properties/unindexableDocuments/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
var _valid6 = _errs58 === errors;
valid11 = valid11 || _valid6;
}
if(!valid11){
const err51 = {instancePath:instancePath+"/unindexableDocuments",schemaPath:"#/properties/unindexableDocuments/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
else {
errors = _errs55;
if(vErrors !== null){
if(_errs55){
vErrors.length = _errs55;
}
else {
vErrors = null;
}
}
}
}
if(data.undatedDocuments !== undefined){
let data13 = data.undatedDocuments;
const _errs61 = errors;
let valid12 = false;
const _errs62 = errors;
if(!(((typeof data13 == "number") && (!(data13 % 1) && !isNaN(data13))) && (isFinite(data13)))){
const err52 = {instancePath:instancePath+"/undatedDocuments",schemaPath:"#/properties/undatedDocuments/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
if((typeof data13 == "number") && (isFinite(data13))){
if(data13 > 9007199254740991 || isNaN(data13)){
const err53 = {instancePath:instancePath+"/undatedDocuments",schemaPath:"#/properties/undatedDocuments/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
if(data13 < 0 || isNaN(data13)){
const err54 = {instancePath:instancePath+"/undatedDocuments",schemaPath:"#/properties/undatedDocuments/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
var _valid7 = _errs62 === errors;
valid12 = valid12 || _valid7;
if(!valid12){
const _errs64 = errors;
if(data13 !== null){
const err55 = {instancePath:instancePath+"/undatedDocuments",schemaPath:"#/properties/undatedDocuments/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
var _valid7 = _errs64 === errors;
valid12 = valid12 || _valid7;
}
if(!valid12){
const err56 = {instancePath:instancePath+"/undatedDocuments",schemaPath:"#/properties/undatedDocuments/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
else {
errors = _errs61;
if(vErrors !== null){
if(_errs61){
vErrors.length = _errs61;
}
else {
vErrors = null;
}
}
}
}
if(data.unavailableReason !== undefined){
let data14 = data.unavailableReason;
const _errs67 = errors;
let valid13 = false;
const _errs68 = errors;
if(typeof data14 === "string"){
if(func2(data14) < 1){
const err57 = {instancePath:instancePath+"/unavailableReason",schemaPath:"#/properties/unavailableReason/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
}
else {
const err58 = {instancePath:instancePath+"/unavailableReason",schemaPath:"#/properties/unavailableReason/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
var _valid8 = _errs68 === errors;
valid13 = valid13 || _valid8;
if(!valid13){
const _errs70 = errors;
if(data14 !== null){
const err59 = {instancePath:instancePath+"/unavailableReason",schemaPath:"#/properties/unavailableReason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
var _valid8 = _errs70 === errors;
valid13 = valid13 || _valid8;
}
if(!valid13){
const err60 = {instancePath:instancePath+"/unavailableReason",schemaPath:"#/properties/unavailableReason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
else {
errors = _errs67;
if(vErrors !== null){
if(_errs67){
vErrors.length = _errs67;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err61 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
validate21.errors = vErrors;
return errors === 0;
}

const schema36 = {"type":"object","properties":{"observationSeconds":{"type":"number","minimum":0},"attemptFailures":{"type":"integer","minimum":0,"maximum":9007199254740991},"terminalFailures":{"type":"integer","minimum":0,"maximum":9007199254740991},"byCode":{"type":"array","items":{"$ref":"#/definitions/ErrorCount"}},"truncated":{"type":"boolean"}},"required":["observationSeconds","attemptFailures","terminalFailures","byCode","truncated"],"additionalProperties":true,"description":"Bounded recent error-code histogram, without content or filesystem paths. Counts include all failures even when byCode is truncated."};
const schema37 = {"type":"object","properties":{"code":{"type":"string","minLength":1},"count":{"type":"integer","minimum":0,"maximum":9007199254740991},"lastOccurredAt":{"type":"string","format":"date-time"}},"required":["code","count","lastOccurredAt"],"additionalProperties":true};

function validate23(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.observationSeconds === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "observationSeconds"},message:"must have required property '"+"observationSeconds"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.attemptFailures === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "attemptFailures"},message:"must have required property '"+"attemptFailures"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.terminalFailures === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "terminalFailures"},message:"must have required property '"+"terminalFailures"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.byCode === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "byCode"},message:"must have required property '"+"byCode"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.truncated === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "truncated"},message:"must have required property '"+"truncated"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.observationSeconds !== undefined){
let data0 = data.observationSeconds;
if((typeof data0 == "number") && (isFinite(data0))){
if(data0 < 0 || isNaN(data0)){
const err5 = {instancePath:instancePath+"/observationSeconds",schemaPath:"#/properties/observationSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/observationSeconds",schemaPath:"#/properties/observationSeconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.attemptFailures !== undefined){
let data1 = data.attemptFailures;
if(!(((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1))) && (isFinite(data1)))){
const err7 = {instancePath:instancePath+"/attemptFailures",schemaPath:"#/properties/attemptFailures/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if((typeof data1 == "number") && (isFinite(data1))){
if(data1 > 9007199254740991 || isNaN(data1)){
const err8 = {instancePath:instancePath+"/attemptFailures",schemaPath:"#/properties/attemptFailures/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data1 < 0 || isNaN(data1)){
const err9 = {instancePath:instancePath+"/attemptFailures",schemaPath:"#/properties/attemptFailures/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.terminalFailures !== undefined){
let data2 = data.terminalFailures;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err10 = {instancePath:instancePath+"/terminalFailures",schemaPath:"#/properties/terminalFailures/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 > 9007199254740991 || isNaN(data2)){
const err11 = {instancePath:instancePath+"/terminalFailures",schemaPath:"#/properties/terminalFailures/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data2 < 0 || isNaN(data2)){
const err12 = {instancePath:instancePath+"/terminalFailures",schemaPath:"#/properties/terminalFailures/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
}
if(data.byCode !== undefined){
let data3 = data.byCode;
if(Array.isArray(data3)){
const len0 = data3.length;
for(let i0=0; i0<len0; i0++){
let data4 = data3[i0];
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.code === undefined){
const err13 = {instancePath:instancePath+"/byCode/" + i0,schemaPath:"#/definitions/ErrorCount/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data4.count === undefined){
const err14 = {instancePath:instancePath+"/byCode/" + i0,schemaPath:"#/definitions/ErrorCount/required",keyword:"required",params:{missingProperty: "count"},message:"must have required property '"+"count"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data4.lastOccurredAt === undefined){
const err15 = {instancePath:instancePath+"/byCode/" + i0,schemaPath:"#/definitions/ErrorCount/required",keyword:"required",params:{missingProperty: "lastOccurredAt"},message:"must have required property '"+"lastOccurredAt"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data4.code !== undefined){
let data5 = data4.code;
if(typeof data5 === "string"){
if(func2(data5) < 1){
const err16 = {instancePath:instancePath+"/byCode/" + i0+"/code",schemaPath:"#/definitions/ErrorCount/properties/code/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/byCode/" + i0+"/code",schemaPath:"#/definitions/ErrorCount/properties/code/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data4.count !== undefined){
let data6 = data4.count;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err18 = {instancePath:instancePath+"/byCode/" + i0+"/count",schemaPath:"#/definitions/ErrorCount/properties/count/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 > 9007199254740991 || isNaN(data6)){
const err19 = {instancePath:instancePath+"/byCode/" + i0+"/count",schemaPath:"#/definitions/ErrorCount/properties/count/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data6 < 0 || isNaN(data6)){
const err20 = {instancePath:instancePath+"/byCode/" + i0+"/count",schemaPath:"#/definitions/ErrorCount/properties/count/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
}
if(data4.lastOccurredAt !== undefined){
let data7 = data4.lastOccurredAt;
if(typeof data7 === "string"){
if(!(formats0.validate(data7))){
const err21 = {instancePath:instancePath+"/byCode/" + i0+"/lastOccurredAt",schemaPath:"#/definitions/ErrorCount/properties/lastOccurredAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
else {
const err22 = {instancePath:instancePath+"/byCode/" + i0+"/lastOccurredAt",schemaPath:"#/definitions/ErrorCount/properties/lastOccurredAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
}
else {
const err23 = {instancePath:instancePath+"/byCode/" + i0,schemaPath:"#/definitions/ErrorCount/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
}
else {
const err24 = {instancePath:instancePath+"/byCode",schemaPath:"#/properties/byCode/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.truncated !== undefined){
if(typeof data.truncated !== "boolean"){
const err25 = {instancePath:instancePath+"/truncated",schemaPath:"#/properties/truncated/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
}
else {
const err26 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
validate23.errors = vErrors;
return errors === 0;
}


function validate20(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.kind === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.sourceId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sourceId"},message:"must have required property '"+"sourceId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.mailboxId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mailboxId"},message:"must have required property '"+"mailboxId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.fileType === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "fileType"},message:"must have required property '"+"fileType"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.throughput === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "throughput"},message:"must have required property '"+"throughput"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.backlog === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "backlog"},message:"must have required property '"+"backlog"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.eta === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "eta"},message:"must have required property '"+"eta"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.coverage === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "coverage"},message:"must have required property '"+"coverage"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.depth === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "depth"},message:"must have required property '"+"depth"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.freshness === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "freshness"},message:"must have required property '"+"freshness"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.errors === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "errors"},message:"must have required property '"+"errors"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.kind !== undefined){
let data0 = data.kind;
if(typeof data0 !== "string"){
const err11 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!((data0 === "email") || (data0 === "file"))){
const err12 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema27.properties.kind.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.sourceId !== undefined){
let data1 = data.sourceId;
const _errs5 = errors;
let valid1 = false;
const _errs6 = errors;
if(typeof data1 === "string"){
if(func2(data1) < 1){
const err13 = {instancePath:instancePath+"/sourceId",schemaPath:"#/properties/sourceId/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
else {
const err14 = {instancePath:instancePath+"/sourceId",schemaPath:"#/properties/sourceId/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
var _valid0 = _errs6 === errors;
valid1 = valid1 || _valid0;
if(!valid1){
const _errs8 = errors;
if(data1 !== null){
const err15 = {instancePath:instancePath+"/sourceId",schemaPath:"#/properties/sourceId/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
var _valid0 = _errs8 === errors;
valid1 = valid1 || _valid0;
}
if(!valid1){
const err16 = {instancePath:instancePath+"/sourceId",schemaPath:"#/properties/sourceId/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
else {
errors = _errs5;
if(vErrors !== null){
if(_errs5){
vErrors.length = _errs5;
}
else {
vErrors = null;
}
}
}
}
if(data.mailboxId !== undefined){
let data2 = data.mailboxId;
const _errs11 = errors;
let valid2 = false;
const _errs12 = errors;
if(typeof data2 === "string"){
if(func2(data2) < 1){
const err17 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
else {
const err18 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
var _valid1 = _errs12 === errors;
valid2 = valid2 || _valid1;
if(!valid2){
const _errs14 = errors;
if(data2 !== null){
const err19 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
var _valid1 = _errs14 === errors;
valid2 = valid2 || _valid1;
}
if(!valid2){
const err20 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
else {
errors = _errs11;
if(vErrors !== null){
if(_errs11){
vErrors.length = _errs11;
}
else {
vErrors = null;
}
}
}
}
if(data.fileType !== undefined){
let data3 = data.fileType;
const _errs17 = errors;
let valid3 = false;
const _errs18 = errors;
if(typeof data3 !== "string"){
const err21 = {instancePath:instancePath+"/fileType",schemaPath:"#/properties/fileType/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(!(((((((data3 === "pdf") || (data3 === "office")) || (data3 === "text")) || (data3 === "image")) || (data3 === "email")) || (data3 === "archive")) || (data3 === "other"))){
const err22 = {instancePath:instancePath+"/fileType",schemaPath:"#/properties/fileType/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema27.properties.fileType.anyOf[0].enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
var _valid2 = _errs18 === errors;
valid3 = valid3 || _valid2;
if(!valid3){
const _errs20 = errors;
if(data3 !== null){
const err23 = {instancePath:instancePath+"/fileType",schemaPath:"#/properties/fileType/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
var _valid2 = _errs20 === errors;
valid3 = valid3 || _valid2;
}
if(!valid3){
const err24 = {instancePath:instancePath+"/fileType",schemaPath:"#/properties/fileType/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
else {
errors = _errs17;
if(vErrors !== null){
if(_errs17){
vErrors.length = _errs17;
}
else {
vErrors = null;
}
}
}
}
if(data.throughput !== undefined){
let data4 = data.throughput;
if(Array.isArray(data4)){
const len0 = data4.length;
for(let i0=0; i0<len0; i0++){
let data5 = data4[i0];
if(data5 && typeof data5 == "object" && !Array.isArray(data5)){
if(data5.targetWindowSeconds === undefined){
const err25 = {instancePath:instancePath+"/throughput/" + i0,schemaPath:"#/definitions/ThroughputWindow/required",keyword:"required",params:{missingProperty: "targetWindowSeconds"},message:"must have required property '"+"targetWindowSeconds"+"'"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(data5.observationSeconds === undefined){
const err26 = {instancePath:instancePath+"/throughput/" + i0,schemaPath:"#/definitions/ThroughputWindow/required",keyword:"required",params:{missingProperty: "observationSeconds"},message:"must have required property '"+"observationSeconds"+"'"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(data5.sampleCount === undefined){
const err27 = {instancePath:instancePath+"/throughput/" + i0,schemaPath:"#/definitions/ThroughputWindow/required",keyword:"required",params:{missingProperty: "sampleCount"},message:"must have required property '"+"sampleCount"+"'"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(data5.indexedPerMinute === undefined){
const err28 = {instancePath:instancePath+"/throughput/" + i0,schemaPath:"#/definitions/ThroughputWindow/required",keyword:"required",params:{missingProperty: "indexedPerMinute"},message:"must have required property '"+"indexedPerMinute"+"'"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(data5.emptyPerMinute === undefined){
const err29 = {instancePath:instancePath+"/throughput/" + i0,schemaPath:"#/definitions/ThroughputWindow/required",keyword:"required",params:{missingProperty: "emptyPerMinute"},message:"must have required property '"+"emptyPerMinute"+"'"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(data5.unindexablePerMinute === undefined){
const err30 = {instancePath:instancePath+"/throughput/" + i0,schemaPath:"#/definitions/ThroughputWindow/required",keyword:"required",params:{missingProperty: "unindexablePerMinute"},message:"must have required property '"+"unindexablePerMinute"+"'"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(data5.completedPerMinute === undefined){
const err31 = {instancePath:instancePath+"/throughput/" + i0,schemaPath:"#/definitions/ThroughputWindow/required",keyword:"required",params:{missingProperty: "completedPerMinute"},message:"must have required property '"+"completedPerMinute"+"'"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(data5.attemptsPerMinute === undefined){
const err32 = {instancePath:instancePath+"/throughput/" + i0,schemaPath:"#/definitions/ThroughputWindow/required",keyword:"required",params:{missingProperty: "attemptsPerMinute"},message:"must have required property '"+"attemptsPerMinute"+"'"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(data5.retriesPerMinute === undefined){
const err33 = {instancePath:instancePath+"/throughput/" + i0,schemaPath:"#/definitions/ThroughputWindow/required",keyword:"required",params:{missingProperty: "retriesPerMinute"},message:"must have required property '"+"retriesPerMinute"+"'"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(data5.deletionsPerMinute === undefined){
const err34 = {instancePath:instancePath+"/throughput/" + i0,schemaPath:"#/definitions/ThroughputWindow/required",keyword:"required",params:{missingProperty: "deletionsPerMinute"},message:"must have required property '"+"deletionsPerMinute"+"'"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(data5.extractedTextBytesPerSecond === undefined){
const err35 = {instancePath:instancePath+"/throughput/" + i0,schemaPath:"#/definitions/ThroughputWindow/required",keyword:"required",params:{missingProperty: "extractedTextBytesPerSecond"},message:"must have required property '"+"extractedTextBytesPerSecond"+"'"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(data5.unavailableReason === undefined){
const err36 = {instancePath:instancePath+"/throughput/" + i0,schemaPath:"#/definitions/ThroughputWindow/required",keyword:"required",params:{missingProperty: "unavailableReason"},message:"must have required property '"+"unavailableReason"+"'"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if(data5.targetWindowSeconds !== undefined){
let data6 = data5.targetWindowSeconds;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err37 = {instancePath:instancePath+"/throughput/" + i0+"/targetWindowSeconds",schemaPath:"#/definitions/ThroughputWindow/properties/targetWindowSeconds/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(!((data6 === 60) || (data6 === 300))){
const err38 = {instancePath:instancePath+"/throughput/" + i0+"/targetWindowSeconds",schemaPath:"#/definitions/ThroughputWindow/properties/targetWindowSeconds/enum",keyword:"enum",params:{allowedValues: schema28.properties.targetWindowSeconds.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
if(data5.observationSeconds !== undefined){
let data7 = data5.observationSeconds;
if((typeof data7 == "number") && (isFinite(data7))){
if(data7 < 0 || isNaN(data7)){
const err39 = {instancePath:instancePath+"/throughput/" + i0+"/observationSeconds",schemaPath:"#/definitions/ThroughputWindow/properties/observationSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
else {
const err40 = {instancePath:instancePath+"/throughput/" + i0+"/observationSeconds",schemaPath:"#/definitions/ThroughputWindow/properties/observationSeconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
if(data5.sampleCount !== undefined){
let data8 = data5.sampleCount;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err41 = {instancePath:instancePath+"/throughput/" + i0+"/sampleCount",schemaPath:"#/definitions/ThroughputWindow/properties/sampleCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 > 9007199254740991 || isNaN(data8)){
const err42 = {instancePath:instancePath+"/throughput/" + i0+"/sampleCount",schemaPath:"#/definitions/ThroughputWindow/properties/sampleCount/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if(data8 < 0 || isNaN(data8)){
const err43 = {instancePath:instancePath+"/throughput/" + i0+"/sampleCount",schemaPath:"#/definitions/ThroughputWindow/properties/sampleCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
}
if(data5.indexedPerMinute !== undefined){
let data9 = data5.indexedPerMinute;
const _errs35 = errors;
let valid8 = false;
const _errs36 = errors;
if((typeof data9 == "number") && (isFinite(data9))){
if(data9 < 0 || isNaN(data9)){
const err44 = {instancePath:instancePath+"/throughput/" + i0+"/indexedPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/indexedPerMinute/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
else {
const err45 = {instancePath:instancePath+"/throughput/" + i0+"/indexedPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/indexedPerMinute/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
var _valid3 = _errs36 === errors;
valid8 = valid8 || _valid3;
if(!valid8){
const _errs38 = errors;
if(data9 !== null){
const err46 = {instancePath:instancePath+"/throughput/" + i0+"/indexedPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/indexedPerMinute/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
var _valid3 = _errs38 === errors;
valid8 = valid8 || _valid3;
}
if(!valid8){
const err47 = {instancePath:instancePath+"/throughput/" + i0+"/indexedPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/indexedPerMinute/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
else {
errors = _errs35;
if(vErrors !== null){
if(_errs35){
vErrors.length = _errs35;
}
else {
vErrors = null;
}
}
}
}
if(data5.emptyPerMinute !== undefined){
let data10 = data5.emptyPerMinute;
const _errs41 = errors;
let valid9 = false;
const _errs42 = errors;
if((typeof data10 == "number") && (isFinite(data10))){
if(data10 < 0 || isNaN(data10)){
const err48 = {instancePath:instancePath+"/throughput/" + i0+"/emptyPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/emptyPerMinute/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
else {
const err49 = {instancePath:instancePath+"/throughput/" + i0+"/emptyPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/emptyPerMinute/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
var _valid4 = _errs42 === errors;
valid9 = valid9 || _valid4;
if(!valid9){
const _errs44 = errors;
if(data10 !== null){
const err50 = {instancePath:instancePath+"/throughput/" + i0+"/emptyPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/emptyPerMinute/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
var _valid4 = _errs44 === errors;
valid9 = valid9 || _valid4;
}
if(!valid9){
const err51 = {instancePath:instancePath+"/throughput/" + i0+"/emptyPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/emptyPerMinute/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
else {
errors = _errs41;
if(vErrors !== null){
if(_errs41){
vErrors.length = _errs41;
}
else {
vErrors = null;
}
}
}
}
if(data5.unindexablePerMinute !== undefined){
let data11 = data5.unindexablePerMinute;
const _errs47 = errors;
let valid10 = false;
const _errs48 = errors;
if((typeof data11 == "number") && (isFinite(data11))){
if(data11 < 0 || isNaN(data11)){
const err52 = {instancePath:instancePath+"/throughput/" + i0+"/unindexablePerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/unindexablePerMinute/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
else {
const err53 = {instancePath:instancePath+"/throughput/" + i0+"/unindexablePerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/unindexablePerMinute/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
var _valid5 = _errs48 === errors;
valid10 = valid10 || _valid5;
if(!valid10){
const _errs50 = errors;
if(data11 !== null){
const err54 = {instancePath:instancePath+"/throughput/" + i0+"/unindexablePerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/unindexablePerMinute/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
var _valid5 = _errs50 === errors;
valid10 = valid10 || _valid5;
}
if(!valid10){
const err55 = {instancePath:instancePath+"/throughput/" + i0+"/unindexablePerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/unindexablePerMinute/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
else {
errors = _errs47;
if(vErrors !== null){
if(_errs47){
vErrors.length = _errs47;
}
else {
vErrors = null;
}
}
}
}
if(data5.completedPerMinute !== undefined){
let data12 = data5.completedPerMinute;
const _errs53 = errors;
let valid11 = false;
const _errs54 = errors;
if((typeof data12 == "number") && (isFinite(data12))){
if(data12 < 0 || isNaN(data12)){
const err56 = {instancePath:instancePath+"/throughput/" + i0+"/completedPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/completedPerMinute/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
}
else {
const err57 = {instancePath:instancePath+"/throughput/" + i0+"/completedPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/completedPerMinute/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
var _valid6 = _errs54 === errors;
valid11 = valid11 || _valid6;
if(!valid11){
const _errs56 = errors;
if(data12 !== null){
const err58 = {instancePath:instancePath+"/throughput/" + i0+"/completedPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/completedPerMinute/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
var _valid6 = _errs56 === errors;
valid11 = valid11 || _valid6;
}
if(!valid11){
const err59 = {instancePath:instancePath+"/throughput/" + i0+"/completedPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/completedPerMinute/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
else {
errors = _errs53;
if(vErrors !== null){
if(_errs53){
vErrors.length = _errs53;
}
else {
vErrors = null;
}
}
}
}
if(data5.attemptsPerMinute !== undefined){
let data13 = data5.attemptsPerMinute;
const _errs59 = errors;
let valid12 = false;
const _errs60 = errors;
if((typeof data13 == "number") && (isFinite(data13))){
if(data13 < 0 || isNaN(data13)){
const err60 = {instancePath:instancePath+"/throughput/" + i0+"/attemptsPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/attemptsPerMinute/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
}
else {
const err61 = {instancePath:instancePath+"/throughput/" + i0+"/attemptsPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/attemptsPerMinute/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
var _valid7 = _errs60 === errors;
valid12 = valid12 || _valid7;
if(!valid12){
const _errs62 = errors;
if(data13 !== null){
const err62 = {instancePath:instancePath+"/throughput/" + i0+"/attemptsPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/attemptsPerMinute/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
var _valid7 = _errs62 === errors;
valid12 = valid12 || _valid7;
}
if(!valid12){
const err63 = {instancePath:instancePath+"/throughput/" + i0+"/attemptsPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/attemptsPerMinute/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
else {
errors = _errs59;
if(vErrors !== null){
if(_errs59){
vErrors.length = _errs59;
}
else {
vErrors = null;
}
}
}
}
if(data5.retriesPerMinute !== undefined){
let data14 = data5.retriesPerMinute;
const _errs65 = errors;
let valid13 = false;
const _errs66 = errors;
if((typeof data14 == "number") && (isFinite(data14))){
if(data14 < 0 || isNaN(data14)){
const err64 = {instancePath:instancePath+"/throughput/" + i0+"/retriesPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/retriesPerMinute/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
}
else {
const err65 = {instancePath:instancePath+"/throughput/" + i0+"/retriesPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/retriesPerMinute/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
var _valid8 = _errs66 === errors;
valid13 = valid13 || _valid8;
if(!valid13){
const _errs68 = errors;
if(data14 !== null){
const err66 = {instancePath:instancePath+"/throughput/" + i0+"/retriesPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/retriesPerMinute/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
var _valid8 = _errs68 === errors;
valid13 = valid13 || _valid8;
}
if(!valid13){
const err67 = {instancePath:instancePath+"/throughput/" + i0+"/retriesPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/retriesPerMinute/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
else {
errors = _errs65;
if(vErrors !== null){
if(_errs65){
vErrors.length = _errs65;
}
else {
vErrors = null;
}
}
}
}
if(data5.deletionsPerMinute !== undefined){
let data15 = data5.deletionsPerMinute;
const _errs71 = errors;
let valid14 = false;
const _errs72 = errors;
if((typeof data15 == "number") && (isFinite(data15))){
if(data15 < 0 || isNaN(data15)){
const err68 = {instancePath:instancePath+"/throughput/" + i0+"/deletionsPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/deletionsPerMinute/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
}
else {
const err69 = {instancePath:instancePath+"/throughput/" + i0+"/deletionsPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/deletionsPerMinute/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
var _valid9 = _errs72 === errors;
valid14 = valid14 || _valid9;
if(!valid14){
const _errs74 = errors;
if(data15 !== null){
const err70 = {instancePath:instancePath+"/throughput/" + i0+"/deletionsPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/deletionsPerMinute/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
var _valid9 = _errs74 === errors;
valid14 = valid14 || _valid9;
}
if(!valid14){
const err71 = {instancePath:instancePath+"/throughput/" + i0+"/deletionsPerMinute",schemaPath:"#/definitions/ThroughputWindow/properties/deletionsPerMinute/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
else {
errors = _errs71;
if(vErrors !== null){
if(_errs71){
vErrors.length = _errs71;
}
else {
vErrors = null;
}
}
}
}
if(data5.extractedTextBytesPerSecond !== undefined){
let data16 = data5.extractedTextBytesPerSecond;
const _errs77 = errors;
let valid15 = false;
const _errs78 = errors;
if((typeof data16 == "number") && (isFinite(data16))){
if(data16 < 0 || isNaN(data16)){
const err72 = {instancePath:instancePath+"/throughput/" + i0+"/extractedTextBytesPerSecond",schemaPath:"#/definitions/ThroughputWindow/properties/extractedTextBytesPerSecond/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
}
}
else {
const err73 = {instancePath:instancePath+"/throughput/" + i0+"/extractedTextBytesPerSecond",schemaPath:"#/definitions/ThroughputWindow/properties/extractedTextBytesPerSecond/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
var _valid10 = _errs78 === errors;
valid15 = valid15 || _valid10;
if(!valid15){
const _errs80 = errors;
if(data16 !== null){
const err74 = {instancePath:instancePath+"/throughput/" + i0+"/extractedTextBytesPerSecond",schemaPath:"#/definitions/ThroughputWindow/properties/extractedTextBytesPerSecond/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
var _valid10 = _errs80 === errors;
valid15 = valid15 || _valid10;
}
if(!valid15){
const err75 = {instancePath:instancePath+"/throughput/" + i0+"/extractedTextBytesPerSecond",schemaPath:"#/definitions/ThroughputWindow/properties/extractedTextBytesPerSecond/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
else {
errors = _errs77;
if(vErrors !== null){
if(_errs77){
vErrors.length = _errs77;
}
else {
vErrors = null;
}
}
}
}
if(data5.unavailableReason !== undefined){
let data17 = data5.unavailableReason;
const _errs83 = errors;
let valid16 = false;
const _errs84 = errors;
if(typeof data17 === "string"){
if(func2(data17) < 1){
const err76 = {instancePath:instancePath+"/throughput/" + i0+"/unavailableReason",schemaPath:"#/definitions/ThroughputWindow/properties/unavailableReason/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
}
else {
const err77 = {instancePath:instancePath+"/throughput/" + i0+"/unavailableReason",schemaPath:"#/definitions/ThroughputWindow/properties/unavailableReason/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
}
var _valid11 = _errs84 === errors;
valid16 = valid16 || _valid11;
if(!valid16){
const _errs86 = errors;
if(data17 !== null){
const err78 = {instancePath:instancePath+"/throughput/" + i0+"/unavailableReason",schemaPath:"#/definitions/ThroughputWindow/properties/unavailableReason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
var _valid11 = _errs86 === errors;
valid16 = valid16 || _valid11;
}
if(!valid16){
const err79 = {instancePath:instancePath+"/throughput/" + i0+"/unavailableReason",schemaPath:"#/definitions/ThroughputWindow/properties/unavailableReason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err79];
}
else {
vErrors.push(err79);
}
errors++;
}
else {
errors = _errs83;
if(vErrors !== null){
if(_errs83){
vErrors.length = _errs83;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err80 = {instancePath:instancePath+"/throughput/" + i0,schemaPath:"#/definitions/ThroughputWindow/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err80];
}
else {
vErrors.push(err80);
}
errors++;
}
}
}
else {
const err81 = {instancePath:instancePath+"/throughput",schemaPath:"#/properties/throughput/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err81];
}
else {
vErrors.push(err81);
}
errors++;
}
}
if(data.backlog !== undefined){
let data18 = data.backlog;
if(data18 && typeof data18 == "object" && !Array.isArray(data18)){
if(data18.sampledAt === undefined){
const err82 = {instancePath:instancePath+"/backlog",schemaPath:"#/definitions/Backlog/required",keyword:"required",params:{missingProperty: "sampledAt"},message:"must have required property '"+"sampledAt"+"'"};
if(vErrors === null){
vErrors = [err82];
}
else {
vErrors.push(err82);
}
errors++;
}
if(data18.discoveryComplete === undefined){
const err83 = {instancePath:instancePath+"/backlog",schemaPath:"#/definitions/Backlog/required",keyword:"required",params:{missingProperty: "discoveryComplete"},message:"must have required property '"+"discoveryComplete"+"'"};
if(vErrors === null){
vErrors = [err83];
}
else {
vErrors.push(err83);
}
errors++;
}
if(data18.remaining === undefined){
const err84 = {instancePath:instancePath+"/backlog",schemaPath:"#/definitions/Backlog/required",keyword:"required",params:{missingProperty: "remaining"},message:"must have required property '"+"remaining"+"'"};
if(vErrors === null){
vErrors = [err84];
}
else {
vErrors.push(err84);
}
errors++;
}
if(data18.ready === undefined){
const err85 = {instancePath:instancePath+"/backlog",schemaPath:"#/definitions/Backlog/required",keyword:"required",params:{missingProperty: "ready"},message:"must have required property '"+"ready"+"'"};
if(vErrors === null){
vErrors = [err85];
}
else {
vErrors.push(err85);
}
errors++;
}
if(data18.inProgress === undefined){
const err86 = {instancePath:instancePath+"/backlog",schemaPath:"#/definitions/Backlog/required",keyword:"required",params:{missingProperty: "inProgress"},message:"must have required property '"+"inProgress"+"'"};
if(vErrors === null){
vErrors = [err86];
}
else {
vErrors.push(err86);
}
errors++;
}
if(data18.retryDeferred === undefined){
const err87 = {instancePath:instancePath+"/backlog",schemaPath:"#/definitions/Backlog/required",keyword:"required",params:{missingProperty: "retryDeferred"},message:"must have required property '"+"retryDeferred"+"'"};
if(vErrors === null){
vErrors = [err87];
}
else {
vErrors.push(err87);
}
errors++;
}
if(data18.blocked === undefined){
const err88 = {instancePath:instancePath+"/backlog",schemaPath:"#/definitions/Backlog/required",keyword:"required",params:{missingProperty: "blocked"},message:"must have required property '"+"blocked"+"'"};
if(vErrors === null){
vErrors = [err88];
}
else {
vErrors.push(err88);
}
errors++;
}
if(data18.firstTime === undefined){
const err89 = {instancePath:instancePath+"/backlog",schemaPath:"#/definitions/Backlog/required",keyword:"required",params:{missingProperty: "firstTime"},message:"must have required property '"+"firstTime"+"'"};
if(vErrors === null){
vErrors = [err89];
}
else {
vErrors.push(err89);
}
errors++;
}
if(data18.updates === undefined){
const err90 = {instancePath:instancePath+"/backlog",schemaPath:"#/definitions/Backlog/required",keyword:"required",params:{missingProperty: "updates"},message:"must have required property '"+"updates"+"'"};
if(vErrors === null){
vErrors = [err90];
}
else {
vErrors.push(err90);
}
errors++;
}
if(data18.unavailableReason === undefined){
const err91 = {instancePath:instancePath+"/backlog",schemaPath:"#/definitions/Backlog/required",keyword:"required",params:{missingProperty: "unavailableReason"},message:"must have required property '"+"unavailableReason"+"'"};
if(vErrors === null){
vErrors = [err91];
}
else {
vErrors.push(err91);
}
errors++;
}
if(data18.sampledAt !== undefined){
let data19 = data18.sampledAt;
if(typeof data19 === "string"){
if(!(formats0.validate(data19))){
const err92 = {instancePath:instancePath+"/backlog/sampledAt",schemaPath:"#/definitions/Backlog/properties/sampledAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err92];
}
else {
vErrors.push(err92);
}
errors++;
}
}
else {
const err93 = {instancePath:instancePath+"/backlog/sampledAt",schemaPath:"#/definitions/Backlog/properties/sampledAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err93];
}
else {
vErrors.push(err93);
}
errors++;
}
}
if(data18.discoveryComplete !== undefined){
if(typeof data18.discoveryComplete !== "boolean"){
const err94 = {instancePath:instancePath+"/backlog/discoveryComplete",schemaPath:"#/definitions/Backlog/properties/discoveryComplete/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err94];
}
else {
vErrors.push(err94);
}
errors++;
}
}
if(data18.remaining !== undefined){
let data21 = data18.remaining;
const _errs97 = errors;
let valid19 = false;
const _errs98 = errors;
if(!(((typeof data21 == "number") && (!(data21 % 1) && !isNaN(data21))) && (isFinite(data21)))){
const err95 = {instancePath:instancePath+"/backlog/remaining",schemaPath:"#/definitions/Backlog/properties/remaining/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err95];
}
else {
vErrors.push(err95);
}
errors++;
}
if((typeof data21 == "number") && (isFinite(data21))){
if(data21 > 9007199254740991 || isNaN(data21)){
const err96 = {instancePath:instancePath+"/backlog/remaining",schemaPath:"#/definitions/Backlog/properties/remaining/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err96];
}
else {
vErrors.push(err96);
}
errors++;
}
if(data21 < 0 || isNaN(data21)){
const err97 = {instancePath:instancePath+"/backlog/remaining",schemaPath:"#/definitions/Backlog/properties/remaining/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err97];
}
else {
vErrors.push(err97);
}
errors++;
}
}
var _valid12 = _errs98 === errors;
valid19 = valid19 || _valid12;
if(!valid19){
const _errs100 = errors;
if(data21 !== null){
const err98 = {instancePath:instancePath+"/backlog/remaining",schemaPath:"#/definitions/Backlog/properties/remaining/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err98];
}
else {
vErrors.push(err98);
}
errors++;
}
var _valid12 = _errs100 === errors;
valid19 = valid19 || _valid12;
}
if(!valid19){
const err99 = {instancePath:instancePath+"/backlog/remaining",schemaPath:"#/definitions/Backlog/properties/remaining/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err99];
}
else {
vErrors.push(err99);
}
errors++;
}
else {
errors = _errs97;
if(vErrors !== null){
if(_errs97){
vErrors.length = _errs97;
}
else {
vErrors = null;
}
}
}
}
if(data18.ready !== undefined){
let data22 = data18.ready;
const _errs103 = errors;
let valid20 = false;
const _errs104 = errors;
if(!(((typeof data22 == "number") && (!(data22 % 1) && !isNaN(data22))) && (isFinite(data22)))){
const err100 = {instancePath:instancePath+"/backlog/ready",schemaPath:"#/definitions/Backlog/properties/ready/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err100];
}
else {
vErrors.push(err100);
}
errors++;
}
if((typeof data22 == "number") && (isFinite(data22))){
if(data22 > 9007199254740991 || isNaN(data22)){
const err101 = {instancePath:instancePath+"/backlog/ready",schemaPath:"#/definitions/Backlog/properties/ready/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err101];
}
else {
vErrors.push(err101);
}
errors++;
}
if(data22 < 0 || isNaN(data22)){
const err102 = {instancePath:instancePath+"/backlog/ready",schemaPath:"#/definitions/Backlog/properties/ready/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err102];
}
else {
vErrors.push(err102);
}
errors++;
}
}
var _valid13 = _errs104 === errors;
valid20 = valid20 || _valid13;
if(!valid20){
const _errs106 = errors;
if(data22 !== null){
const err103 = {instancePath:instancePath+"/backlog/ready",schemaPath:"#/definitions/Backlog/properties/ready/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err103];
}
else {
vErrors.push(err103);
}
errors++;
}
var _valid13 = _errs106 === errors;
valid20 = valid20 || _valid13;
}
if(!valid20){
const err104 = {instancePath:instancePath+"/backlog/ready",schemaPath:"#/definitions/Backlog/properties/ready/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err104];
}
else {
vErrors.push(err104);
}
errors++;
}
else {
errors = _errs103;
if(vErrors !== null){
if(_errs103){
vErrors.length = _errs103;
}
else {
vErrors = null;
}
}
}
}
if(data18.inProgress !== undefined){
let data23 = data18.inProgress;
const _errs109 = errors;
let valid21 = false;
const _errs110 = errors;
if(!(((typeof data23 == "number") && (!(data23 % 1) && !isNaN(data23))) && (isFinite(data23)))){
const err105 = {instancePath:instancePath+"/backlog/inProgress",schemaPath:"#/definitions/Backlog/properties/inProgress/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err105];
}
else {
vErrors.push(err105);
}
errors++;
}
if((typeof data23 == "number") && (isFinite(data23))){
if(data23 > 9007199254740991 || isNaN(data23)){
const err106 = {instancePath:instancePath+"/backlog/inProgress",schemaPath:"#/definitions/Backlog/properties/inProgress/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err106];
}
else {
vErrors.push(err106);
}
errors++;
}
if(data23 < 0 || isNaN(data23)){
const err107 = {instancePath:instancePath+"/backlog/inProgress",schemaPath:"#/definitions/Backlog/properties/inProgress/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err107];
}
else {
vErrors.push(err107);
}
errors++;
}
}
var _valid14 = _errs110 === errors;
valid21 = valid21 || _valid14;
if(!valid21){
const _errs112 = errors;
if(data23 !== null){
const err108 = {instancePath:instancePath+"/backlog/inProgress",schemaPath:"#/definitions/Backlog/properties/inProgress/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err108];
}
else {
vErrors.push(err108);
}
errors++;
}
var _valid14 = _errs112 === errors;
valid21 = valid21 || _valid14;
}
if(!valid21){
const err109 = {instancePath:instancePath+"/backlog/inProgress",schemaPath:"#/definitions/Backlog/properties/inProgress/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err109];
}
else {
vErrors.push(err109);
}
errors++;
}
else {
errors = _errs109;
if(vErrors !== null){
if(_errs109){
vErrors.length = _errs109;
}
else {
vErrors = null;
}
}
}
}
if(data18.retryDeferred !== undefined){
let data24 = data18.retryDeferred;
const _errs115 = errors;
let valid22 = false;
const _errs116 = errors;
if(!(((typeof data24 == "number") && (!(data24 % 1) && !isNaN(data24))) && (isFinite(data24)))){
const err110 = {instancePath:instancePath+"/backlog/retryDeferred",schemaPath:"#/definitions/Backlog/properties/retryDeferred/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err110];
}
else {
vErrors.push(err110);
}
errors++;
}
if((typeof data24 == "number") && (isFinite(data24))){
if(data24 > 9007199254740991 || isNaN(data24)){
const err111 = {instancePath:instancePath+"/backlog/retryDeferred",schemaPath:"#/definitions/Backlog/properties/retryDeferred/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err111];
}
else {
vErrors.push(err111);
}
errors++;
}
if(data24 < 0 || isNaN(data24)){
const err112 = {instancePath:instancePath+"/backlog/retryDeferred",schemaPath:"#/definitions/Backlog/properties/retryDeferred/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err112];
}
else {
vErrors.push(err112);
}
errors++;
}
}
var _valid15 = _errs116 === errors;
valid22 = valid22 || _valid15;
if(!valid22){
const _errs118 = errors;
if(data24 !== null){
const err113 = {instancePath:instancePath+"/backlog/retryDeferred",schemaPath:"#/definitions/Backlog/properties/retryDeferred/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err113];
}
else {
vErrors.push(err113);
}
errors++;
}
var _valid15 = _errs118 === errors;
valid22 = valid22 || _valid15;
}
if(!valid22){
const err114 = {instancePath:instancePath+"/backlog/retryDeferred",schemaPath:"#/definitions/Backlog/properties/retryDeferred/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err114];
}
else {
vErrors.push(err114);
}
errors++;
}
else {
errors = _errs115;
if(vErrors !== null){
if(_errs115){
vErrors.length = _errs115;
}
else {
vErrors = null;
}
}
}
}
if(data18.blocked !== undefined){
let data25 = data18.blocked;
const _errs121 = errors;
let valid23 = false;
const _errs122 = errors;
if(!(((typeof data25 == "number") && (!(data25 % 1) && !isNaN(data25))) && (isFinite(data25)))){
const err115 = {instancePath:instancePath+"/backlog/blocked",schemaPath:"#/definitions/Backlog/properties/blocked/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err115];
}
else {
vErrors.push(err115);
}
errors++;
}
if((typeof data25 == "number") && (isFinite(data25))){
if(data25 > 9007199254740991 || isNaN(data25)){
const err116 = {instancePath:instancePath+"/backlog/blocked",schemaPath:"#/definitions/Backlog/properties/blocked/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err116];
}
else {
vErrors.push(err116);
}
errors++;
}
if(data25 < 0 || isNaN(data25)){
const err117 = {instancePath:instancePath+"/backlog/blocked",schemaPath:"#/definitions/Backlog/properties/blocked/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err117];
}
else {
vErrors.push(err117);
}
errors++;
}
}
var _valid16 = _errs122 === errors;
valid23 = valid23 || _valid16;
if(!valid23){
const _errs124 = errors;
if(data25 !== null){
const err118 = {instancePath:instancePath+"/backlog/blocked",schemaPath:"#/definitions/Backlog/properties/blocked/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err118];
}
else {
vErrors.push(err118);
}
errors++;
}
var _valid16 = _errs124 === errors;
valid23 = valid23 || _valid16;
}
if(!valid23){
const err119 = {instancePath:instancePath+"/backlog/blocked",schemaPath:"#/definitions/Backlog/properties/blocked/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err119];
}
else {
vErrors.push(err119);
}
errors++;
}
else {
errors = _errs121;
if(vErrors !== null){
if(_errs121){
vErrors.length = _errs121;
}
else {
vErrors = null;
}
}
}
}
if(data18.firstTime !== undefined){
let data26 = data18.firstTime;
const _errs127 = errors;
let valid24 = false;
const _errs128 = errors;
if(!(((typeof data26 == "number") && (!(data26 % 1) && !isNaN(data26))) && (isFinite(data26)))){
const err120 = {instancePath:instancePath+"/backlog/firstTime",schemaPath:"#/definitions/Backlog/properties/firstTime/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err120];
}
else {
vErrors.push(err120);
}
errors++;
}
if((typeof data26 == "number") && (isFinite(data26))){
if(data26 > 9007199254740991 || isNaN(data26)){
const err121 = {instancePath:instancePath+"/backlog/firstTime",schemaPath:"#/definitions/Backlog/properties/firstTime/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err121];
}
else {
vErrors.push(err121);
}
errors++;
}
if(data26 < 0 || isNaN(data26)){
const err122 = {instancePath:instancePath+"/backlog/firstTime",schemaPath:"#/definitions/Backlog/properties/firstTime/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err122];
}
else {
vErrors.push(err122);
}
errors++;
}
}
var _valid17 = _errs128 === errors;
valid24 = valid24 || _valid17;
if(!valid24){
const _errs130 = errors;
if(data26 !== null){
const err123 = {instancePath:instancePath+"/backlog/firstTime",schemaPath:"#/definitions/Backlog/properties/firstTime/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err123];
}
else {
vErrors.push(err123);
}
errors++;
}
var _valid17 = _errs130 === errors;
valid24 = valid24 || _valid17;
}
if(!valid24){
const err124 = {instancePath:instancePath+"/backlog/firstTime",schemaPath:"#/definitions/Backlog/properties/firstTime/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err124];
}
else {
vErrors.push(err124);
}
errors++;
}
else {
errors = _errs127;
if(vErrors !== null){
if(_errs127){
vErrors.length = _errs127;
}
else {
vErrors = null;
}
}
}
}
if(data18.updates !== undefined){
let data27 = data18.updates;
const _errs133 = errors;
let valid25 = false;
const _errs134 = errors;
if(!(((typeof data27 == "number") && (!(data27 % 1) && !isNaN(data27))) && (isFinite(data27)))){
const err125 = {instancePath:instancePath+"/backlog/updates",schemaPath:"#/definitions/Backlog/properties/updates/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err125];
}
else {
vErrors.push(err125);
}
errors++;
}
if((typeof data27 == "number") && (isFinite(data27))){
if(data27 > 9007199254740991 || isNaN(data27)){
const err126 = {instancePath:instancePath+"/backlog/updates",schemaPath:"#/definitions/Backlog/properties/updates/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err126];
}
else {
vErrors.push(err126);
}
errors++;
}
if(data27 < 0 || isNaN(data27)){
const err127 = {instancePath:instancePath+"/backlog/updates",schemaPath:"#/definitions/Backlog/properties/updates/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err127];
}
else {
vErrors.push(err127);
}
errors++;
}
}
var _valid18 = _errs134 === errors;
valid25 = valid25 || _valid18;
if(!valid25){
const _errs136 = errors;
if(data27 !== null){
const err128 = {instancePath:instancePath+"/backlog/updates",schemaPath:"#/definitions/Backlog/properties/updates/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err128];
}
else {
vErrors.push(err128);
}
errors++;
}
var _valid18 = _errs136 === errors;
valid25 = valid25 || _valid18;
}
if(!valid25){
const err129 = {instancePath:instancePath+"/backlog/updates",schemaPath:"#/definitions/Backlog/properties/updates/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err129];
}
else {
vErrors.push(err129);
}
errors++;
}
else {
errors = _errs133;
if(vErrors !== null){
if(_errs133){
vErrors.length = _errs133;
}
else {
vErrors = null;
}
}
}
}
if(data18.unavailableReason !== undefined){
let data28 = data18.unavailableReason;
const _errs139 = errors;
let valid26 = false;
const _errs140 = errors;
if(typeof data28 === "string"){
if(func2(data28) < 1){
const err130 = {instancePath:instancePath+"/backlog/unavailableReason",schemaPath:"#/definitions/Backlog/properties/unavailableReason/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err130];
}
else {
vErrors.push(err130);
}
errors++;
}
}
else {
const err131 = {instancePath:instancePath+"/backlog/unavailableReason",schemaPath:"#/definitions/Backlog/properties/unavailableReason/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err131];
}
else {
vErrors.push(err131);
}
errors++;
}
var _valid19 = _errs140 === errors;
valid26 = valid26 || _valid19;
if(!valid26){
const _errs142 = errors;
if(data28 !== null){
const err132 = {instancePath:instancePath+"/backlog/unavailableReason",schemaPath:"#/definitions/Backlog/properties/unavailableReason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err132];
}
else {
vErrors.push(err132);
}
errors++;
}
var _valid19 = _errs142 === errors;
valid26 = valid26 || _valid19;
}
if(!valid26){
const err133 = {instancePath:instancePath+"/backlog/unavailableReason",schemaPath:"#/definitions/Backlog/properties/unavailableReason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err133];
}
else {
vErrors.push(err133);
}
errors++;
}
else {
errors = _errs139;
if(vErrors !== null){
if(_errs139){
vErrors.length = _errs139;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err134 = {instancePath:instancePath+"/backlog",schemaPath:"#/definitions/Backlog/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err134];
}
else {
vErrors.push(err134);
}
errors++;
}
}
if(data.eta !== undefined){
let data29 = data.eta;
const _errs148 = errors;
let valid29 = true;
const _errs149 = errors;
if(data29 && typeof data29 == "object" && !Array.isArray(data29)){
let missing0;
if((data29.state === undefined) && (missing0 = "state")){
const err135 = {};
if(vErrors === null){
vErrors = [err135];
}
else {
vErrors.push(err135);
}
errors++;
}
else {
if(data29.state !== undefined){
if("available" !== data29.state){
const err136 = {};
if(vErrors === null){
vErrors = [err136];
}
else {
vErrors.push(err136);
}
errors++;
}
}
}
}
var _valid20 = _errs149 === errors;
errors = _errs148;
if(vErrors !== null){
if(_errs148){
vErrors.length = _errs148;
}
else {
vErrors = null;
}
}
let ifClause0;
if(_valid20){
const _errs151 = errors;
if(data29 && typeof data29 == "object" && !Array.isArray(data29)){
if(data29.estimatedRemainingSeconds !== undefined){
let data31 = data29.estimatedRemainingSeconds;
if((typeof data31 == "number") && (isFinite(data31))){
if(data31 < 0 || isNaN(data31)){
const err137 = {instancePath:instancePath+"/eta/estimatedRemainingSeconds",schemaPath:"#/definitions/Eta/allOf/0/then/properties/estimatedRemainingSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err137];
}
else {
vErrors.push(err137);
}
errors++;
}
}
else {
const err138 = {instancePath:instancePath+"/eta/estimatedRemainingSeconds",schemaPath:"#/definitions/Eta/allOf/0/then/properties/estimatedRemainingSeconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err138];
}
else {
vErrors.push(err138);
}
errors++;
}
}
if(data29.estimatedCompletionAt !== undefined){
let data32 = data29.estimatedCompletionAt;
if(typeof data32 === "string"){
if(!(formats0.validate(data32))){
const err139 = {instancePath:instancePath+"/eta/estimatedCompletionAt",schemaPath:"#/definitions/Eta/allOf/0/then/properties/estimatedCompletionAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err139];
}
else {
vErrors.push(err139);
}
errors++;
}
}
else {
const err140 = {instancePath:instancePath+"/eta/estimatedCompletionAt",schemaPath:"#/definitions/Eta/allOf/0/then/properties/estimatedCompletionAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err140];
}
else {
vErrors.push(err140);
}
errors++;
}
}
if(data29.unavailableReason !== undefined){
if(data29.unavailableReason !== null){
const err141 = {instancePath:instancePath+"/eta/unavailableReason",schemaPath:"#/definitions/Eta/allOf/0/then/properties/unavailableReason/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err141];
}
else {
vErrors.push(err141);
}
errors++;
}
}
}
var _valid20 = _errs151 === errors;
valid29 = _valid20;
ifClause0 = "then";
}
else {
const _errs158 = errors;
if(data29 && typeof data29 == "object" && !Array.isArray(data29)){
if(data29.estimatedRemainingSeconds !== undefined){
if(data29.estimatedRemainingSeconds !== null){
const err142 = {instancePath:instancePath+"/eta/estimatedRemainingSeconds",schemaPath:"#/definitions/Eta/allOf/0/else/properties/estimatedRemainingSeconds/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err142];
}
else {
vErrors.push(err142);
}
errors++;
}
}
if(data29.estimatedCompletionAt !== undefined){
if(data29.estimatedCompletionAt !== null){
const err143 = {instancePath:instancePath+"/eta/estimatedCompletionAt",schemaPath:"#/definitions/Eta/allOf/0/else/properties/estimatedCompletionAt/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err143];
}
else {
vErrors.push(err143);
}
errors++;
}
}
if(data29.unavailableReason !== undefined){
let data36 = data29.unavailableReason;
if(typeof data36 === "string"){
if(func2(data36) < 1){
const err144 = {instancePath:instancePath+"/eta/unavailableReason",schemaPath:"#/definitions/Eta/allOf/0/else/properties/unavailableReason/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err144];
}
else {
vErrors.push(err144);
}
errors++;
}
}
else {
const err145 = {instancePath:instancePath+"/eta/unavailableReason",schemaPath:"#/definitions/Eta/allOf/0/else/properties/unavailableReason/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err145];
}
else {
vErrors.push(err145);
}
errors++;
}
}
}
var _valid20 = _errs158 === errors;
valid29 = _valid20;
ifClause0 = "else";
}
if(!valid29){
const err146 = {instancePath:instancePath+"/eta",schemaPath:"#/definitions/Eta/allOf/0/if",keyword:"if",params:{failingKeyword: ifClause0},message:"must match \""+ifClause0+"\" schema"};
if(vErrors === null){
vErrors = [err146];
}
else {
vErrors.push(err146);
}
errors++;
}
if(data29 && typeof data29 == "object" && !Array.isArray(data29)){
if(data29.state === undefined){
const err147 = {instancePath:instancePath+"/eta",schemaPath:"#/definitions/Eta/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err147];
}
else {
vErrors.push(err147);
}
errors++;
}
if(data29.estimatedRemainingSeconds === undefined){
const err148 = {instancePath:instancePath+"/eta",schemaPath:"#/definitions/Eta/required",keyword:"required",params:{missingProperty: "estimatedRemainingSeconds"},message:"must have required property '"+"estimatedRemainingSeconds"+"'"};
if(vErrors === null){
vErrors = [err148];
}
else {
vErrors.push(err148);
}
errors++;
}
if(data29.estimatedCompletionAt === undefined){
const err149 = {instancePath:instancePath+"/eta",schemaPath:"#/definitions/Eta/required",keyword:"required",params:{missingProperty: "estimatedCompletionAt"},message:"must have required property '"+"estimatedCompletionAt"+"'"};
if(vErrors === null){
vErrors = [err149];
}
else {
vErrors.push(err149);
}
errors++;
}
if(data29.basis === undefined){
const err150 = {instancePath:instancePath+"/eta",schemaPath:"#/definitions/Eta/required",keyword:"required",params:{missingProperty: "basis"},message:"must have required property '"+"basis"+"'"};
if(vErrors === null){
vErrors = [err150];
}
else {
vErrors.push(err150);
}
errors++;
}
if(data29.rateWindowSeconds === undefined){
const err151 = {instancePath:instancePath+"/eta",schemaPath:"#/definitions/Eta/required",keyword:"required",params:{missingProperty: "rateWindowSeconds"},message:"must have required property '"+"rateWindowSeconds"+"'"};
if(vErrors === null){
vErrors = [err151];
}
else {
vErrors.push(err151);
}
errors++;
}
if(data29.observationSeconds === undefined){
const err152 = {instancePath:instancePath+"/eta",schemaPath:"#/definitions/Eta/required",keyword:"required",params:{missingProperty: "observationSeconds"},message:"must have required property '"+"observationSeconds"+"'"};
if(vErrors === null){
vErrors = [err152];
}
else {
vErrors.push(err152);
}
errors++;
}
if(data29.sampleCount === undefined){
const err153 = {instancePath:instancePath+"/eta",schemaPath:"#/definitions/Eta/required",keyword:"required",params:{missingProperty: "sampleCount"},message:"must have required property '"+"sampleCount"+"'"};
if(vErrors === null){
vErrors = [err153];
}
else {
vErrors.push(err153);
}
errors++;
}
if(data29.unavailableReason === undefined){
const err154 = {instancePath:instancePath+"/eta",schemaPath:"#/definitions/Eta/required",keyword:"required",params:{missingProperty: "unavailableReason"},message:"must have required property '"+"unavailableReason"+"'"};
if(vErrors === null){
vErrors = [err154];
}
else {
vErrors.push(err154);
}
errors++;
}
if(data29.state !== undefined){
let data37 = data29.state;
if(typeof data37 !== "string"){
const err155 = {instancePath:instancePath+"/eta/state",schemaPath:"#/definitions/Eta/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err155];
}
else {
vErrors.push(err155);
}
errors++;
}
if(!((data37 === "available") || (data37 === "unavailable"))){
const err156 = {instancePath:instancePath+"/eta/state",schemaPath:"#/definitions/Eta/properties/state/enum",keyword:"enum",params:{allowedValues: schema30.properties.state.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err156];
}
else {
vErrors.push(err156);
}
errors++;
}
}
if(data29.estimatedRemainingSeconds !== undefined){
let data38 = data29.estimatedRemainingSeconds;
const _errs169 = errors;
let valid34 = false;
const _errs170 = errors;
if((typeof data38 == "number") && (isFinite(data38))){
if(data38 < 0 || isNaN(data38)){
const err157 = {instancePath:instancePath+"/eta/estimatedRemainingSeconds",schemaPath:"#/definitions/Eta/properties/estimatedRemainingSeconds/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err157];
}
else {
vErrors.push(err157);
}
errors++;
}
}
else {
const err158 = {instancePath:instancePath+"/eta/estimatedRemainingSeconds",schemaPath:"#/definitions/Eta/properties/estimatedRemainingSeconds/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err158];
}
else {
vErrors.push(err158);
}
errors++;
}
var _valid21 = _errs170 === errors;
valid34 = valid34 || _valid21;
if(!valid34){
const _errs172 = errors;
if(data38 !== null){
const err159 = {instancePath:instancePath+"/eta/estimatedRemainingSeconds",schemaPath:"#/definitions/Eta/properties/estimatedRemainingSeconds/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err159];
}
else {
vErrors.push(err159);
}
errors++;
}
var _valid21 = _errs172 === errors;
valid34 = valid34 || _valid21;
}
if(!valid34){
const err160 = {instancePath:instancePath+"/eta/estimatedRemainingSeconds",schemaPath:"#/definitions/Eta/properties/estimatedRemainingSeconds/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err160];
}
else {
vErrors.push(err160);
}
errors++;
}
else {
errors = _errs169;
if(vErrors !== null){
if(_errs169){
vErrors.length = _errs169;
}
else {
vErrors = null;
}
}
}
}
if(data29.estimatedCompletionAt !== undefined){
let data39 = data29.estimatedCompletionAt;
const _errs175 = errors;
let valid35 = false;
const _errs176 = errors;
if(typeof data39 === "string"){
if(!(formats0.validate(data39))){
const err161 = {instancePath:instancePath+"/eta/estimatedCompletionAt",schemaPath:"#/definitions/Eta/properties/estimatedCompletionAt/anyOf/0/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err161];
}
else {
vErrors.push(err161);
}
errors++;
}
}
else {
const err162 = {instancePath:instancePath+"/eta/estimatedCompletionAt",schemaPath:"#/definitions/Eta/properties/estimatedCompletionAt/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err162];
}
else {
vErrors.push(err162);
}
errors++;
}
var _valid22 = _errs176 === errors;
valid35 = valid35 || _valid22;
if(!valid35){
const _errs178 = errors;
if(data39 !== null){
const err163 = {instancePath:instancePath+"/eta/estimatedCompletionAt",schemaPath:"#/definitions/Eta/properties/estimatedCompletionAt/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err163];
}
else {
vErrors.push(err163);
}
errors++;
}
var _valid22 = _errs178 === errors;
valid35 = valid35 || _valid22;
}
if(!valid35){
const err164 = {instancePath:instancePath+"/eta/estimatedCompletionAt",schemaPath:"#/definitions/Eta/properties/estimatedCompletionAt/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err164];
}
else {
vErrors.push(err164);
}
errors++;
}
else {
errors = _errs175;
if(vErrors !== null){
if(_errs175){
vErrors.length = _errs175;
}
else {
vErrors = null;
}
}
}
}
if(data29.basis !== undefined){
if("knownBacklog" !== data29.basis){
const err165 = {instancePath:instancePath+"/eta/basis",schemaPath:"#/definitions/Eta/properties/basis/const",keyword:"const",params:{allowedValue: "knownBacklog"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err165];
}
else {
vErrors.push(err165);
}
errors++;
}
}
if(data29.rateWindowSeconds !== undefined){
let data41 = data29.rateWindowSeconds;
if(!(((typeof data41 == "number") && (!(data41 % 1) && !isNaN(data41))) && (isFinite(data41)))){
const err166 = {instancePath:instancePath+"/eta/rateWindowSeconds",schemaPath:"#/definitions/Eta/properties/rateWindowSeconds/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err166];
}
else {
vErrors.push(err166);
}
errors++;
}
if(!((data41 === 60) || (data41 === 300))){
const err167 = {instancePath:instancePath+"/eta/rateWindowSeconds",schemaPath:"#/definitions/Eta/properties/rateWindowSeconds/enum",keyword:"enum",params:{allowedValues: schema30.properties.rateWindowSeconds.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err167];
}
else {
vErrors.push(err167);
}
errors++;
}
}
if(data29.observationSeconds !== undefined){
let data42 = data29.observationSeconds;
if((typeof data42 == "number") && (isFinite(data42))){
if(data42 < 0 || isNaN(data42)){
const err168 = {instancePath:instancePath+"/eta/observationSeconds",schemaPath:"#/definitions/Eta/properties/observationSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err168];
}
else {
vErrors.push(err168);
}
errors++;
}
}
else {
const err169 = {instancePath:instancePath+"/eta/observationSeconds",schemaPath:"#/definitions/Eta/properties/observationSeconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err169];
}
else {
vErrors.push(err169);
}
errors++;
}
}
if(data29.sampleCount !== undefined){
let data43 = data29.sampleCount;
if(!(((typeof data43 == "number") && (!(data43 % 1) && !isNaN(data43))) && (isFinite(data43)))){
const err170 = {instancePath:instancePath+"/eta/sampleCount",schemaPath:"#/definitions/Eta/properties/sampleCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err170];
}
else {
vErrors.push(err170);
}
errors++;
}
if((typeof data43 == "number") && (isFinite(data43))){
if(data43 > 9007199254740991 || isNaN(data43)){
const err171 = {instancePath:instancePath+"/eta/sampleCount",schemaPath:"#/definitions/Eta/properties/sampleCount/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err171];
}
else {
vErrors.push(err171);
}
errors++;
}
if(data43 < 0 || isNaN(data43)){
const err172 = {instancePath:instancePath+"/eta/sampleCount",schemaPath:"#/definitions/Eta/properties/sampleCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err172];
}
else {
vErrors.push(err172);
}
errors++;
}
}
}
if(data29.unavailableReason !== undefined){
let data44 = data29.unavailableReason;
const _errs188 = errors;
let valid36 = false;
const _errs189 = errors;
if(typeof data44 === "string"){
if(func2(data44) < 1){
const err173 = {instancePath:instancePath+"/eta/unavailableReason",schemaPath:"#/definitions/Eta/properties/unavailableReason/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err173];
}
else {
vErrors.push(err173);
}
errors++;
}
}
else {
const err174 = {instancePath:instancePath+"/eta/unavailableReason",schemaPath:"#/definitions/Eta/properties/unavailableReason/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err174];
}
else {
vErrors.push(err174);
}
errors++;
}
var _valid23 = _errs189 === errors;
valid36 = valid36 || _valid23;
if(!valid36){
const _errs191 = errors;
if(data44 !== null){
const err175 = {instancePath:instancePath+"/eta/unavailableReason",schemaPath:"#/definitions/Eta/properties/unavailableReason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err175];
}
else {
vErrors.push(err175);
}
errors++;
}
var _valid23 = _errs191 === errors;
valid36 = valid36 || _valid23;
}
if(!valid36){
const err176 = {instancePath:instancePath+"/eta/unavailableReason",schemaPath:"#/definitions/Eta/properties/unavailableReason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err176];
}
else {
vErrors.push(err176);
}
errors++;
}
else {
errors = _errs188;
if(vErrors !== null){
if(_errs188){
vErrors.length = _errs188;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err177 = {instancePath:instancePath+"/eta",schemaPath:"#/definitions/Eta/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err177];
}
else {
vErrors.push(err177);
}
errors++;
}
}
if(data.coverage !== undefined){
let data45 = data.coverage;
if(data45 && typeof data45 == "object" && !Array.isArray(data45)){
if(data45.sampledAt === undefined){
const err178 = {instancePath:instancePath+"/coverage",schemaPath:"#/definitions/Coverage/required",keyword:"required",params:{missingProperty: "sampledAt"},message:"must have required property '"+"sampledAt"+"'"};
if(vErrors === null){
vErrors = [err178];
}
else {
vErrors.push(err178);
}
errors++;
}
if(data45.knownEligible === undefined){
const err179 = {instancePath:instancePath+"/coverage",schemaPath:"#/definitions/Coverage/required",keyword:"required",params:{missingProperty: "knownEligible"},message:"must have required property '"+"knownEligible"+"'"};
if(vErrors === null){
vErrors = [err179];
}
else {
vErrors.push(err179);
}
errors++;
}
if(data45.indexedCurrent === undefined){
const err180 = {instancePath:instancePath+"/coverage",schemaPath:"#/definitions/Coverage/required",keyword:"required",params:{missingProperty: "indexedCurrent"},message:"must have required property '"+"indexedCurrent"+"'"};
if(vErrors === null){
vErrors = [err180];
}
else {
vErrors.push(err180);
}
errors++;
}
if(data45.emptyCurrent === undefined){
const err181 = {instancePath:instancePath+"/coverage",schemaPath:"#/definitions/Coverage/required",keyword:"required",params:{missingProperty: "emptyCurrent"},message:"must have required property '"+"emptyCurrent"+"'"};
if(vErrors === null){
vErrors = [err181];
}
else {
vErrors.push(err181);
}
errors++;
}
if(data45.unindexableCurrent === undefined){
const err182 = {instancePath:instancePath+"/coverage",schemaPath:"#/definitions/Coverage/required",keyword:"required",params:{missingProperty: "unindexableCurrent"},message:"must have required property '"+"unindexableCurrent"+"'"};
if(vErrors === null){
vErrors = [err182];
}
else {
vErrors.push(err182);
}
errors++;
}
if(data45.stale === undefined){
const err183 = {instancePath:instancePath+"/coverage",schemaPath:"#/definitions/Coverage/required",keyword:"required",params:{missingProperty: "stale"},message:"must have required property '"+"stale"+"'"};
if(vErrors === null){
vErrors = [err183];
}
else {
vErrors.push(err183);
}
errors++;
}
if(data45.neverProcessed === undefined){
const err184 = {instancePath:instancePath+"/coverage",schemaPath:"#/definitions/Coverage/required",keyword:"required",params:{missingProperty: "neverProcessed"},message:"must have required property '"+"neverProcessed"+"'"};
if(vErrors === null){
vErrors = [err184];
}
else {
vErrors.push(err184);
}
errors++;
}
if(data45.pendingDeletions === undefined){
const err185 = {instancePath:instancePath+"/coverage",schemaPath:"#/definitions/Coverage/required",keyword:"required",params:{missingProperty: "pendingDeletions"},message:"must have required property '"+"pendingDeletions"+"'"};
if(vErrors === null){
vErrors = [err185];
}
else {
vErrors.push(err185);
}
errors++;
}
if(data45.unavailableReason === undefined){
const err186 = {instancePath:instancePath+"/coverage",schemaPath:"#/definitions/Coverage/required",keyword:"required",params:{missingProperty: "unavailableReason"},message:"must have required property '"+"unavailableReason"+"'"};
if(vErrors === null){
vErrors = [err186];
}
else {
vErrors.push(err186);
}
errors++;
}
if(data45.sampledAt !== undefined){
let data46 = data45.sampledAt;
if(typeof data46 === "string"){
if(!(formats0.validate(data46))){
const err187 = {instancePath:instancePath+"/coverage/sampledAt",schemaPath:"#/definitions/Coverage/properties/sampledAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err187];
}
else {
vErrors.push(err187);
}
errors++;
}
}
else {
const err188 = {instancePath:instancePath+"/coverage/sampledAt",schemaPath:"#/definitions/Coverage/properties/sampledAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err188];
}
else {
vErrors.push(err188);
}
errors++;
}
}
if(data45.knownEligible !== undefined){
let data47 = data45.knownEligible;
const _errs200 = errors;
let valid39 = false;
const _errs201 = errors;
if(!(((typeof data47 == "number") && (!(data47 % 1) && !isNaN(data47))) && (isFinite(data47)))){
const err189 = {instancePath:instancePath+"/coverage/knownEligible",schemaPath:"#/definitions/Coverage/properties/knownEligible/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err189];
}
else {
vErrors.push(err189);
}
errors++;
}
if((typeof data47 == "number") && (isFinite(data47))){
if(data47 > 9007199254740991 || isNaN(data47)){
const err190 = {instancePath:instancePath+"/coverage/knownEligible",schemaPath:"#/definitions/Coverage/properties/knownEligible/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err190];
}
else {
vErrors.push(err190);
}
errors++;
}
if(data47 < 0 || isNaN(data47)){
const err191 = {instancePath:instancePath+"/coverage/knownEligible",schemaPath:"#/definitions/Coverage/properties/knownEligible/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err191];
}
else {
vErrors.push(err191);
}
errors++;
}
}
var _valid24 = _errs201 === errors;
valid39 = valid39 || _valid24;
if(!valid39){
const _errs203 = errors;
if(data47 !== null){
const err192 = {instancePath:instancePath+"/coverage/knownEligible",schemaPath:"#/definitions/Coverage/properties/knownEligible/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err192];
}
else {
vErrors.push(err192);
}
errors++;
}
var _valid24 = _errs203 === errors;
valid39 = valid39 || _valid24;
}
if(!valid39){
const err193 = {instancePath:instancePath+"/coverage/knownEligible",schemaPath:"#/definitions/Coverage/properties/knownEligible/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err193];
}
else {
vErrors.push(err193);
}
errors++;
}
else {
errors = _errs200;
if(vErrors !== null){
if(_errs200){
vErrors.length = _errs200;
}
else {
vErrors = null;
}
}
}
}
if(data45.indexedCurrent !== undefined){
let data48 = data45.indexedCurrent;
const _errs206 = errors;
let valid40 = false;
const _errs207 = errors;
if(!(((typeof data48 == "number") && (!(data48 % 1) && !isNaN(data48))) && (isFinite(data48)))){
const err194 = {instancePath:instancePath+"/coverage/indexedCurrent",schemaPath:"#/definitions/Coverage/properties/indexedCurrent/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err194];
}
else {
vErrors.push(err194);
}
errors++;
}
if((typeof data48 == "number") && (isFinite(data48))){
if(data48 > 9007199254740991 || isNaN(data48)){
const err195 = {instancePath:instancePath+"/coverage/indexedCurrent",schemaPath:"#/definitions/Coverage/properties/indexedCurrent/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err195];
}
else {
vErrors.push(err195);
}
errors++;
}
if(data48 < 0 || isNaN(data48)){
const err196 = {instancePath:instancePath+"/coverage/indexedCurrent",schemaPath:"#/definitions/Coverage/properties/indexedCurrent/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err196];
}
else {
vErrors.push(err196);
}
errors++;
}
}
var _valid25 = _errs207 === errors;
valid40 = valid40 || _valid25;
if(!valid40){
const _errs209 = errors;
if(data48 !== null){
const err197 = {instancePath:instancePath+"/coverage/indexedCurrent",schemaPath:"#/definitions/Coverage/properties/indexedCurrent/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err197];
}
else {
vErrors.push(err197);
}
errors++;
}
var _valid25 = _errs209 === errors;
valid40 = valid40 || _valid25;
}
if(!valid40){
const err198 = {instancePath:instancePath+"/coverage/indexedCurrent",schemaPath:"#/definitions/Coverage/properties/indexedCurrent/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err198];
}
else {
vErrors.push(err198);
}
errors++;
}
else {
errors = _errs206;
if(vErrors !== null){
if(_errs206){
vErrors.length = _errs206;
}
else {
vErrors = null;
}
}
}
}
if(data45.emptyCurrent !== undefined){
let data49 = data45.emptyCurrent;
const _errs212 = errors;
let valid41 = false;
const _errs213 = errors;
if(!(((typeof data49 == "number") && (!(data49 % 1) && !isNaN(data49))) && (isFinite(data49)))){
const err199 = {instancePath:instancePath+"/coverage/emptyCurrent",schemaPath:"#/definitions/Coverage/properties/emptyCurrent/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err199];
}
else {
vErrors.push(err199);
}
errors++;
}
if((typeof data49 == "number") && (isFinite(data49))){
if(data49 > 9007199254740991 || isNaN(data49)){
const err200 = {instancePath:instancePath+"/coverage/emptyCurrent",schemaPath:"#/definitions/Coverage/properties/emptyCurrent/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err200];
}
else {
vErrors.push(err200);
}
errors++;
}
if(data49 < 0 || isNaN(data49)){
const err201 = {instancePath:instancePath+"/coverage/emptyCurrent",schemaPath:"#/definitions/Coverage/properties/emptyCurrent/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err201];
}
else {
vErrors.push(err201);
}
errors++;
}
}
var _valid26 = _errs213 === errors;
valid41 = valid41 || _valid26;
if(!valid41){
const _errs215 = errors;
if(data49 !== null){
const err202 = {instancePath:instancePath+"/coverage/emptyCurrent",schemaPath:"#/definitions/Coverage/properties/emptyCurrent/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err202];
}
else {
vErrors.push(err202);
}
errors++;
}
var _valid26 = _errs215 === errors;
valid41 = valid41 || _valid26;
}
if(!valid41){
const err203 = {instancePath:instancePath+"/coverage/emptyCurrent",schemaPath:"#/definitions/Coverage/properties/emptyCurrent/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err203];
}
else {
vErrors.push(err203);
}
errors++;
}
else {
errors = _errs212;
if(vErrors !== null){
if(_errs212){
vErrors.length = _errs212;
}
else {
vErrors = null;
}
}
}
}
if(data45.unindexableCurrent !== undefined){
let data50 = data45.unindexableCurrent;
const _errs218 = errors;
let valid42 = false;
const _errs219 = errors;
if(!(((typeof data50 == "number") && (!(data50 % 1) && !isNaN(data50))) && (isFinite(data50)))){
const err204 = {instancePath:instancePath+"/coverage/unindexableCurrent",schemaPath:"#/definitions/Coverage/properties/unindexableCurrent/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err204];
}
else {
vErrors.push(err204);
}
errors++;
}
if((typeof data50 == "number") && (isFinite(data50))){
if(data50 > 9007199254740991 || isNaN(data50)){
const err205 = {instancePath:instancePath+"/coverage/unindexableCurrent",schemaPath:"#/definitions/Coverage/properties/unindexableCurrent/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err205];
}
else {
vErrors.push(err205);
}
errors++;
}
if(data50 < 0 || isNaN(data50)){
const err206 = {instancePath:instancePath+"/coverage/unindexableCurrent",schemaPath:"#/definitions/Coverage/properties/unindexableCurrent/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err206];
}
else {
vErrors.push(err206);
}
errors++;
}
}
var _valid27 = _errs219 === errors;
valid42 = valid42 || _valid27;
if(!valid42){
const _errs221 = errors;
if(data50 !== null){
const err207 = {instancePath:instancePath+"/coverage/unindexableCurrent",schemaPath:"#/definitions/Coverage/properties/unindexableCurrent/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err207];
}
else {
vErrors.push(err207);
}
errors++;
}
var _valid27 = _errs221 === errors;
valid42 = valid42 || _valid27;
}
if(!valid42){
const err208 = {instancePath:instancePath+"/coverage/unindexableCurrent",schemaPath:"#/definitions/Coverage/properties/unindexableCurrent/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err208];
}
else {
vErrors.push(err208);
}
errors++;
}
else {
errors = _errs218;
if(vErrors !== null){
if(_errs218){
vErrors.length = _errs218;
}
else {
vErrors = null;
}
}
}
}
if(data45.stale !== undefined){
let data51 = data45.stale;
const _errs224 = errors;
let valid43 = false;
const _errs225 = errors;
if(!(((typeof data51 == "number") && (!(data51 % 1) && !isNaN(data51))) && (isFinite(data51)))){
const err209 = {instancePath:instancePath+"/coverage/stale",schemaPath:"#/definitions/Coverage/properties/stale/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err209];
}
else {
vErrors.push(err209);
}
errors++;
}
if((typeof data51 == "number") && (isFinite(data51))){
if(data51 > 9007199254740991 || isNaN(data51)){
const err210 = {instancePath:instancePath+"/coverage/stale",schemaPath:"#/definitions/Coverage/properties/stale/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err210];
}
else {
vErrors.push(err210);
}
errors++;
}
if(data51 < 0 || isNaN(data51)){
const err211 = {instancePath:instancePath+"/coverage/stale",schemaPath:"#/definitions/Coverage/properties/stale/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err211];
}
else {
vErrors.push(err211);
}
errors++;
}
}
var _valid28 = _errs225 === errors;
valid43 = valid43 || _valid28;
if(!valid43){
const _errs227 = errors;
if(data51 !== null){
const err212 = {instancePath:instancePath+"/coverage/stale",schemaPath:"#/definitions/Coverage/properties/stale/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err212];
}
else {
vErrors.push(err212);
}
errors++;
}
var _valid28 = _errs227 === errors;
valid43 = valid43 || _valid28;
}
if(!valid43){
const err213 = {instancePath:instancePath+"/coverage/stale",schemaPath:"#/definitions/Coverage/properties/stale/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err213];
}
else {
vErrors.push(err213);
}
errors++;
}
else {
errors = _errs224;
if(vErrors !== null){
if(_errs224){
vErrors.length = _errs224;
}
else {
vErrors = null;
}
}
}
}
if(data45.neverProcessed !== undefined){
let data52 = data45.neverProcessed;
const _errs230 = errors;
let valid44 = false;
const _errs231 = errors;
if(!(((typeof data52 == "number") && (!(data52 % 1) && !isNaN(data52))) && (isFinite(data52)))){
const err214 = {instancePath:instancePath+"/coverage/neverProcessed",schemaPath:"#/definitions/Coverage/properties/neverProcessed/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err214];
}
else {
vErrors.push(err214);
}
errors++;
}
if((typeof data52 == "number") && (isFinite(data52))){
if(data52 > 9007199254740991 || isNaN(data52)){
const err215 = {instancePath:instancePath+"/coverage/neverProcessed",schemaPath:"#/definitions/Coverage/properties/neverProcessed/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err215];
}
else {
vErrors.push(err215);
}
errors++;
}
if(data52 < 0 || isNaN(data52)){
const err216 = {instancePath:instancePath+"/coverage/neverProcessed",schemaPath:"#/definitions/Coverage/properties/neverProcessed/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err216];
}
else {
vErrors.push(err216);
}
errors++;
}
}
var _valid29 = _errs231 === errors;
valid44 = valid44 || _valid29;
if(!valid44){
const _errs233 = errors;
if(data52 !== null){
const err217 = {instancePath:instancePath+"/coverage/neverProcessed",schemaPath:"#/definitions/Coverage/properties/neverProcessed/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err217];
}
else {
vErrors.push(err217);
}
errors++;
}
var _valid29 = _errs233 === errors;
valid44 = valid44 || _valid29;
}
if(!valid44){
const err218 = {instancePath:instancePath+"/coverage/neverProcessed",schemaPath:"#/definitions/Coverage/properties/neverProcessed/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err218];
}
else {
vErrors.push(err218);
}
errors++;
}
else {
errors = _errs230;
if(vErrors !== null){
if(_errs230){
vErrors.length = _errs230;
}
else {
vErrors = null;
}
}
}
}
if(data45.pendingDeletions !== undefined){
let data53 = data45.pendingDeletions;
const _errs236 = errors;
let valid45 = false;
const _errs237 = errors;
if(!(((typeof data53 == "number") && (!(data53 % 1) && !isNaN(data53))) && (isFinite(data53)))){
const err219 = {instancePath:instancePath+"/coverage/pendingDeletions",schemaPath:"#/definitions/Coverage/properties/pendingDeletions/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err219];
}
else {
vErrors.push(err219);
}
errors++;
}
if((typeof data53 == "number") && (isFinite(data53))){
if(data53 > 9007199254740991 || isNaN(data53)){
const err220 = {instancePath:instancePath+"/coverage/pendingDeletions",schemaPath:"#/definitions/Coverage/properties/pendingDeletions/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err220];
}
else {
vErrors.push(err220);
}
errors++;
}
if(data53 < 0 || isNaN(data53)){
const err221 = {instancePath:instancePath+"/coverage/pendingDeletions",schemaPath:"#/definitions/Coverage/properties/pendingDeletions/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err221];
}
else {
vErrors.push(err221);
}
errors++;
}
}
var _valid30 = _errs237 === errors;
valid45 = valid45 || _valid30;
if(!valid45){
const _errs239 = errors;
if(data53 !== null){
const err222 = {instancePath:instancePath+"/coverage/pendingDeletions",schemaPath:"#/definitions/Coverage/properties/pendingDeletions/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err222];
}
else {
vErrors.push(err222);
}
errors++;
}
var _valid30 = _errs239 === errors;
valid45 = valid45 || _valid30;
}
if(!valid45){
const err223 = {instancePath:instancePath+"/coverage/pendingDeletions",schemaPath:"#/definitions/Coverage/properties/pendingDeletions/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err223];
}
else {
vErrors.push(err223);
}
errors++;
}
else {
errors = _errs236;
if(vErrors !== null){
if(_errs236){
vErrors.length = _errs236;
}
else {
vErrors = null;
}
}
}
}
if(data45.unavailableReason !== undefined){
let data54 = data45.unavailableReason;
const _errs242 = errors;
let valid46 = false;
const _errs243 = errors;
if(typeof data54 === "string"){
if(func2(data54) < 1){
const err224 = {instancePath:instancePath+"/coverage/unavailableReason",schemaPath:"#/definitions/Coverage/properties/unavailableReason/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err224];
}
else {
vErrors.push(err224);
}
errors++;
}
}
else {
const err225 = {instancePath:instancePath+"/coverage/unavailableReason",schemaPath:"#/definitions/Coverage/properties/unavailableReason/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err225];
}
else {
vErrors.push(err225);
}
errors++;
}
var _valid31 = _errs243 === errors;
valid46 = valid46 || _valid31;
if(!valid46){
const _errs245 = errors;
if(data54 !== null){
const err226 = {instancePath:instancePath+"/coverage/unavailableReason",schemaPath:"#/definitions/Coverage/properties/unavailableReason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err226];
}
else {
vErrors.push(err226);
}
errors++;
}
var _valid31 = _errs245 === errors;
valid46 = valid46 || _valid31;
}
if(!valid46){
const err227 = {instancePath:instancePath+"/coverage/unavailableReason",schemaPath:"#/definitions/Coverage/properties/unavailableReason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err227];
}
else {
vErrors.push(err227);
}
errors++;
}
else {
errors = _errs242;
if(vErrors !== null){
if(_errs242){
vErrors.length = _errs242;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err228 = {instancePath:instancePath+"/coverage",schemaPath:"#/definitions/Coverage/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err228];
}
else {
vErrors.push(err228);
}
errors++;
}
}
if(data.depth !== undefined){
if(!(validate21(data.depth, {instancePath:instancePath+"/depth",parentData:data,parentDataProperty:"depth",rootData}))){
vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
errors = vErrors.length;
}
}
if(data.freshness !== undefined){
let data56 = data.freshness;
if(data56 && typeof data56 == "object" && !Array.isArray(data56)){
if(data56.observationSeconds === undefined){
const err229 = {instancePath:instancePath+"/freshness",schemaPath:"#/definitions/Latency/required",keyword:"required",params:{missingProperty: "observationSeconds"},message:"must have required property '"+"observationSeconds"+"'"};
if(vErrors === null){
vErrors = [err229];
}
else {
vErrors.push(err229);
}
errors++;
}
if(data56.sampleCount === undefined){
const err230 = {instancePath:instancePath+"/freshness",schemaPath:"#/definitions/Latency/required",keyword:"required",params:{missingProperty: "sampleCount"},message:"must have required property '"+"sampleCount"+"'"};
if(vErrors === null){
vErrors = [err230];
}
else {
vErrors.push(err230);
}
errors++;
}
if(data56.p50Seconds === undefined){
const err231 = {instancePath:instancePath+"/freshness",schemaPath:"#/definitions/Latency/required",keyword:"required",params:{missingProperty: "p50Seconds"},message:"must have required property '"+"p50Seconds"+"'"};
if(vErrors === null){
vErrors = [err231];
}
else {
vErrors.push(err231);
}
errors++;
}
if(data56.p95Seconds === undefined){
const err232 = {instancePath:instancePath+"/freshness",schemaPath:"#/definitions/Latency/required",keyword:"required",params:{missingProperty: "p95Seconds"},message:"must have required property '"+"p95Seconds"+"'"};
if(vErrors === null){
vErrors = [err232];
}
else {
vErrors.push(err232);
}
errors++;
}
if(data56.unavailableReason === undefined){
const err233 = {instancePath:instancePath+"/freshness",schemaPath:"#/definitions/Latency/required",keyword:"required",params:{missingProperty: "unavailableReason"},message:"must have required property '"+"unavailableReason"+"'"};
if(vErrors === null){
vErrors = [err233];
}
else {
vErrors.push(err233);
}
errors++;
}
if(data56.observationSeconds !== undefined){
let data57 = data56.observationSeconds;
if((typeof data57 == "number") && (isFinite(data57))){
if(data57 < 0 || isNaN(data57)){
const err234 = {instancePath:instancePath+"/freshness/observationSeconds",schemaPath:"#/definitions/Latency/properties/observationSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err234];
}
else {
vErrors.push(err234);
}
errors++;
}
}
else {
const err235 = {instancePath:instancePath+"/freshness/observationSeconds",schemaPath:"#/definitions/Latency/properties/observationSeconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err235];
}
else {
vErrors.push(err235);
}
errors++;
}
}
if(data56.sampleCount !== undefined){
let data58 = data56.sampleCount;
if(!(((typeof data58 == "number") && (!(data58 % 1) && !isNaN(data58))) && (isFinite(data58)))){
const err236 = {instancePath:instancePath+"/freshness/sampleCount",schemaPath:"#/definitions/Latency/properties/sampleCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err236];
}
else {
vErrors.push(err236);
}
errors++;
}
if((typeof data58 == "number") && (isFinite(data58))){
if(data58 > 9007199254740991 || isNaN(data58)){
const err237 = {instancePath:instancePath+"/freshness/sampleCount",schemaPath:"#/definitions/Latency/properties/sampleCount/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err237];
}
else {
vErrors.push(err237);
}
errors++;
}
if(data58 < 0 || isNaN(data58)){
const err238 = {instancePath:instancePath+"/freshness/sampleCount",schemaPath:"#/definitions/Latency/properties/sampleCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err238];
}
else {
vErrors.push(err238);
}
errors++;
}
}
}
if(data56.p50Seconds !== undefined){
let data59 = data56.p50Seconds;
const _errs257 = errors;
let valid49 = false;
const _errs258 = errors;
if((typeof data59 == "number") && (isFinite(data59))){
if(data59 < 0 || isNaN(data59)){
const err239 = {instancePath:instancePath+"/freshness/p50Seconds",schemaPath:"#/definitions/Latency/properties/p50Seconds/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err239];
}
else {
vErrors.push(err239);
}
errors++;
}
}
else {
const err240 = {instancePath:instancePath+"/freshness/p50Seconds",schemaPath:"#/definitions/Latency/properties/p50Seconds/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err240];
}
else {
vErrors.push(err240);
}
errors++;
}
var _valid32 = _errs258 === errors;
valid49 = valid49 || _valid32;
if(!valid49){
const _errs260 = errors;
if(data59 !== null){
const err241 = {instancePath:instancePath+"/freshness/p50Seconds",schemaPath:"#/definitions/Latency/properties/p50Seconds/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err241];
}
else {
vErrors.push(err241);
}
errors++;
}
var _valid32 = _errs260 === errors;
valid49 = valid49 || _valid32;
}
if(!valid49){
const err242 = {instancePath:instancePath+"/freshness/p50Seconds",schemaPath:"#/definitions/Latency/properties/p50Seconds/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err242];
}
else {
vErrors.push(err242);
}
errors++;
}
else {
errors = _errs257;
if(vErrors !== null){
if(_errs257){
vErrors.length = _errs257;
}
else {
vErrors = null;
}
}
}
}
if(data56.p95Seconds !== undefined){
let data60 = data56.p95Seconds;
const _errs263 = errors;
let valid50 = false;
const _errs264 = errors;
if((typeof data60 == "number") && (isFinite(data60))){
if(data60 < 0 || isNaN(data60)){
const err243 = {instancePath:instancePath+"/freshness/p95Seconds",schemaPath:"#/definitions/Latency/properties/p95Seconds/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err243];
}
else {
vErrors.push(err243);
}
errors++;
}
}
else {
const err244 = {instancePath:instancePath+"/freshness/p95Seconds",schemaPath:"#/definitions/Latency/properties/p95Seconds/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err244];
}
else {
vErrors.push(err244);
}
errors++;
}
var _valid33 = _errs264 === errors;
valid50 = valid50 || _valid33;
if(!valid50){
const _errs266 = errors;
if(data60 !== null){
const err245 = {instancePath:instancePath+"/freshness/p95Seconds",schemaPath:"#/definitions/Latency/properties/p95Seconds/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err245];
}
else {
vErrors.push(err245);
}
errors++;
}
var _valid33 = _errs266 === errors;
valid50 = valid50 || _valid33;
}
if(!valid50){
const err246 = {instancePath:instancePath+"/freshness/p95Seconds",schemaPath:"#/definitions/Latency/properties/p95Seconds/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err246];
}
else {
vErrors.push(err246);
}
errors++;
}
else {
errors = _errs263;
if(vErrors !== null){
if(_errs263){
vErrors.length = _errs263;
}
else {
vErrors = null;
}
}
}
}
if(data56.unavailableReason !== undefined){
let data61 = data56.unavailableReason;
const _errs269 = errors;
let valid51 = false;
const _errs270 = errors;
if(typeof data61 === "string"){
if(func2(data61) < 1){
const err247 = {instancePath:instancePath+"/freshness/unavailableReason",schemaPath:"#/definitions/Latency/properties/unavailableReason/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err247];
}
else {
vErrors.push(err247);
}
errors++;
}
}
else {
const err248 = {instancePath:instancePath+"/freshness/unavailableReason",schemaPath:"#/definitions/Latency/properties/unavailableReason/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err248];
}
else {
vErrors.push(err248);
}
errors++;
}
var _valid34 = _errs270 === errors;
valid51 = valid51 || _valid34;
if(!valid51){
const _errs272 = errors;
if(data61 !== null){
const err249 = {instancePath:instancePath+"/freshness/unavailableReason",schemaPath:"#/definitions/Latency/properties/unavailableReason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err249];
}
else {
vErrors.push(err249);
}
errors++;
}
var _valid34 = _errs272 === errors;
valid51 = valid51 || _valid34;
}
if(!valid51){
const err250 = {instancePath:instancePath+"/freshness/unavailableReason",schemaPath:"#/definitions/Latency/properties/unavailableReason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err250];
}
else {
vErrors.push(err250);
}
errors++;
}
else {
errors = _errs269;
if(vErrors !== null){
if(_errs269){
vErrors.length = _errs269;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err251 = {instancePath:instancePath+"/freshness",schemaPath:"#/definitions/Latency/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err251];
}
else {
vErrors.push(err251);
}
errors++;
}
}
if(data.errors !== undefined){
if(!(validate23(data.errors, {instancePath:instancePath+"/errors",parentData:data,parentDataProperty:"errors",rootData}))){
vErrors = vErrors === null ? validate23.errors : vErrors.concat(validate23.errors);
errors = vErrors.length;
}
}
}
else {
const err252 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err252];
}
else {
vErrors.push(err252);
}
errors++;
}
validate20.errors = vErrors;
return errors === 0;
}


function validate19(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.instanceId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "instanceId"},message:"must have required property '"+"instanceId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.role === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "role"},message:"must have required property '"+"role"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.sampledAt === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sampledAt"},message:"must have required property '"+"sampledAt"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.segments === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "segments"},message:"must have required property '"+"segments"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.chunks === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "chunks"},message:"must have required property '"+"chunks"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.terms === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "terms"},message:"must have required property '"+"terms"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.indexedAvgdl === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "indexedAvgdl"},message:"must have required property '"+"indexedAvgdl"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.observedAvgdl === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "observedAvgdl"},message:"must have required property '"+"observedAvgdl"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.unavailableReason === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "unavailableReason"},message:"must have required property '"+"unavailableReason"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.instanceId !== undefined){
let data0 = data.instanceId;
if(typeof data0 === "string"){
if(func2(data0) < 1){
const err9 = {instancePath:instancePath+"/instanceId",schemaPath:"#/properties/instanceId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/instanceId",schemaPath:"#/properties/instanceId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.role !== undefined){
let data1 = data.role;
if(typeof data1 !== "string"){
const err11 = {instancePath:instancePath+"/role",schemaPath:"#/properties/role/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(!((data1 === "active") || (data1 === "building"))){
const err12 = {instancePath:instancePath+"/role",schemaPath:"#/properties/role/enum",keyword:"enum",params:{allowedValues: schema26.properties.role.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.sampledAt !== undefined){
let data2 = data.sampledAt;
if(typeof data2 === "string"){
if(!(formats0.validate(data2))){
const err13 = {instancePath:instancePath+"/sampledAt",schemaPath:"#/properties/sampledAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
else {
const err14 = {instancePath:instancePath+"/sampledAt",schemaPath:"#/properties/sampledAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.segments !== undefined){
let data3 = data.segments;
if(Array.isArray(data3)){
const len0 = data3.length;
for(let i0=0; i0<len0; i0++){
if(!(validate20(data3[i0], {instancePath:instancePath+"/segments/" + i0,parentData:data3,parentDataProperty:i0,rootData}))){
vErrors = vErrors === null ? validate20.errors : vErrors.concat(validate20.errors);
errors = vErrors.length;
}
}
}
else {
const err15 = {instancePath:instancePath+"/segments",schemaPath:"#/properties/segments/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.chunks !== undefined){
let data5 = data.chunks;
const _errs12 = errors;
let valid3 = false;
const _errs13 = errors;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err16 = {instancePath:instancePath+"/chunks",schemaPath:"#/properties/chunks/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 > 9007199254740991 || isNaN(data5)){
const err17 = {instancePath:instancePath+"/chunks",schemaPath:"#/properties/chunks/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(data5 < 0 || isNaN(data5)){
const err18 = {instancePath:instancePath+"/chunks",schemaPath:"#/properties/chunks/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
var _valid0 = _errs13 === errors;
valid3 = valid3 || _valid0;
if(!valid3){
const _errs15 = errors;
if(data5 !== null){
const err19 = {instancePath:instancePath+"/chunks",schemaPath:"#/properties/chunks/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
var _valid0 = _errs15 === errors;
valid3 = valid3 || _valid0;
}
if(!valid3){
const err20 = {instancePath:instancePath+"/chunks",schemaPath:"#/properties/chunks/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
else {
errors = _errs12;
if(vErrors !== null){
if(_errs12){
vErrors.length = _errs12;
}
else {
vErrors = null;
}
}
}
}
if(data.terms !== undefined){
let data6 = data.terms;
const _errs18 = errors;
let valid4 = false;
const _errs19 = errors;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err21 = {instancePath:instancePath+"/terms",schemaPath:"#/properties/terms/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 > 9007199254740991 || isNaN(data6)){
const err22 = {instancePath:instancePath+"/terms",schemaPath:"#/properties/terms/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(data6 < 0 || isNaN(data6)){
const err23 = {instancePath:instancePath+"/terms",schemaPath:"#/properties/terms/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
var _valid1 = _errs19 === errors;
valid4 = valid4 || _valid1;
if(!valid4){
const _errs21 = errors;
if(data6 !== null){
const err24 = {instancePath:instancePath+"/terms",schemaPath:"#/properties/terms/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
var _valid1 = _errs21 === errors;
valid4 = valid4 || _valid1;
}
if(!valid4){
const err25 = {instancePath:instancePath+"/terms",schemaPath:"#/properties/terms/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
else {
errors = _errs18;
if(vErrors !== null){
if(_errs18){
vErrors.length = _errs18;
}
else {
vErrors = null;
}
}
}
}
if(data.indexedAvgdl !== undefined){
let data7 = data.indexedAvgdl;
const _errs24 = errors;
let valid5 = false;
const _errs25 = errors;
if((typeof data7 == "number") && (isFinite(data7))){
if(data7 < 0 || isNaN(data7)){
const err26 = {instancePath:instancePath+"/indexedAvgdl",schemaPath:"#/properties/indexedAvgdl/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
else {
const err27 = {instancePath:instancePath+"/indexedAvgdl",schemaPath:"#/properties/indexedAvgdl/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
var _valid2 = _errs25 === errors;
valid5 = valid5 || _valid2;
if(!valid5){
const _errs27 = errors;
if(data7 !== null){
const err28 = {instancePath:instancePath+"/indexedAvgdl",schemaPath:"#/properties/indexedAvgdl/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
var _valid2 = _errs27 === errors;
valid5 = valid5 || _valid2;
}
if(!valid5){
const err29 = {instancePath:instancePath+"/indexedAvgdl",schemaPath:"#/properties/indexedAvgdl/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
else {
errors = _errs24;
if(vErrors !== null){
if(_errs24){
vErrors.length = _errs24;
}
else {
vErrors = null;
}
}
}
}
if(data.observedAvgdl !== undefined){
let data8 = data.observedAvgdl;
const _errs30 = errors;
let valid6 = false;
const _errs31 = errors;
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 < 0 || isNaN(data8)){
const err30 = {instancePath:instancePath+"/observedAvgdl",schemaPath:"#/properties/observedAvgdl/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
else {
const err31 = {instancePath:instancePath+"/observedAvgdl",schemaPath:"#/properties/observedAvgdl/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
var _valid3 = _errs31 === errors;
valid6 = valid6 || _valid3;
if(!valid6){
const _errs33 = errors;
if(data8 !== null){
const err32 = {instancePath:instancePath+"/observedAvgdl",schemaPath:"#/properties/observedAvgdl/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
var _valid3 = _errs33 === errors;
valid6 = valid6 || _valid3;
}
if(!valid6){
const err33 = {instancePath:instancePath+"/observedAvgdl",schemaPath:"#/properties/observedAvgdl/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
else {
errors = _errs30;
if(vErrors !== null){
if(_errs30){
vErrors.length = _errs30;
}
else {
vErrors = null;
}
}
}
}
if(data.unavailableReason !== undefined){
let data9 = data.unavailableReason;
const _errs36 = errors;
let valid7 = false;
const _errs37 = errors;
if(typeof data9 === "string"){
if(func2(data9) < 1){
const err34 = {instancePath:instancePath+"/unavailableReason",schemaPath:"#/properties/unavailableReason/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
else {
const err35 = {instancePath:instancePath+"/unavailableReason",schemaPath:"#/properties/unavailableReason/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
var _valid4 = _errs37 === errors;
valid7 = valid7 || _valid4;
if(!valid7){
const _errs39 = errors;
if(data9 !== null){
const err36 = {instancePath:instancePath+"/unavailableReason",schemaPath:"#/properties/unavailableReason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
var _valid4 = _errs39 === errors;
valid7 = valid7 || _valid4;
}
if(!valid7){
const err37 = {instancePath:instancePath+"/unavailableReason",schemaPath:"#/properties/unavailableReason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
else {
errors = _errs36;
if(vErrors !== null){
if(_errs36){
vErrors.length = _errs36;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err38 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
validate19.errors = vErrors;
return errors === 0;
}

const pattern0 = new RegExp("^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)", "u");

function validate12(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-status-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.sampledAt === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sampledAt"},message:"must have required property '"+"sampledAt"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.sessionId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sessionId"},message:"must have required property '"+"sessionId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.uptimeSeconds === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "uptimeSeconds"},message:"must have required property '"+"uptimeSeconds"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.state === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.effectiveConfiguration === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "effectiveConfiguration"},message:"must have required property '"+"effectiveConfiguration"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.resources === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "resources"},message:"must have required property '"+"resources"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.generations === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "generations"},message:"must have required property '"+"generations"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.discovery === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "discovery"},message:"must have required property '"+"discovery"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.search === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "search"},message:"must have required property '"+"search"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.sampledAt !== undefined){
let data0 = data.sampledAt;
if(typeof data0 === "string"){
if(!(formats0.validate(data0))){
const err9 = {instancePath:instancePath+"/sampledAt",schemaPath:"#/properties/sampledAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/sampledAt",schemaPath:"#/properties/sampledAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.sessionId !== undefined){
let data1 = data.sessionId;
if(typeof data1 === "string"){
if(func2(data1) < 1){
const err11 = {instancePath:instancePath+"/sessionId",schemaPath:"#/properties/sessionId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/sessionId",schemaPath:"#/properties/sessionId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.uptimeSeconds !== undefined){
let data2 = data.uptimeSeconds;
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err13 = {instancePath:instancePath+"/uptimeSeconds",schemaPath:"#/properties/uptimeSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
else {
const err14 = {instancePath:instancePath+"/uptimeSeconds",schemaPath:"#/properties/uptimeSeconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.state !== undefined){
let data3 = data.state;
if(typeof data3 !== "string"){
const err15 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(!((((data3 === "running") || (data3 === "stopping")) || (data3 === "stopped")) || (data3 === "blocked"))){
const err16 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/enum",keyword:"enum",params:{allowedValues: schema13.properties.state.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.effectiveConfiguration !== undefined){
let data4 = data.effectiveConfiguration;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.parallelism === undefined){
const err17 = {instancePath:instancePath+"/effectiveConfiguration",schemaPath:"#/definitions/EffectiveIndexingConfiguration/required",keyword:"required",params:{missingProperty: "parallelism"},message:"must have required property '"+"parallelism"+"'"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(data4.documentsPerMinute === undefined){
const err18 = {instancePath:instancePath+"/effectiveConfiguration",schemaPath:"#/definitions/EffectiveIndexingConfiguration/required",keyword:"required",params:{missingProperty: "documentsPerMinute"},message:"must have required property '"+"documentsPerMinute"+"'"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data4.parallelism !== undefined){
let data5 = data4.parallelism;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err19 = {instancePath:instancePath+"/effectiveConfiguration/parallelism",schemaPath:"#/definitions/EffectiveIndexingConfiguration/properties/parallelism/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 > 9007199254740991 || isNaN(data5)){
const err20 = {instancePath:instancePath+"/effectiveConfiguration/parallelism",schemaPath:"#/definitions/EffectiveIndexingConfiguration/properties/parallelism/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(data5 < 1 || isNaN(data5)){
const err21 = {instancePath:instancePath+"/effectiveConfiguration/parallelism",schemaPath:"#/definitions/EffectiveIndexingConfiguration/properties/parallelism/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
if(data4.documentsPerMinute !== undefined){
let data6 = data4.documentsPerMinute;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err22 = {instancePath:instancePath+"/effectiveConfiguration/documentsPerMinute",schemaPath:"#/definitions/EffectiveIndexingConfiguration/properties/documentsPerMinute/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 > 9007199254740991 || isNaN(data6)){
const err23 = {instancePath:instancePath+"/effectiveConfiguration/documentsPerMinute",schemaPath:"#/definitions/EffectiveIndexingConfiguration/properties/documentsPerMinute/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data6 < 1 || isNaN(data6)){
const err24 = {instancePath:instancePath+"/effectiveConfiguration/documentsPerMinute",schemaPath:"#/definitions/EffectiveIndexingConfiguration/properties/documentsPerMinute/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
}
else {
const err25 = {instancePath:instancePath+"/effectiveConfiguration",schemaPath:"#/definitions/EffectiveIndexingConfiguration/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.resources !== undefined){
if(!(validate13(data.resources, {instancePath:instancePath+"/resources",parentData:data,parentDataProperty:"resources",rootData}))){
vErrors = vErrors === null ? validate13.errors : vErrors.concat(validate13.errors);
errors = vErrors.length;
}
}
if(data.generations !== undefined){
let data8 = data.generations;
if(Array.isArray(data8)){
const len0 = data8.length;
for(let i0=0; i0<len0; i0++){
if(!(validate19(data8[i0], {instancePath:instancePath+"/generations/" + i0,parentData:data8,parentDataProperty:i0,rootData}))){
vErrors = vErrors === null ? validate19.errors : vErrors.concat(validate19.errors);
errors = vErrors.length;
}
}
}
else {
const err26 = {instancePath:instancePath+"/generations",schemaPath:"#/properties/generations/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data.discovery !== undefined){
let data10 = data.discovery;
if(Array.isArray(data10)){
const len1 = data10.length;
for(let i1=0; i1<len1; i1++){
let data11 = data10[i1];
if(data11 && typeof data11 == "object" && !Array.isArray(data11)){
if(data11.sourceId === undefined){
const err27 = {instancePath:instancePath+"/discovery/" + i1,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "sourceId"},message:"must have required property '"+"sourceId"+"'"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(data11.mailboxId === undefined){
const err28 = {instancePath:instancePath+"/discovery/" + i1,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "mailboxId"},message:"must have required property '"+"mailboxId"+"'"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(data11.state === undefined){
const err29 = {instancePath:instancePath+"/discovery/" + i1,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(data11.discoveryComplete === undefined){
const err30 = {instancePath:instancePath+"/discovery/" + i1,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "discoveryComplete"},message:"must have required property '"+"discoveryComplete"+"'"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(data11.scanStartedAt === undefined){
const err31 = {instancePath:instancePath+"/discovery/" + i1,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "scanStartedAt"},message:"must have required property '"+"scanStartedAt"+"'"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(data11.lastSuccessfulScanAt === undefined){
const err32 = {instancePath:instancePath+"/discovery/" + i1,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "lastSuccessfulScanAt"},message:"must have required property '"+"lastSuccessfulScanAt"+"'"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(data11.discoveredDocuments === undefined){
const err33 = {instancePath:instancePath+"/discovery/" + i1,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "discoveredDocuments"},message:"must have required property '"+"discoveredDocuments"+"'"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(data11.accessible === undefined){
const err34 = {instancePath:instancePath+"/discovery/" + i1,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "accessible"},message:"must have required property '"+"accessible"+"'"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(data11.lastErrorCode === undefined){
const err35 = {instancePath:instancePath+"/discovery/" + i1,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "lastErrorCode"},message:"must have required property '"+"lastErrorCode"+"'"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(data11.sourceId !== undefined){
let data12 = data11.sourceId;
if(typeof data12 === "string"){
if(func2(data12) < 1){
const err36 = {instancePath:instancePath+"/discovery/" + i1+"/sourceId",schemaPath:"#/definitions/DiscoverySource/properties/sourceId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
else {
const err37 = {instancePath:instancePath+"/discovery/" + i1+"/sourceId",schemaPath:"#/definitions/DiscoverySource/properties/sourceId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data11.mailboxId !== undefined){
let data13 = data11.mailboxId;
const _errs31 = errors;
let valid9 = false;
const _errs32 = errors;
if(typeof data13 === "string"){
if(func2(data13) < 1){
const err38 = {instancePath:instancePath+"/discovery/" + i1+"/mailboxId",schemaPath:"#/definitions/DiscoverySource/properties/mailboxId/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
else {
const err39 = {instancePath:instancePath+"/discovery/" + i1+"/mailboxId",schemaPath:"#/definitions/DiscoverySource/properties/mailboxId/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
var _valid0 = _errs32 === errors;
valid9 = valid9 || _valid0;
if(!valid9){
const _errs34 = errors;
if(data13 !== null){
const err40 = {instancePath:instancePath+"/discovery/" + i1+"/mailboxId",schemaPath:"#/definitions/DiscoverySource/properties/mailboxId/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
var _valid0 = _errs34 === errors;
valid9 = valid9 || _valid0;
}
if(!valid9){
const err41 = {instancePath:instancePath+"/discovery/" + i1+"/mailboxId",schemaPath:"#/definitions/DiscoverySource/properties/mailboxId/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
else {
errors = _errs31;
if(vErrors !== null){
if(_errs31){
vErrors.length = _errs31;
}
else {
vErrors = null;
}
}
}
}
if(data11.state !== undefined){
let data14 = data11.state;
if(typeof data14 !== "string"){
const err42 = {instancePath:instancePath+"/discovery/" + i1+"/state",schemaPath:"#/definitions/DiscoverySource/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if(!(((((data14 === "notStarted") || (data14 === "scanning")) || (data14 === "complete")) || (data14 === "failed")) || (data14 === "disabled"))){
const err43 = {instancePath:instancePath+"/discovery/" + i1+"/state",schemaPath:"#/definitions/DiscoverySource/properties/state/enum",keyword:"enum",params:{allowedValues: schema38.properties.state.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
if(data11.discoveryComplete !== undefined){
if(typeof data11.discoveryComplete !== "boolean"){
const err44 = {instancePath:instancePath+"/discovery/" + i1+"/discoveryComplete",schemaPath:"#/definitions/DiscoverySource/properties/discoveryComplete/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
if(data11.scanStartedAt !== undefined){
let data16 = data11.scanStartedAt;
const _errs41 = errors;
let valid10 = false;
const _errs42 = errors;
if(typeof data16 === "string"){
if(!(formats0.validate(data16))){
const err45 = {instancePath:instancePath+"/discovery/" + i1+"/scanStartedAt",schemaPath:"#/definitions/DiscoverySource/properties/scanStartedAt/anyOf/0/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
else {
const err46 = {instancePath:instancePath+"/discovery/" + i1+"/scanStartedAt",schemaPath:"#/definitions/DiscoverySource/properties/scanStartedAt/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
var _valid1 = _errs42 === errors;
valid10 = valid10 || _valid1;
if(!valid10){
const _errs44 = errors;
if(data16 !== null){
const err47 = {instancePath:instancePath+"/discovery/" + i1+"/scanStartedAt",schemaPath:"#/definitions/DiscoverySource/properties/scanStartedAt/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
var _valid1 = _errs44 === errors;
valid10 = valid10 || _valid1;
}
if(!valid10){
const err48 = {instancePath:instancePath+"/discovery/" + i1+"/scanStartedAt",schemaPath:"#/definitions/DiscoverySource/properties/scanStartedAt/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
else {
errors = _errs41;
if(vErrors !== null){
if(_errs41){
vErrors.length = _errs41;
}
else {
vErrors = null;
}
}
}
}
if(data11.lastSuccessfulScanAt !== undefined){
let data17 = data11.lastSuccessfulScanAt;
const _errs47 = errors;
let valid11 = false;
const _errs48 = errors;
if(typeof data17 === "string"){
if(!(formats0.validate(data17))){
const err49 = {instancePath:instancePath+"/discovery/" + i1+"/lastSuccessfulScanAt",schemaPath:"#/definitions/DiscoverySource/properties/lastSuccessfulScanAt/anyOf/0/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
else {
const err50 = {instancePath:instancePath+"/discovery/" + i1+"/lastSuccessfulScanAt",schemaPath:"#/definitions/DiscoverySource/properties/lastSuccessfulScanAt/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
var _valid2 = _errs48 === errors;
valid11 = valid11 || _valid2;
if(!valid11){
const _errs50 = errors;
if(data17 !== null){
const err51 = {instancePath:instancePath+"/discovery/" + i1+"/lastSuccessfulScanAt",schemaPath:"#/definitions/DiscoverySource/properties/lastSuccessfulScanAt/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
var _valid2 = _errs50 === errors;
valid11 = valid11 || _valid2;
}
if(!valid11){
const err52 = {instancePath:instancePath+"/discovery/" + i1+"/lastSuccessfulScanAt",schemaPath:"#/definitions/DiscoverySource/properties/lastSuccessfulScanAt/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
else {
errors = _errs47;
if(vErrors !== null){
if(_errs47){
vErrors.length = _errs47;
}
else {
vErrors = null;
}
}
}
}
if(data11.discoveredDocuments !== undefined){
let data18 = data11.discoveredDocuments;
const _errs53 = errors;
let valid12 = false;
const _errs54 = errors;
if(!(((typeof data18 == "number") && (!(data18 % 1) && !isNaN(data18))) && (isFinite(data18)))){
const err53 = {instancePath:instancePath+"/discovery/" + i1+"/discoveredDocuments",schemaPath:"#/definitions/DiscoverySource/properties/discoveredDocuments/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
if((typeof data18 == "number") && (isFinite(data18))){
if(data18 > 9007199254740991 || isNaN(data18)){
const err54 = {instancePath:instancePath+"/discovery/" + i1+"/discoveredDocuments",schemaPath:"#/definitions/DiscoverySource/properties/discoveredDocuments/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
if(data18 < 0 || isNaN(data18)){
const err55 = {instancePath:instancePath+"/discovery/" + i1+"/discoveredDocuments",schemaPath:"#/definitions/DiscoverySource/properties/discoveredDocuments/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
var _valid3 = _errs54 === errors;
valid12 = valid12 || _valid3;
if(!valid12){
const _errs56 = errors;
if(data18 !== null){
const err56 = {instancePath:instancePath+"/discovery/" + i1+"/discoveredDocuments",schemaPath:"#/definitions/DiscoverySource/properties/discoveredDocuments/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
var _valid3 = _errs56 === errors;
valid12 = valid12 || _valid3;
}
if(!valid12){
const err57 = {instancePath:instancePath+"/discovery/" + i1+"/discoveredDocuments",schemaPath:"#/definitions/DiscoverySource/properties/discoveredDocuments/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
else {
errors = _errs53;
if(vErrors !== null){
if(_errs53){
vErrors.length = _errs53;
}
else {
vErrors = null;
}
}
}
}
if(data11.accessible !== undefined){
if(typeof data11.accessible !== "boolean"){
const err58 = {instancePath:instancePath+"/discovery/" + i1+"/accessible",schemaPath:"#/definitions/DiscoverySource/properties/accessible/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
}
if(data11.lastErrorCode !== undefined){
let data20 = data11.lastErrorCode;
const _errs61 = errors;
let valid13 = false;
const _errs62 = errors;
if(typeof data20 === "string"){
if(func2(data20) < 1){
const err59 = {instancePath:instancePath+"/discovery/" + i1+"/lastErrorCode",schemaPath:"#/definitions/DiscoverySource/properties/lastErrorCode/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
}
else {
const err60 = {instancePath:instancePath+"/discovery/" + i1+"/lastErrorCode",schemaPath:"#/definitions/DiscoverySource/properties/lastErrorCode/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
var _valid4 = _errs62 === errors;
valid13 = valid13 || _valid4;
if(!valid13){
const _errs64 = errors;
if(data20 !== null){
const err61 = {instancePath:instancePath+"/discovery/" + i1+"/lastErrorCode",schemaPath:"#/definitions/DiscoverySource/properties/lastErrorCode/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
var _valid4 = _errs64 === errors;
valid13 = valid13 || _valid4;
}
if(!valid13){
const err62 = {instancePath:instancePath+"/discovery/" + i1+"/lastErrorCode",schemaPath:"#/definitions/DiscoverySource/properties/lastErrorCode/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
else {
errors = _errs61;
if(vErrors !== null){
if(_errs61){
vErrors.length = _errs61;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err63 = {instancePath:instancePath+"/discovery/" + i1,schemaPath:"#/definitions/DiscoverySource/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
}
}
else {
const err64 = {instancePath:instancePath+"/discovery",schemaPath:"#/properties/discovery/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
}
if(data.search !== undefined){
let data21 = data.search;
if(data21 && typeof data21 == "object" && !Array.isArray(data21)){
if(data21.sampledAt === undefined){
const err65 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "sampledAt"},message:"must have required property '"+"sampledAt"+"'"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
if(data21.observationSeconds === undefined){
const err66 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "observationSeconds"},message:"must have required property '"+"observationSeconds"+"'"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
if(data21.queryCount === undefined){
const err67 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "queryCount"},message:"must have required property '"+"queryCount"+"'"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
if(data21.errorCount === undefined){
const err68 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "errorCount"},message:"must have required property '"+"errorCount"+"'"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
if(data21.inFlight === undefined){
const err69 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "inFlight"},message:"must have required property '"+"inFlight"+"'"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
if(data21.p50LatencyMilliseconds === undefined){
const err70 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "p50LatencyMilliseconds"},message:"must have required property '"+"p50LatencyMilliseconds"+"'"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
if(data21.p95LatencyMilliseconds === undefined){
const err71 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "p95LatencyMilliseconds"},message:"must have required property '"+"p95LatencyMilliseconds"+"'"};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
if(data21.unavailableReason === undefined){
const err72 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "unavailableReason"},message:"must have required property '"+"unavailableReason"+"'"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
}
if(data21.sampledAt !== undefined){
let data22 = data21.sampledAt;
if(typeof data22 === "string"){
if(!(formats0.validate(data22))){
const err73 = {instancePath:instancePath+"/search/sampledAt",schemaPath:"#/definitions/SearchStatistics/properties/sampledAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
}
else {
const err74 = {instancePath:instancePath+"/search/sampledAt",schemaPath:"#/definitions/SearchStatistics/properties/sampledAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
}
if(data21.observationSeconds !== undefined){
let data23 = data21.observationSeconds;
if((typeof data23 == "number") && (isFinite(data23))){
if(data23 < 0 || isNaN(data23)){
const err75 = {instancePath:instancePath+"/search/observationSeconds",schemaPath:"#/definitions/SearchStatistics/properties/observationSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
}
else {
const err76 = {instancePath:instancePath+"/search/observationSeconds",schemaPath:"#/definitions/SearchStatistics/properties/observationSeconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
}
if(data21.queryCount !== undefined){
let data24 = data21.queryCount;
if(!(((typeof data24 == "number") && (!(data24 % 1) && !isNaN(data24))) && (isFinite(data24)))){
const err77 = {instancePath:instancePath+"/search/queryCount",schemaPath:"#/definitions/SearchStatistics/properties/queryCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
}
if((typeof data24 == "number") && (isFinite(data24))){
if(data24 > 9007199254740991 || isNaN(data24)){
const err78 = {instancePath:instancePath+"/search/queryCount",schemaPath:"#/definitions/SearchStatistics/properties/queryCount/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
if(data24 < 0 || isNaN(data24)){
const err79 = {instancePath:instancePath+"/search/queryCount",schemaPath:"#/definitions/SearchStatistics/properties/queryCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err79];
}
else {
vErrors.push(err79);
}
errors++;
}
}
}
if(data21.errorCount !== undefined){
let data25 = data21.errorCount;
if(!(((typeof data25 == "number") && (!(data25 % 1) && !isNaN(data25))) && (isFinite(data25)))){
const err80 = {instancePath:instancePath+"/search/errorCount",schemaPath:"#/definitions/SearchStatistics/properties/errorCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err80];
}
else {
vErrors.push(err80);
}
errors++;
}
if((typeof data25 == "number") && (isFinite(data25))){
if(data25 > 9007199254740991 || isNaN(data25)){
const err81 = {instancePath:instancePath+"/search/errorCount",schemaPath:"#/definitions/SearchStatistics/properties/errorCount/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err81];
}
else {
vErrors.push(err81);
}
errors++;
}
if(data25 < 0 || isNaN(data25)){
const err82 = {instancePath:instancePath+"/search/errorCount",schemaPath:"#/definitions/SearchStatistics/properties/errorCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err82];
}
else {
vErrors.push(err82);
}
errors++;
}
}
}
if(data21.inFlight !== undefined){
let data26 = data21.inFlight;
if(!(((typeof data26 == "number") && (!(data26 % 1) && !isNaN(data26))) && (isFinite(data26)))){
const err83 = {instancePath:instancePath+"/search/inFlight",schemaPath:"#/definitions/SearchStatistics/properties/inFlight/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err83];
}
else {
vErrors.push(err83);
}
errors++;
}
if((typeof data26 == "number") && (isFinite(data26))){
if(data26 > 9007199254740991 || isNaN(data26)){
const err84 = {instancePath:instancePath+"/search/inFlight",schemaPath:"#/definitions/SearchStatistics/properties/inFlight/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err84];
}
else {
vErrors.push(err84);
}
errors++;
}
if(data26 < 0 || isNaN(data26)){
const err85 = {instancePath:instancePath+"/search/inFlight",schemaPath:"#/definitions/SearchStatistics/properties/inFlight/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err85];
}
else {
vErrors.push(err85);
}
errors++;
}
}
}
if(data21.p50LatencyMilliseconds !== undefined){
let data27 = data21.p50LatencyMilliseconds;
const _errs81 = errors;
let valid16 = false;
const _errs82 = errors;
if((typeof data27 == "number") && (isFinite(data27))){
if(data27 < 0 || isNaN(data27)){
const err86 = {instancePath:instancePath+"/search/p50LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p50LatencyMilliseconds/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err86];
}
else {
vErrors.push(err86);
}
errors++;
}
}
else {
const err87 = {instancePath:instancePath+"/search/p50LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p50LatencyMilliseconds/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err87];
}
else {
vErrors.push(err87);
}
errors++;
}
var _valid5 = _errs82 === errors;
valid16 = valid16 || _valid5;
if(!valid16){
const _errs84 = errors;
if(data27 !== null){
const err88 = {instancePath:instancePath+"/search/p50LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p50LatencyMilliseconds/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err88];
}
else {
vErrors.push(err88);
}
errors++;
}
var _valid5 = _errs84 === errors;
valid16 = valid16 || _valid5;
}
if(!valid16){
const err89 = {instancePath:instancePath+"/search/p50LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p50LatencyMilliseconds/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err89];
}
else {
vErrors.push(err89);
}
errors++;
}
else {
errors = _errs81;
if(vErrors !== null){
if(_errs81){
vErrors.length = _errs81;
}
else {
vErrors = null;
}
}
}
}
if(data21.p95LatencyMilliseconds !== undefined){
let data28 = data21.p95LatencyMilliseconds;
const _errs87 = errors;
let valid17 = false;
const _errs88 = errors;
if((typeof data28 == "number") && (isFinite(data28))){
if(data28 < 0 || isNaN(data28)){
const err90 = {instancePath:instancePath+"/search/p95LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p95LatencyMilliseconds/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err90];
}
else {
vErrors.push(err90);
}
errors++;
}
}
else {
const err91 = {instancePath:instancePath+"/search/p95LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p95LatencyMilliseconds/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err91];
}
else {
vErrors.push(err91);
}
errors++;
}
var _valid6 = _errs88 === errors;
valid17 = valid17 || _valid6;
if(!valid17){
const _errs90 = errors;
if(data28 !== null){
const err92 = {instancePath:instancePath+"/search/p95LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p95LatencyMilliseconds/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err92];
}
else {
vErrors.push(err92);
}
errors++;
}
var _valid6 = _errs90 === errors;
valid17 = valid17 || _valid6;
}
if(!valid17){
const err93 = {instancePath:instancePath+"/search/p95LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p95LatencyMilliseconds/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err93];
}
else {
vErrors.push(err93);
}
errors++;
}
else {
errors = _errs87;
if(vErrors !== null){
if(_errs87){
vErrors.length = _errs87;
}
else {
vErrors = null;
}
}
}
}
if(data21.unavailableReason !== undefined){
let data29 = data21.unavailableReason;
const _errs93 = errors;
let valid18 = false;
const _errs94 = errors;
if(typeof data29 === "string"){
if(func2(data29) < 1){
const err94 = {instancePath:instancePath+"/search/unavailableReason",schemaPath:"#/definitions/SearchStatistics/properties/unavailableReason/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err94];
}
else {
vErrors.push(err94);
}
errors++;
}
}
else {
const err95 = {instancePath:instancePath+"/search/unavailableReason",schemaPath:"#/definitions/SearchStatistics/properties/unavailableReason/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err95];
}
else {
vErrors.push(err95);
}
errors++;
}
var _valid7 = _errs94 === errors;
valid18 = valid18 || _valid7;
if(!valid18){
const _errs96 = errors;
if(data29 !== null){
const err96 = {instancePath:instancePath+"/search/unavailableReason",schemaPath:"#/definitions/SearchStatistics/properties/unavailableReason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err96];
}
else {
vErrors.push(err96);
}
errors++;
}
var _valid7 = _errs96 === errors;
valid18 = valid18 || _valid7;
}
if(!valid18){
const err97 = {instancePath:instancePath+"/search/unavailableReason",schemaPath:"#/definitions/SearchStatistics/properties/unavailableReason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err97];
}
else {
vErrors.push(err97);
}
errors++;
}
else {
errors = _errs93;
if(vErrors !== null){
if(_errs93){
vErrors.length = _errs93;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err98 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err98];
}
else {
vErrors.push(err98);
}
errors++;
}
}
if(data.resetInProgress !== undefined){
if(typeof data.resetInProgress !== "boolean"){
const err99 = {instancePath:instancePath+"/resetInProgress",schemaPath:"#/properties/resetInProgress/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err99];
}
else {
vErrors.push(err99);
}
errors++;
}
}
if(data.indexingDirectory !== undefined){
let data31 = data.indexingDirectory;
if(typeof data31 === "string"){
if(func2(data31) < 1){
const err100 = {instancePath:instancePath+"/indexingDirectory",schemaPath:"#/properties/indexingDirectory/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err100];
}
else {
vErrors.push(err100);
}
errors++;
}
if(!pattern0.test(data31)){
const err101 = {instancePath:instancePath+"/indexingDirectory",schemaPath:"#/properties/indexingDirectory/pattern",keyword:"pattern",params:{pattern: "^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)"},message:"must match pattern \""+"^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)"+"\""};
if(vErrors === null){
vErrors = [err101];
}
else {
vErrors.push(err101);
}
errors++;
}
}
else {
const err102 = {instancePath:instancePath+"/indexingDirectory",schemaPath:"#/properties/indexingDirectory/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err102];
}
else {
vErrors.push(err102);
}
errors++;
}
}
}
else {
const err103 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err103];
}
else {
vErrors.push(err103);
}
errors++;
}
validate12.errors = vErrors;
return errors === 0;
}

export const validateIndexingStatusV1Params = validate27;
const schema40 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-status-v1-params.schema.json","title":"IndexingStatusV1Params","type":"object","properties":{"includeSourceBreakdowns":{"type":"boolean","default":true},"includeFileTypeBreakdowns":{"type":"boolean","default":true}},"required":[],"additionalProperties":true};

function validate27(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-status-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.includeSourceBreakdowns !== undefined){
if(typeof data.includeSourceBreakdowns !== "boolean"){
const err0 = {instancePath:instancePath+"/includeSourceBreakdowns",schemaPath:"#/properties/includeSourceBreakdowns/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
if(data.includeFileTypeBreakdowns !== undefined){
if(typeof data.includeFileTypeBreakdowns !== "boolean"){
const err1 = {instancePath:instancePath+"/includeFileTypeBreakdowns",schemaPath:"#/properties/includeFileTypeBreakdowns/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
}
else {
const err2 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
validate27.errors = vErrors;
return errors === 0;
}

export const validateJsonRpcEnvelope = validate28;
const schema41 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/json-rpc-envelope.schema.json","title":"JsonRpcEnvelope","oneOf":[{"$ref":"#/definitions/Request"},{"$ref":"#/definitions/Notification"},{"$ref":"#/definitions/SuccessResponse"},{"$ref":"#/definitions/ErrorResponse"}],"definitions":{"Request":{"type":"object","required":["jsonrpc","method","id"],"properties":{"jsonrpc":{"const":"2.0"},"method":{"type":"string","minLength":1},"params":{"oneOf":[{"type":"object"},{"type":"array"}]},"id":{"$ref":"../common.schema.json#/definitions/RequestId"},"x-erato-deadline-at":{"type":"string","format":"date-time"}},"additionalProperties":true},"Notification":{"type":"object","required":["jsonrpc","method"],"not":{"required":["id"],"properties":{"id":true}},"properties":{"jsonrpc":{"const":"2.0"},"method":{"type":"string","minLength":1},"params":{"oneOf":[{"type":"object"},{"type":"array"}]}},"additionalProperties":true},"SuccessResponse":{"type":"object","required":["jsonrpc","result","id"],"not":{"required":["error"],"properties":{"error":true}},"properties":{"jsonrpc":{"const":"2.0"},"result":true,"id":{"$ref":"../common.schema.json#/definitions/RequestId"}},"additionalProperties":true},"ErrorResponse":{"type":"object","required":["jsonrpc","error","id"],"not":{"required":["result"],"properties":{"result":true}},"properties":{"jsonrpc":{"const":"2.0"},"error":{"type":"object","required":["code","message"],"properties":{"code":{"type":"integer"},"message":{"type":"string"},"data":true},"additionalProperties":true},"id":{"oneOf":[{"$ref":"../common.schema.json#/definitions/RequestId"},{"type":"null"}]}},"additionalProperties":true}}};
const schema45 = {"type":"object","required":["jsonrpc","method"],"not":{"required":["id"],"properties":{"id":true}},"properties":{"jsonrpc":{"const":"2.0"},"method":{"type":"string","minLength":1},"params":{"oneOf":[{"type":"object"},{"type":"array"}]}},"additionalProperties":true};
const schema42 = {"type":"object","required":["jsonrpc","method","id"],"properties":{"jsonrpc":{"const":"2.0"},"method":{"type":"string","minLength":1},"params":{"oneOf":[{"type":"object"},{"type":"array"}]},"id":{"$ref":"../common.schema.json#/definitions/RequestId"},"x-erato-deadline-at":{"type":"string","format":"date-time"}},"additionalProperties":true};
const schema44 = {"oneOf":[{"type":"string","minLength":1,"maxLength":128},{"type":"integer"}]};

function validate29(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.jsonrpc === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "jsonrpc"},message:"must have required property '"+"jsonrpc"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.method === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "method"},message:"must have required property '"+"method"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.id === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.jsonrpc !== undefined){
if("2.0" !== data.jsonrpc){
const err3 = {instancePath:instancePath+"/jsonrpc",schemaPath:"#/properties/jsonrpc/const",keyword:"const",params:{allowedValue: "2.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.method !== undefined){
let data1 = data.method;
if(typeof data1 === "string"){
if(func2(data1) < 1){
const err4 = {instancePath:instancePath+"/method",schemaPath:"#/properties/method/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/method",schemaPath:"#/properties/method/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.params !== undefined){
let data2 = data.params;
const _errs6 = errors;
let valid1 = false;
let passing0 = null;
const _errs7 = errors;
if(!(data2 && typeof data2 == "object" && !Array.isArray(data2))){
const err6 = {instancePath:instancePath+"/params",schemaPath:"#/properties/params/oneOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
var _valid0 = _errs7 === errors;
if(_valid0){
valid1 = true;
passing0 = 0;
}
const _errs9 = errors;
if(!(Array.isArray(data2))){
const err7 = {instancePath:instancePath+"/params",schemaPath:"#/properties/params/oneOf/1/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
var _valid0 = _errs9 === errors;
if(_valid0 && valid1){
valid1 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid1 = true;
passing0 = 1;
}
}
if(!valid1){
const err8 = {instancePath:instancePath+"/params",schemaPath:"#/properties/params/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
else {
errors = _errs6;
if(vErrors !== null){
if(_errs6){
vErrors.length = _errs6;
}
else {
vErrors = null;
}
}
}
}
if(data.id !== undefined){
let data3 = data.id;
const _errs13 = errors;
let valid3 = false;
let passing1 = null;
const _errs14 = errors;
if(typeof data3 === "string"){
if(func2(data3) > 128){
const err9 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(func2(data3) < 1){
const err10 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
var _valid1 = _errs14 === errors;
if(_valid1){
valid3 = true;
passing1 = 0;
}
const _errs16 = errors;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err12 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/1/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
var _valid1 = _errs16 === errors;
if(_valid1 && valid3){
valid3 = false;
passing1 = [passing1, 1];
}
else {
if(_valid1){
valid3 = true;
passing1 = 1;
}
}
if(!valid3){
const err13 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
else {
errors = _errs13;
if(vErrors !== null){
if(_errs13){
vErrors.length = _errs13;
}
else {
vErrors = null;
}
}
}
}
if(data["x-erato-deadline-at"] !== undefined){
let data4 = data["x-erato-deadline-at"];
if(typeof data4 === "string"){
if(!(formats0.validate(data4))){
const err14 = {instancePath:instancePath+"/x-erato-deadline-at",schemaPath:"#/properties/x-erato-deadline-at/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/x-erato-deadline-at",schemaPath:"#/properties/x-erato-deadline-at/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
validate29.errors = vErrors;
return errors === 0;
}

const schema46 = {"type":"object","required":["jsonrpc","result","id"],"not":{"required":["error"],"properties":{"error":true}},"properties":{"jsonrpc":{"const":"2.0"},"result":true,"id":{"$ref":"../common.schema.json#/definitions/RequestId"}},"additionalProperties":true};

function validate32(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
const _errs1 = errors;
const _errs2 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((data.error === undefined) && (missing0 = "error")){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
var valid0 = _errs2 === errors;
if(valid0){
const err1 = {instancePath,schemaPath:"#/not",keyword:"not",params:{},message:"must NOT be valid"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
else {
errors = _errs1;
if(vErrors !== null){
if(_errs1){
vErrors.length = _errs1;
}
else {
vErrors = null;
}
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.jsonrpc === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "jsonrpc"},message:"must have required property '"+"jsonrpc"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.result === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "result"},message:"must have required property '"+"result"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.id === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.jsonrpc !== undefined){
if("2.0" !== data.jsonrpc){
const err5 = {instancePath:instancePath+"/jsonrpc",schemaPath:"#/properties/jsonrpc/const",keyword:"const",params:{allowedValue: "2.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.id !== undefined){
let data1 = data.id;
const _errs7 = errors;
let valid3 = false;
let passing0 = null;
const _errs8 = errors;
if(typeof data1 === "string"){
if(func2(data1) > 128){
const err6 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(func2(data1) < 1){
const err7 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
var _valid0 = _errs8 === errors;
if(_valid0){
valid3 = true;
passing0 = 0;
}
const _errs10 = errors;
if(!(((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1))) && (isFinite(data1)))){
const err9 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/1/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
var _valid0 = _errs10 === errors;
if(_valid0 && valid3){
valid3 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid3 = true;
passing0 = 1;
}
}
if(!valid3){
const err10 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
else {
errors = _errs7;
if(vErrors !== null){
if(_errs7){
vErrors.length = _errs7;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err11 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
validate32.errors = vErrors;
return errors === 0;
}

const schema48 = {"type":"object","required":["jsonrpc","error","id"],"not":{"required":["result"],"properties":{"result":true}},"properties":{"jsonrpc":{"const":"2.0"},"error":{"type":"object","required":["code","message"],"properties":{"code":{"type":"integer"},"message":{"type":"string"},"data":true},"additionalProperties":true},"id":{"oneOf":[{"$ref":"../common.schema.json#/definitions/RequestId"},{"type":"null"}]}},"additionalProperties":true};

function validate34(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
const _errs1 = errors;
const _errs2 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((data.result === undefined) && (missing0 = "result")){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
var valid0 = _errs2 === errors;
if(valid0){
const err1 = {instancePath,schemaPath:"#/not",keyword:"not",params:{},message:"must NOT be valid"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
else {
errors = _errs1;
if(vErrors !== null){
if(_errs1){
vErrors.length = _errs1;
}
else {
vErrors = null;
}
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.jsonrpc === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "jsonrpc"},message:"must have required property '"+"jsonrpc"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.error === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "error"},message:"must have required property '"+"error"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.id === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.jsonrpc !== undefined){
if("2.0" !== data.jsonrpc){
const err5 = {instancePath:instancePath+"/jsonrpc",schemaPath:"#/properties/jsonrpc/const",keyword:"const",params:{allowedValue: "2.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.error !== undefined){
let data1 = data.error;
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.code === undefined){
const err6 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.message === undefined){
const err7 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/required",keyword:"required",params:{missingProperty: "message"},message:"must have required property '"+"message"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.code !== undefined){
let data2 = data1.code;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err8 = {instancePath:instancePath+"/error/code",schemaPath:"#/properties/error/properties/code/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data1.message !== undefined){
if(typeof data1.message !== "string"){
const err9 = {instancePath:instancePath+"/error/message",schemaPath:"#/properties/error/properties/message/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
else {
const err10 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.id !== undefined){
let data4 = data.id;
const _errs13 = errors;
let valid3 = false;
let passing0 = null;
const _errs14 = errors;
const _errs16 = errors;
let valid5 = false;
let passing1 = null;
const _errs17 = errors;
if(typeof data4 === "string"){
if(func2(data4) > 128){
const err11 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(func2(data4) < 1){
const err12 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
var _valid1 = _errs17 === errors;
if(_valid1){
valid5 = true;
passing1 = 0;
}
const _errs19 = errors;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err14 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/1/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
var _valid1 = _errs19 === errors;
if(_valid1 && valid5){
valid5 = false;
passing1 = [passing1, 1];
}
else {
if(_valid1){
valid5 = true;
passing1 = 1;
}
}
if(!valid5){
const err15 = {instancePath:instancePath+"/id",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
else {
errors = _errs16;
if(vErrors !== null){
if(_errs16){
vErrors.length = _errs16;
}
else {
vErrors = null;
}
}
}
var _valid0 = _errs14 === errors;
if(_valid0){
valid3 = true;
passing0 = 0;
}
const _errs21 = errors;
if(data4 !== null){
const err16 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/oneOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
var _valid0 = _errs21 === errors;
if(_valid0 && valid3){
valid3 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid3 = true;
passing0 = 1;
}
}
if(!valid3){
const err17 = {instancePath:instancePath+"/id",schemaPath:"#/properties/id/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
else {
errors = _errs13;
if(vErrors !== null){
if(_errs13){
vErrors.length = _errs13;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err18 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
validate34.errors = vErrors;
return errors === 0;
}


function validate28(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/json-rpc-envelope.schema.json" */;
let vErrors = null;
let errors = 0;
const _errs0 = errors;
let valid0 = false;
let passing0 = null;
const _errs1 = errors;
if(!(validate29(data, {instancePath,parentData,parentDataProperty,rootData}))){
vErrors = vErrors === null ? validate29.errors : vErrors.concat(validate29.errors);
errors = vErrors.length;
}
var _valid0 = _errs1 === errors;
if(_valid0){
valid0 = true;
passing0 = 0;
}
const _errs2 = errors;
const _errs5 = errors;
const _errs6 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
let missing0;
if((data.id === undefined) && (missing0 = "id")){
const err0 = {};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
var valid2 = _errs6 === errors;
if(valid2){
const err1 = {instancePath,schemaPath:"#/definitions/Notification/not",keyword:"not",params:{},message:"must NOT be valid"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
else {
errors = _errs5;
if(vErrors !== null){
if(_errs5){
vErrors.length = _errs5;
}
else {
vErrors = null;
}
}
}
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.jsonrpc === undefined){
const err2 = {instancePath,schemaPath:"#/definitions/Notification/required",keyword:"required",params:{missingProperty: "jsonrpc"},message:"must have required property '"+"jsonrpc"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.method === undefined){
const err3 = {instancePath,schemaPath:"#/definitions/Notification/required",keyword:"required",params:{missingProperty: "method"},message:"must have required property '"+"method"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.jsonrpc !== undefined){
if("2.0" !== data.jsonrpc){
const err4 = {instancePath:instancePath+"/jsonrpc",schemaPath:"#/definitions/Notification/properties/jsonrpc/const",keyword:"const",params:{allowedValue: "2.0"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.method !== undefined){
let data1 = data.method;
if(typeof data1 === "string"){
if(func2(data1) < 1){
const err5 = {instancePath:instancePath+"/method",schemaPath:"#/definitions/Notification/properties/method/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/method",schemaPath:"#/definitions/Notification/properties/method/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.params !== undefined){
let data2 = data.params;
const _errs12 = errors;
let valid4 = false;
let passing1 = null;
const _errs13 = errors;
if(!(data2 && typeof data2 == "object" && !Array.isArray(data2))){
const err7 = {instancePath:instancePath+"/params",schemaPath:"#/definitions/Notification/properties/params/oneOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
var _valid1 = _errs13 === errors;
if(_valid1){
valid4 = true;
passing1 = 0;
}
const _errs15 = errors;
if(!(Array.isArray(data2))){
const err8 = {instancePath:instancePath+"/params",schemaPath:"#/definitions/Notification/properties/params/oneOf/1/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
var _valid1 = _errs15 === errors;
if(_valid1 && valid4){
valid4 = false;
passing1 = [passing1, 1];
}
else {
if(_valid1){
valid4 = true;
passing1 = 1;
}
}
if(!valid4){
const err9 = {instancePath:instancePath+"/params",schemaPath:"#/definitions/Notification/properties/params/oneOf",keyword:"oneOf",params:{passingSchemas: passing1},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
else {
errors = _errs12;
if(vErrors !== null){
if(_errs12){
vErrors.length = _errs12;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err10 = {instancePath,schemaPath:"#/definitions/Notification/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
var _valid0 = _errs2 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid0 = true;
passing0 = 1;
}
const _errs17 = errors;
if(!(validate32(data, {instancePath,parentData,parentDataProperty,rootData}))){
vErrors = vErrors === null ? validate32.errors : vErrors.concat(validate32.errors);
errors = vErrors.length;
}
var _valid0 = _errs17 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 2];
}
else {
if(_valid0){
valid0 = true;
passing0 = 2;
}
const _errs18 = errors;
if(!(validate34(data, {instancePath,parentData,parentDataProperty,rootData}))){
vErrors = vErrors === null ? validate34.errors : vErrors.concat(validate34.errors);
errors = vErrors.length;
}
var _valid0 = _errs18 === errors;
if(_valid0 && valid0){
valid0 = false;
passing0 = [passing0, 3];
}
else {
if(_valid0){
valid0 = true;
passing0 = 3;
}
}
}
}
if(!valid0){
const err11 = {instancePath,schemaPath:"#/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
else {
errors = _errs0;
if(vErrors !== null){
if(_errs0){
vErrors.length = _errs0;
}
else {
vErrors = null;
}
}
}
validate28.errors = vErrors;
return errors === 0;
}

export const validateDiscoverParams = validate36;
const schema50 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discover-params.schema.json","title":"DiscoverParams","type":"object","required":["protocolVersions","clientInfo","host","os"],"properties":{"protocolVersions":{"type":"array","minItems":1,"uniqueItems":true,"items":{"$ref":"../common.schema.json#/definitions/ProtocolVersion"}},"clientInfo":{"$ref":"../common.schema.json#/definitions/ProductInfo"},"host":{"type":"object","required":["application","runtime"],"properties":{"application":{"type":"string","minLength":1,"maxLength":128},"applicationVersion":{"type":"string","maxLength":128},"runtime":{"type":"string","minLength":1,"maxLength":128},"runtimeVersion":{"type":"string","maxLength":128}},"additionalProperties":true},"os":{"type":"object","required":["name"],"properties":{"name":{"type":"string","minLength":1,"maxLength":128},"version":{"type":"string","maxLength":128},"architecture":{"type":"string","maxLength":64}},"additionalProperties":true}},"additionalProperties":true};
const schema51 = {"type":"string","pattern":"^[1-9][0-9]*\\.[0-9]+$"};
const schema52 = {"type":"object","required":["name","version"],"properties":{"name":{"type":"string","minLength":1,"maxLength":128},"version":{"type":"string","minLength":1,"maxLength":128}},"additionalProperties":true};
const pattern1 = new RegExp("^[1-9][0-9]*\\.[0-9]+$", "u");
const func0 = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function validate36(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discover-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.protocolVersions === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "protocolVersions"},message:"must have required property '"+"protocolVersions"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.clientInfo === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "clientInfo"},message:"must have required property '"+"clientInfo"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.host === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "host"},message:"must have required property '"+"host"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.os === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "os"},message:"must have required property '"+"os"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.protocolVersions !== undefined){
let data0 = data.protocolVersions;
if(Array.isArray(data0)){
if(data0.length < 1){
const err4 = {instancePath:instancePath+"/protocolVersions",schemaPath:"#/properties/protocolVersions/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(typeof data1 === "string"){
if(!pattern1.test(data1)){
const err5 = {instancePath:instancePath+"/protocolVersions/" + i0,schemaPath:"../common.schema.json#/definitions/ProtocolVersion/pattern",keyword:"pattern",params:{pattern: "^[1-9][0-9]*\\.[0-9]+$"},message:"must match pattern \""+"^[1-9][0-9]*\\.[0-9]+$"+"\""};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/protocolVersions/" + i0,schemaPath:"../common.schema.json#/definitions/ProtocolVersion/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
let i1 = data0.length;
let j0;
if(i1 > 1){
outer0:
for(;i1--;){
for(j0 = i1; j0--;){
if(func0(data0[i1], data0[j0])){
const err7 = {instancePath:instancePath+"/protocolVersions",schemaPath:"#/properties/protocolVersions/uniqueItems",keyword:"uniqueItems",params:{i: i1, j: j0},message:"must NOT have duplicate items (items ## "+j0+" and "+i1+" are identical)"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
break outer0;
}
}
}
}
}
else {
const err8 = {instancePath:instancePath+"/protocolVersions",schemaPath:"#/properties/protocolVersions/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.clientInfo !== undefined){
let data2 = data.clientInfo;
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(data2.name === undefined){
const err9 = {instancePath:instancePath+"/clientInfo",schemaPath:"../common.schema.json#/definitions/ProductInfo/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data2.version === undefined){
const err10 = {instancePath:instancePath+"/clientInfo",schemaPath:"../common.schema.json#/definitions/ProductInfo/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data2.name !== undefined){
let data3 = data2.name;
if(typeof data3 === "string"){
if(func2(data3) > 128){
const err11 = {instancePath:instancePath+"/clientInfo/name",schemaPath:"../common.schema.json#/definitions/ProductInfo/properties/name/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(func2(data3) < 1){
const err12 = {instancePath:instancePath+"/clientInfo/name",schemaPath:"../common.schema.json#/definitions/ProductInfo/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/clientInfo/name",schemaPath:"../common.schema.json#/definitions/ProductInfo/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data2.version !== undefined){
let data4 = data2.version;
if(typeof data4 === "string"){
if(func2(data4) > 128){
const err14 = {instancePath:instancePath+"/clientInfo/version",schemaPath:"../common.schema.json#/definitions/ProductInfo/properties/version/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(func2(data4) < 1){
const err15 = {instancePath:instancePath+"/clientInfo/version",schemaPath:"../common.schema.json#/definitions/ProductInfo/properties/version/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/clientInfo/version",schemaPath:"../common.schema.json#/definitions/ProductInfo/properties/version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
else {
const err17 = {instancePath:instancePath+"/clientInfo",schemaPath:"../common.schema.json#/definitions/ProductInfo/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.host !== undefined){
let data5 = data.host;
if(data5 && typeof data5 == "object" && !Array.isArray(data5)){
if(data5.application === undefined){
const err18 = {instancePath:instancePath+"/host",schemaPath:"#/properties/host/required",keyword:"required",params:{missingProperty: "application"},message:"must have required property '"+"application"+"'"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data5.runtime === undefined){
const err19 = {instancePath:instancePath+"/host",schemaPath:"#/properties/host/required",keyword:"required",params:{missingProperty: "runtime"},message:"must have required property '"+"runtime"+"'"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data5.application !== undefined){
let data6 = data5.application;
if(typeof data6 === "string"){
if(func2(data6) > 128){
const err20 = {instancePath:instancePath+"/host/application",schemaPath:"#/properties/host/properties/application/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(func2(data6) < 1){
const err21 = {instancePath:instancePath+"/host/application",schemaPath:"#/properties/host/properties/application/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
else {
const err22 = {instancePath:instancePath+"/host/application",schemaPath:"#/properties/host/properties/application/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data5.applicationVersion !== undefined){
let data7 = data5.applicationVersion;
if(typeof data7 === "string"){
if(func2(data7) > 128){
const err23 = {instancePath:instancePath+"/host/applicationVersion",schemaPath:"#/properties/host/properties/applicationVersion/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
else {
const err24 = {instancePath:instancePath+"/host/applicationVersion",schemaPath:"#/properties/host/properties/applicationVersion/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data5.runtime !== undefined){
let data8 = data5.runtime;
if(typeof data8 === "string"){
if(func2(data8) > 128){
const err25 = {instancePath:instancePath+"/host/runtime",schemaPath:"#/properties/host/properties/runtime/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(func2(data8) < 1){
const err26 = {instancePath:instancePath+"/host/runtime",schemaPath:"#/properties/host/properties/runtime/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
else {
const err27 = {instancePath:instancePath+"/host/runtime",schemaPath:"#/properties/host/properties/runtime/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data5.runtimeVersion !== undefined){
let data9 = data5.runtimeVersion;
if(typeof data9 === "string"){
if(func2(data9) > 128){
const err28 = {instancePath:instancePath+"/host/runtimeVersion",schemaPath:"#/properties/host/properties/runtimeVersion/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
else {
const err29 = {instancePath:instancePath+"/host/runtimeVersion",schemaPath:"#/properties/host/properties/runtimeVersion/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
}
else {
const err30 = {instancePath:instancePath+"/host",schemaPath:"#/properties/host/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.os !== undefined){
let data10 = data.os;
if(data10 && typeof data10 == "object" && !Array.isArray(data10)){
if(data10.name === undefined){
const err31 = {instancePath:instancePath+"/os",schemaPath:"#/properties/os/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(data10.name !== undefined){
let data11 = data10.name;
if(typeof data11 === "string"){
if(func2(data11) > 128){
const err32 = {instancePath:instancePath+"/os/name",schemaPath:"#/properties/os/properties/name/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(func2(data11) < 1){
const err33 = {instancePath:instancePath+"/os/name",schemaPath:"#/properties/os/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
else {
const err34 = {instancePath:instancePath+"/os/name",schemaPath:"#/properties/os/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
if(data10.version !== undefined){
let data12 = data10.version;
if(typeof data12 === "string"){
if(func2(data12) > 128){
const err35 = {instancePath:instancePath+"/os/version",schemaPath:"#/properties/os/properties/version/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
else {
const err36 = {instancePath:instancePath+"/os/version",schemaPath:"#/properties/os/properties/version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
if(data10.architecture !== undefined){
let data13 = data10.architecture;
if(typeof data13 === "string"){
if(func2(data13) > 64){
const err37 = {instancePath:instancePath+"/os/architecture",schemaPath:"#/properties/os/properties/architecture/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
else {
const err38 = {instancePath:instancePath+"/os/architecture",schemaPath:"#/properties/os/properties/architecture/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
}
else {
const err39 = {instancePath:instancePath+"/os",schemaPath:"#/properties/os/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
}
else {
const err40 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
validate36.errors = vErrors;
return errors === 0;
}

export const validateDiscoverResult = validate37;
const schema53 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discover-result.schema.json","title":"DiscoverResult","type":"object","required":["protocolVersion","serverInfo","instanceId","document"],"properties":{"protocolVersion":{"$ref":"../common.schema.json#/definitions/ProtocolVersion"},"serverInfo":{"$ref":"../common.schema.json#/definitions/ProductInfo"},"instanceId":{"type":"string","minLength":1,"maxLength":256},"document":{"$ref":"./discovery-document.schema.json"}},"additionalProperties":true};
const schema56 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discovery-document.schema.json","title":"DiscoveryDocument","type":"object","required":["openrpc","info","methods","x-erato-catalogue"],"properties":{"openrpc":{"type":"string","pattern":"^1\\.4\\.[0-9]+$"},"info":{"type":"object","required":["title","version"],"properties":{"title":{"type":"string","minLength":1},"version":{"type":"string","minLength":1}},"additionalProperties":true},"methods":{"type":"array","items":{"type":"object","required":["name","params","result"],"properties":{"name":{"type":"string","minLength":1},"params":{"type":"array"},"result":{"type":"object"},"x-erato-capability":{"$ref":"../capabilities/capability.schema.json"}},"additionalProperties":true}},"x-erato-catalogue":{"$ref":"../common.schema.json#/definitions/CatalogueIdentity"}},"additionalProperties":true};
const schema57 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/capabilities/capability.schema.json","title":"CapabilityDescriptor","type":"object","required":["id","major","method","availability"],"properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$"},"major":{"type":"integer","minimum":1},"method":{"type":"string","pattern":"^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+\\.v[1-9][0-9]*$"},"availability":{"oneOf":[{"type":"object","required":["state"],"properties":{"state":{"const":"enabled"}},"additionalProperties":true},{"type":"object","required":["state","reasonCode"],"properties":{"state":{"const":"disabled"},"reasonCode":{"type":"string","minLength":1,"maxLength":128}},"additionalProperties":true},{"type":"object","required":["state"],"properties":{"state":{"type":"string","not":{"enum":["enabled","disabled"]}}},"additionalProperties":true}]}},"additionalProperties":true};
const pattern3 = new RegExp("^1\\.4\\.[0-9]+$", "u");
const pattern4 = new RegExp("^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$", "u");
const pattern5 = new RegExp("^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+\\.v[1-9][0-9]*$", "u");
const schema58 = {"type":"object","required":["revision","digest"],"properties":{"revision":{"$ref":"#/definitions/Revision"},"digest":{"$ref":"#/definitions/Digest"}},"additionalProperties":true};
const schema59 = {"type":"string","minLength":1,"maxLength":128};
const schema60 = {"type":"string","pattern":"^sha256:[a-f0-9]{64}$"};
const pattern6 = new RegExp("^sha256:[a-f0-9]{64}$", "u");

function validate39(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.revision === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "revision"},message:"must have required property '"+"revision"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.digest === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "digest"},message:"must have required property '"+"digest"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.revision !== undefined){
let data0 = data.revision;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err2 = {instancePath:instancePath+"/revision",schemaPath:"#/definitions/Revision/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/revision",schemaPath:"#/definitions/Revision/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/revision",schemaPath:"#/definitions/Revision/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.digest !== undefined){
let data1 = data.digest;
if(typeof data1 === "string"){
if(!pattern6.test(data1)){
const err5 = {instancePath:instancePath+"/digest",schemaPath:"#/definitions/Digest/pattern",keyword:"pattern",params:{pattern: "^sha256:[a-f0-9]{64}$"},message:"must match pattern \""+"^sha256:[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/digest",schemaPath:"#/definitions/Digest/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
else {
const err7 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
validate39.errors = vErrors;
return errors === 0;
}


function validate38(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discovery-document.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.openrpc === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "openrpc"},message:"must have required property '"+"openrpc"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.info === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "info"},message:"must have required property '"+"info"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.methods === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "methods"},message:"must have required property '"+"methods"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data["x-erato-catalogue"] === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "x-erato-catalogue"},message:"must have required property '"+"x-erato-catalogue"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.openrpc !== undefined){
let data0 = data.openrpc;
if(typeof data0 === "string"){
if(!pattern3.test(data0)){
const err4 = {instancePath:instancePath+"/openrpc",schemaPath:"#/properties/openrpc/pattern",keyword:"pattern",params:{pattern: "^1\\.4\\.[0-9]+$"},message:"must match pattern \""+"^1\\.4\\.[0-9]+$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/openrpc",schemaPath:"#/properties/openrpc/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.info !== undefined){
let data1 = data.info;
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.title === undefined){
const err6 = {instancePath:instancePath+"/info",schemaPath:"#/properties/info/required",keyword:"required",params:{missingProperty: "title"},message:"must have required property '"+"title"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.version === undefined){
const err7 = {instancePath:instancePath+"/info",schemaPath:"#/properties/info/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.title !== undefined){
let data2 = data1.title;
if(typeof data2 === "string"){
if(func2(data2) < 1){
const err8 = {instancePath:instancePath+"/info/title",schemaPath:"#/properties/info/properties/title/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/info/title",schemaPath:"#/properties/info/properties/title/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data1.version !== undefined){
let data3 = data1.version;
if(typeof data3 === "string"){
if(func2(data3) < 1){
const err10 = {instancePath:instancePath+"/info/version",schemaPath:"#/properties/info/properties/version/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/info/version",schemaPath:"#/properties/info/properties/version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath:instancePath+"/info",schemaPath:"#/properties/info/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data.methods !== undefined){
let data4 = data.methods;
if(Array.isArray(data4)){
const len0 = data4.length;
for(let i0=0; i0<len0; i0++){
let data5 = data4[i0];
if(data5 && typeof data5 == "object" && !Array.isArray(data5)){
if(data5.name === undefined){
const err13 = {instancePath:instancePath+"/methods/" + i0,schemaPath:"#/properties/methods/items/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data5.params === undefined){
const err14 = {instancePath:instancePath+"/methods/" + i0,schemaPath:"#/properties/methods/items/required",keyword:"required",params:{missingProperty: "params"},message:"must have required property '"+"params"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data5.result === undefined){
const err15 = {instancePath:instancePath+"/methods/" + i0,schemaPath:"#/properties/methods/items/required",keyword:"required",params:{missingProperty: "result"},message:"must have required property '"+"result"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data5.name !== undefined){
let data6 = data5.name;
if(typeof data6 === "string"){
if(func2(data6) < 1){
const err16 = {instancePath:instancePath+"/methods/" + i0+"/name",schemaPath:"#/properties/methods/items/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/methods/" + i0+"/name",schemaPath:"#/properties/methods/items/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data5.params !== undefined){
if(!(Array.isArray(data5.params))){
const err18 = {instancePath:instancePath+"/methods/" + i0+"/params",schemaPath:"#/properties/methods/items/properties/params/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data5.result !== undefined){
let data8 = data5.result;
if(!(data8 && typeof data8 == "object" && !Array.isArray(data8))){
const err19 = {instancePath:instancePath+"/methods/" + i0+"/result",schemaPath:"#/properties/methods/items/properties/result/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data5["x-erato-capability"] !== undefined){
let data9 = data5["x-erato-capability"];
if(data9 && typeof data9 == "object" && !Array.isArray(data9)){
if(data9.id === undefined){
const err20 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability",schemaPath:"../capabilities/capability.schema.json/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(data9.major === undefined){
const err21 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability",schemaPath:"../capabilities/capability.schema.json/required",keyword:"required",params:{missingProperty: "major"},message:"must have required property '"+"major"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data9.method === undefined){
const err22 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability",schemaPath:"../capabilities/capability.schema.json/required",keyword:"required",params:{missingProperty: "method"},message:"must have required property '"+"method"+"'"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(data9.availability === undefined){
const err23 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability",schemaPath:"../capabilities/capability.schema.json/required",keyword:"required",params:{missingProperty: "availability"},message:"must have required property '"+"availability"+"'"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data9.id !== undefined){
let data10 = data9.id;
if(typeof data10 === "string"){
if(!pattern4.test(data10)){
const err24 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/id",schemaPath:"../capabilities/capability.schema.json/properties/id/pattern",keyword:"pattern",params:{pattern: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$"},message:"must match pattern \""+"^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$"+"\""};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
else {
const err25 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/id",schemaPath:"../capabilities/capability.schema.json/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data9.major !== undefined){
let data11 = data9.major;
if(!(((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11))) && (isFinite(data11)))){
const err26 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/major",schemaPath:"../capabilities/capability.schema.json/properties/major/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if((typeof data11 == "number") && (isFinite(data11))){
if(data11 < 1 || isNaN(data11)){
const err27 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/major",schemaPath:"../capabilities/capability.schema.json/properties/major/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
}
if(data9.method !== undefined){
let data12 = data9.method;
if(typeof data12 === "string"){
if(!pattern5.test(data12)){
const err28 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/method",schemaPath:"../capabilities/capability.schema.json/properties/method/pattern",keyword:"pattern",params:{pattern: "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+\\.v[1-9][0-9]*$"},message:"must match pattern \""+"^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+\\.v[1-9][0-9]*$"+"\""};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
else {
const err29 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/method",schemaPath:"../capabilities/capability.schema.json/properties/method/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data9.availability !== undefined){
let data13 = data9.availability;
const _errs33 = errors;
let valid7 = false;
let passing0 = null;
const _errs34 = errors;
if(data13 && typeof data13 == "object" && !Array.isArray(data13)){
if(data13.state === undefined){
const err30 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf/0/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(data13.state !== undefined){
if("enabled" !== data13.state){
const err31 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability/state",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf/0/properties/state/const",keyword:"const",params:{allowedValue: "enabled"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
}
else {
const err32 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf/0/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
var _valid0 = _errs34 === errors;
if(_valid0){
valid7 = true;
passing0 = 0;
}
const _errs38 = errors;
if(data13 && typeof data13 == "object" && !Array.isArray(data13)){
if(data13.state === undefined){
const err33 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf/1/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(data13.reasonCode === undefined){
const err34 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf/1/required",keyword:"required",params:{missingProperty: "reasonCode"},message:"must have required property '"+"reasonCode"+"'"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(data13.state !== undefined){
if("disabled" !== data13.state){
const err35 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability/state",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf/1/properties/state/const",keyword:"const",params:{allowedValue: "disabled"},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
if(data13.reasonCode !== undefined){
let data16 = data13.reasonCode;
if(typeof data16 === "string"){
if(func2(data16) > 128){
const err36 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability/reasonCode",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf/1/properties/reasonCode/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if(func2(data16) < 1){
const err37 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability/reasonCode",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf/1/properties/reasonCode/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
else {
const err38 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability/reasonCode",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf/1/properties/reasonCode/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
}
else {
const err39 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf/1/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
var _valid0 = _errs38 === errors;
if(_valid0 && valid7){
valid7 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid7 = true;
passing0 = 1;
}
const _errs44 = errors;
if(data13 && typeof data13 == "object" && !Array.isArray(data13)){
if(data13.state === undefined){
const err40 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf/2/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
if(data13.state !== undefined){
let data17 = data13.state;
if(typeof data17 !== "string"){
const err41 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability/state",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf/2/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
const _errs49 = errors;
const _errs50 = errors;
if(!((data17 === "enabled") || (data17 === "disabled"))){
const err42 = {};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
var valid11 = _errs50 === errors;
if(valid11){
const err43 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability/state",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf/2/properties/state/not",keyword:"not",params:{},message:"must NOT be valid"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
else {
errors = _errs49;
if(vErrors !== null){
if(_errs49){
vErrors.length = _errs49;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err44 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf/2/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
var _valid0 = _errs44 === errors;
if(_valid0 && valid7){
valid7 = false;
passing0 = [passing0, 2];
}
else {
if(_valid0){
valid7 = true;
passing0 = 2;
}
}
}
if(!valid7){
const err45 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/availability",schemaPath:"../capabilities/capability.schema.json/properties/availability/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
else {
errors = _errs33;
if(vErrors !== null){
if(_errs33){
vErrors.length = _errs33;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err46 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability",schemaPath:"../capabilities/capability.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
}
}
else {
const err47 = {instancePath:instancePath+"/methods/" + i0,schemaPath:"#/properties/methods/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
}
}
else {
const err48 = {instancePath:instancePath+"/methods",schemaPath:"#/properties/methods/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
if(data["x-erato-catalogue"] !== undefined){
if(!(validate39(data["x-erato-catalogue"], {instancePath:instancePath+"/x-erato-catalogue",parentData:data,parentDataProperty:"x-erato-catalogue",rootData}))){
vErrors = vErrors === null ? validate39.errors : vErrors.concat(validate39.errors);
errors = vErrors.length;
}
}
}
else {
const err49 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
validate38.errors = vErrors;
return errors === 0;
}


function validate37(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discover-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.protocolVersion === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "protocolVersion"},message:"must have required property '"+"protocolVersion"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.serverInfo === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "serverInfo"},message:"must have required property '"+"serverInfo"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.instanceId === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "instanceId"},message:"must have required property '"+"instanceId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.document === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "document"},message:"must have required property '"+"document"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data.protocolVersion !== undefined){
let data0 = data.protocolVersion;
if(typeof data0 === "string"){
if(!pattern1.test(data0)){
const err4 = {instancePath:instancePath+"/protocolVersion",schemaPath:"../common.schema.json#/definitions/ProtocolVersion/pattern",keyword:"pattern",params:{pattern: "^[1-9][0-9]*\\.[0-9]+$"},message:"must match pattern \""+"^[1-9][0-9]*\\.[0-9]+$"+"\""};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
else {
const err5 = {instancePath:instancePath+"/protocolVersion",schemaPath:"../common.schema.json#/definitions/ProtocolVersion/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.serverInfo !== undefined){
let data1 = data.serverInfo;
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.name === undefined){
const err6 = {instancePath:instancePath+"/serverInfo",schemaPath:"../common.schema.json#/definitions/ProductInfo/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.version === undefined){
const err7 = {instancePath:instancePath+"/serverInfo",schemaPath:"../common.schema.json#/definitions/ProductInfo/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.name !== undefined){
let data2 = data1.name;
if(typeof data2 === "string"){
if(func2(data2) > 128){
const err8 = {instancePath:instancePath+"/serverInfo/name",schemaPath:"../common.schema.json#/definitions/ProductInfo/properties/name/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func2(data2) < 1){
const err9 = {instancePath:instancePath+"/serverInfo/name",schemaPath:"../common.schema.json#/definitions/ProductInfo/properties/name/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/serverInfo/name",schemaPath:"../common.schema.json#/definitions/ProductInfo/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data1.version !== undefined){
let data3 = data1.version;
if(typeof data3 === "string"){
if(func2(data3) > 128){
const err11 = {instancePath:instancePath+"/serverInfo/version",schemaPath:"../common.schema.json#/definitions/ProductInfo/properties/version/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(func2(data3) < 1){
const err12 = {instancePath:instancePath+"/serverInfo/version",schemaPath:"../common.schema.json#/definitions/ProductInfo/properties/version/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/serverInfo/version",schemaPath:"../common.schema.json#/definitions/ProductInfo/properties/version/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
else {
const err14 = {instancePath:instancePath+"/serverInfo",schemaPath:"../common.schema.json#/definitions/ProductInfo/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.instanceId !== undefined){
let data4 = data.instanceId;
if(typeof data4 === "string"){
if(func2(data4) > 256){
const err15 = {instancePath:instancePath+"/instanceId",schemaPath:"#/properties/instanceId/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(func2(data4) < 1){
const err16 = {instancePath:instancePath+"/instanceId",schemaPath:"#/properties/instanceId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/instanceId",schemaPath:"#/properties/instanceId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.document !== undefined){
if(!(validate38(data.document, {instancePath:instancePath+"/document",parentData:data,parentDataProperty:"document",rootData}))){
vErrors = vErrors === null ? validate38.errors : vErrors.concat(validate38.errors);
errors = vErrors.length;
}
}
}
else {
const err18 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
validate37.errors = vErrors;
return errors === 0;
}

export const validateCancelParams = validate42;
const schema61 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/cancel-params.schema.json","title":"CancelParams","type":"object","required":["requestId","reason"],"properties":{"requestId":{"$ref":"../common.schema.json#/definitions/RequestId"},"reason":{"type":"string","minLength":1,"maxLength":64}},"additionalProperties":true};

function validate42(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/cancel-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.requestId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.reason === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "reason"},message:"must have required property '"+"reason"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.requestId !== undefined){
let data0 = data.requestId;
const _errs4 = errors;
let valid2 = false;
let passing0 = null;
const _errs5 = errors;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err2 = {instancePath:instancePath+"/requestId",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/requestId",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/requestId",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
var _valid0 = _errs5 === errors;
if(_valid0){
valid2 = true;
passing0 = 0;
}
const _errs7 = errors;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err5 = {instancePath:instancePath+"/requestId",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/1/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
var _valid0 = _errs7 === errors;
if(_valid0 && valid2){
valid2 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid2 = true;
passing0 = 1;
}
}
if(!valid2){
const err6 = {instancePath:instancePath+"/requestId",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
else {
errors = _errs4;
if(vErrors !== null){
if(_errs4){
vErrors.length = _errs4;
}
else {
vErrors = null;
}
}
}
}
if(data.reason !== undefined){
let data1 = data.reason;
if(typeof data1 === "string"){
if(func2(data1) > 64){
const err7 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func2(data1) < 1){
const err8 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/reason",schemaPath:"#/properties/reason/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
else {
const err10 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
validate42.errors = vErrors;
return errors === 0;
}

export const validateCancelResult = validate43;
const schema63 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/cancel-result.schema.json","title":"CancelResult","type":"object","required":["accepted"],"properties":{"accepted":{"type":"boolean"}},"additionalProperties":true};

function validate43(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/cancel-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.accepted === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "accepted"},message:"must have required property '"+"accepted"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.accepted !== undefined){
if(typeof data.accepted !== "boolean"){
const err1 = {instancePath:instancePath+"/accepted",schemaPath:"#/properties/accepted/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
}
else {
const err2 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
validate43.errors = vErrors;
return errors === 0;
}

export const validateDiscoveryDocument = validate38;

export const validateDiagnosticsEchoV1Params = validate44;
const schema64 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/diagnostics-echo-v1-params.schema.json","title":"DiagnosticsEchoV1Params","type":"object","required":["message"],"properties":{"message":{"type":"string","maxLength":4096},"delayMs":{"description":"Artificial pause before the sidecar answers, in milliseconds, so long-call mechanics — progress polling and cancellation — can be exercised without a real long-running capability. Sidecars report the pause as a `delay` trace step and MAY cap it lower.","type":"integer","minimum":0,"maximum":60000}},"additionalProperties":true};

function validate44(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/diagnostics-echo-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.message === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "message"},message:"must have required property '"+"message"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.message !== undefined){
let data0 = data.message;
if(typeof data0 === "string"){
if(func2(data0) > 4096){
const err1 = {instancePath:instancePath+"/message",schemaPath:"#/properties/message/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
else {
const err2 = {instancePath:instancePath+"/message",schemaPath:"#/properties/message/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.delayMs !== undefined){
let data1 = data.delayMs;
if(!(((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1))) && (isFinite(data1)))){
const err3 = {instancePath:instancePath+"/delayMs",schemaPath:"#/properties/delayMs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if((typeof data1 == "number") && (isFinite(data1))){
if(data1 > 60000 || isNaN(data1)){
const err4 = {instancePath:instancePath+"/delayMs",schemaPath:"#/properties/delayMs/maximum",keyword:"maximum",params:{comparison: "<=", limit: 60000},message:"must be <= 60000"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1 < 0 || isNaN(data1)){
const err5 = {instancePath:instancePath+"/delayMs",schemaPath:"#/properties/delayMs/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate44.errors = vErrors;
return errors === 0;
}

export const validateDiagnosticsEchoV1Result = validate45;
const schema65 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/diagnostics-echo-v1-result.schema.json","title":"DiagnosticsEchoV1Result","type":"object","required":["message","sidecarInstanceId"],"properties":{"message":{"type":"string","maxLength":4096},"sidecarInstanceId":{"type":"string","minLength":1,"maxLength":256}},"additionalProperties":true};

function validate45(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/diagnostics-echo-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.message === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "message"},message:"must have required property '"+"message"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.sidecarInstanceId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sidecarInstanceId"},message:"must have required property '"+"sidecarInstanceId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.message !== undefined){
let data0 = data.message;
if(typeof data0 === "string"){
if(func2(data0) > 4096){
const err2 = {instancePath:instancePath+"/message",schemaPath:"#/properties/message/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
else {
const err3 = {instancePath:instancePath+"/message",schemaPath:"#/properties/message/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.sidecarInstanceId !== undefined){
let data1 = data.sidecarInstanceId;
if(typeof data1 === "string"){
if(func2(data1) > 256){
const err4 = {instancePath:instancePath+"/sidecarInstanceId",schemaPath:"#/properties/sidecarInstanceId/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func2(data1) < 1){
const err5 = {instancePath:instancePath+"/sidecarInstanceId",schemaPath:"#/properties/sidecarInstanceId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/sidecarInstanceId",schemaPath:"#/properties/sidecarInstanceId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
else {
const err7 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
validate45.errors = vErrors;
return errors === 0;
}

export const validateSidecarRestartV1Params = validate46;
const schema66 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-restart-v1-params.schema.json","title":"SidecarRestartV1Params","type":"object","properties":{},"additionalProperties":true};

function validate46(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-restart-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
}
else {
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
validate46.errors = vErrors;
return errors === 0;
}

export const validateSidecarRestartV1Result = validate47;
const schema67 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-restart-v1-result.schema.json","title":"SidecarRestartV1Result","type":"object","required":["accepted"],"properties":{"accepted":{"type":"boolean"}},"additionalProperties":true};

function validate47(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-restart-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.accepted === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "accepted"},message:"must have required property '"+"accepted"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.accepted !== undefined){
if(typeof data.accepted !== "boolean"){
const err1 = {instancePath:instancePath+"/accepted",schemaPath:"#/properties/accepted/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
}
else {
const err2 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
validate47.errors = vErrors;
return errors === 0;
}

export const validateSidecarConfigureV1Params = validate48;
const schema68 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-configure-v1-params.schema.json","title":"SidecarConfigureV1Params","type":"object","required":["user_configuration","organization_configuration"],"properties":{"user_configuration":{"$ref":"../configuration/sidecar-configuration.schema.json"},"organization_configuration":{"$ref":"../configuration/sidecar-configuration.schema.json"}},"additionalProperties":true};
const schema69 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/configuration/sidecar-configuration.schema.json","title":"SidecarConfiguration","description":"An extensible configuration layer. Unknown properties must be accepted and preserved.","type":"object","properties":{"show_tray_icon":{"description":"Whether the sidecar should show its system tray icon. Null leaves the decision to the other configuration layer or the sidecar default.","type":["boolean","null"]},"indexing_parallelism":{"type":["integer","null"],"minimum":1,"maximum":9007199254740991,"description":"Maximum documents concurrently processed across all kinds and generations, including extraction and commit. Lowering it lets in-flight documents finish and prevents excess new starts. Null or absence inherits the other layer; the sidecar default is 1. Zero is invalid and does not pause indexing."},"indexing_documents_per_minute":{"type":["integer","null"],"minimum":1,"maximum":9007199254740991,"description":"Global maximum document-processing starts per rolling 60 seconds, shared by all workers, kinds and generations. Retry attempts consume this budget; one extraction shared by generations consumes it once. Deletion-only cleanup does not consume it. Null or absence inherits the other layer; the sidecar default is 40. Zero is invalid and does not pause indexing."}},"additionalProperties":true};

function validate48(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-configure-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.user_configuration === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "user_configuration"},message:"must have required property '"+"user_configuration"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.organization_configuration === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "organization_configuration"},message:"must have required property '"+"organization_configuration"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.user_configuration !== undefined){
let data0 = data.user_configuration;
if(data0 && typeof data0 == "object" && !Array.isArray(data0)){
if(data0.show_tray_icon !== undefined){
let data1 = data0.show_tray_icon;
if((typeof data1 !== "boolean") && (data1 !== null)){
const err2 = {instancePath:instancePath+"/user_configuration/show_tray_icon",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/show_tray_icon/type",keyword:"type",params:{type: schema69.properties.show_tray_icon.type},message:"must be boolean,null"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data0.indexing_parallelism !== undefined){
let data2 = data0.indexing_parallelism;
if((!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))) && (data2 !== null)){
const err3 = {instancePath:instancePath+"/user_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/type",keyword:"type",params:{type: schema69.properties.indexing_parallelism.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 > 9007199254740991 || isNaN(data2)){
const err4 = {instancePath:instancePath+"/user_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data2 < 1 || isNaN(data2)){
const err5 = {instancePath:instancePath+"/user_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
}
if(data0.indexing_documents_per_minute !== undefined){
let data3 = data0.indexing_documents_per_minute;
if((!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))) && (data3 !== null)){
const err6 = {instancePath:instancePath+"/user_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/type",keyword:"type",params:{type: schema69.properties.indexing_documents_per_minute.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 > 9007199254740991 || isNaN(data3)){
const err7 = {instancePath:instancePath+"/user_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data3 < 1 || isNaN(data3)){
const err8 = {instancePath:instancePath+"/user_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
}
else {
const err9 = {instancePath:instancePath+"/user_configuration",schemaPath:"../configuration/sidecar-configuration.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.organization_configuration !== undefined){
let data4 = data.organization_configuration;
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.show_tray_icon !== undefined){
let data5 = data4.show_tray_icon;
if((typeof data5 !== "boolean") && (data5 !== null)){
const err10 = {instancePath:instancePath+"/organization_configuration/show_tray_icon",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/show_tray_icon/type",keyword:"type",params:{type: schema69.properties.show_tray_icon.type},message:"must be boolean,null"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data4.indexing_parallelism !== undefined){
let data6 = data4.indexing_parallelism;
if((!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))) && (data6 !== null)){
const err11 = {instancePath:instancePath+"/organization_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/type",keyword:"type",params:{type: schema69.properties.indexing_parallelism.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 > 9007199254740991 || isNaN(data6)){
const err12 = {instancePath:instancePath+"/organization_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data6 < 1 || isNaN(data6)){
const err13 = {instancePath:instancePath+"/organization_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
if(data4.indexing_documents_per_minute !== undefined){
let data7 = data4.indexing_documents_per_minute;
if((!(((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7))) && (isFinite(data7)))) && (data7 !== null)){
const err14 = {instancePath:instancePath+"/organization_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/type",keyword:"type",params:{type: schema69.properties.indexing_documents_per_minute.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if((typeof data7 == "number") && (isFinite(data7))){
if(data7 > 9007199254740991 || isNaN(data7)){
const err15 = {instancePath:instancePath+"/organization_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data7 < 1 || isNaN(data7)){
const err16 = {instancePath:instancePath+"/organization_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
}
else {
const err17 = {instancePath:instancePath+"/organization_configuration",schemaPath:"../configuration/sidecar-configuration.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
}
else {
const err18 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
validate48.errors = vErrors;
return errors === 0;
}

export const validateSidecarConfigureV1Result = validate49;
const schema71 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-configure-v1-result.schema.json","title":"SidecarConfigureV1Result","type":"object","additionalProperties":true};

function validate49(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-configure-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
}
else {
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
validate49.errors = vErrors;
return errors === 0;
}

export const validateOutlookListMailboxesV1Params = validate50;
const schema72 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-mailboxes-v1-params.schema.json","title":"OutlookListMailboxesV1Params","type":"object","properties":{},"additionalProperties":true};

function validate50(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-mailboxes-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
}
else {
const err0 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
validate50.errors = vErrors;
return errors === 0;
}

export const validateOutlookListMailboxesV1Result = validate51;
const schema73 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-mailboxes-v1-result.schema.json","title":"OutlookListMailboxesV1Result","type":"object","required":["mailboxes","warnings"],"properties":{"mailboxes":{"type":"array","items":{"$ref":"../outlook/mailbox.schema.json"},"maxItems":1024},"warnings":{"type":"array","items":{"$ref":"../outlook/listing-warning.schema.json"},"maxItems":1024}},"additionalProperties":true};
const schema74 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/mailbox.schema.json","title":"OutlookMailbox","description":"A mailbox or message store available through the local Outlook installation.","type":"object","required":["id","displayName","source"],"properties":{"id":{"description":"Short opaque mailbox identifier. It is unique for the current sidecar runtime and logically stable across restarts while the Outlook profile and store identity remain unchanged.","type":"string","pattern":"^[0-9a-f]{32}$"},"displayName":{"type":"string","minLength":1,"maxLength":1024},"emailAddress":{"type":"string","minLength":1,"maxLength":1024},"profileName":{"description":"Name of the Outlook profile containing this mailbox. Omitted when the platform or standalone store has no profile concept.","type":"string","minLength":1,"maxLength":1024},"source":{"description":"Implementation-defined local Outlook storage source. Known values include pst, ost, macOsProfile, and windowsOutlook.","type":"string","minLength":1,"maxLength":128}},"additionalProperties":true};
const schema75 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/listing-warning.schema.json","title":"OutlookListingWarning","description":"A local Outlook source that could not be inspected without hiding successful results.","type":"object","required":["message"],"properties":{"path":{"type":"string","minLength":1,"maxLength":32768},"message":{"type":"string","minLength":1,"maxLength":4096}},"additionalProperties":true};
const pattern7 = new RegExp("^[0-9a-f]{32}$", "u");

function validate51(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-mailboxes-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.mailboxes === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mailboxes"},message:"must have required property '"+"mailboxes"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.warnings === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "warnings"},message:"must have required property '"+"warnings"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.mailboxes !== undefined){
let data0 = data.mailboxes;
if(Array.isArray(data0)){
if(data0.length > 1024){
const err2 = {instancePath:instancePath+"/mailboxes",schemaPath:"#/properties/mailboxes/maxItems",keyword:"maxItems",params:{limit: 1024},message:"must NOT have more than 1024 items"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.id === undefined){
const err3 = {instancePath:instancePath+"/mailboxes/" + i0,schemaPath:"../outlook/mailbox.schema.json/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data1.displayName === undefined){
const err4 = {instancePath:instancePath+"/mailboxes/" + i0,schemaPath:"../outlook/mailbox.schema.json/required",keyword:"required",params:{missingProperty: "displayName"},message:"must have required property '"+"displayName"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.source === undefined){
const err5 = {instancePath:instancePath+"/mailboxes/" + i0,schemaPath:"../outlook/mailbox.schema.json/required",keyword:"required",params:{missingProperty: "source"},message:"must have required property '"+"source"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.id !== undefined){
let data2 = data1.id;
if(typeof data2 === "string"){
if(!pattern7.test(data2)){
const err6 = {instancePath:instancePath+"/mailboxes/" + i0+"/id",schemaPath:"../outlook/mailbox.schema.json/properties/id/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{32}$"},message:"must match pattern \""+"^[0-9a-f]{32}$"+"\""};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/mailboxes/" + i0+"/id",schemaPath:"../outlook/mailbox.schema.json/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data1.displayName !== undefined){
let data3 = data1.displayName;
if(typeof data3 === "string"){
if(func2(data3) > 1024){
const err8 = {instancePath:instancePath+"/mailboxes/" + i0+"/displayName",schemaPath:"../outlook/mailbox.schema.json/properties/displayName/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(func2(data3) < 1){
const err9 = {instancePath:instancePath+"/mailboxes/" + i0+"/displayName",schemaPath:"../outlook/mailbox.schema.json/properties/displayName/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/mailboxes/" + i0+"/displayName",schemaPath:"../outlook/mailbox.schema.json/properties/displayName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data1.emailAddress !== undefined){
let data4 = data1.emailAddress;
if(typeof data4 === "string"){
if(func2(data4) > 1024){
const err11 = {instancePath:instancePath+"/mailboxes/" + i0+"/emailAddress",schemaPath:"../outlook/mailbox.schema.json/properties/emailAddress/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(func2(data4) < 1){
const err12 = {instancePath:instancePath+"/mailboxes/" + i0+"/emailAddress",schemaPath:"../outlook/mailbox.schema.json/properties/emailAddress/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/mailboxes/" + i0+"/emailAddress",schemaPath:"../outlook/mailbox.schema.json/properties/emailAddress/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data1.profileName !== undefined){
let data5 = data1.profileName;
if(typeof data5 === "string"){
if(func2(data5) > 1024){
const err14 = {instancePath:instancePath+"/mailboxes/" + i0+"/profileName",schemaPath:"../outlook/mailbox.schema.json/properties/profileName/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(func2(data5) < 1){
const err15 = {instancePath:instancePath+"/mailboxes/" + i0+"/profileName",schemaPath:"../outlook/mailbox.schema.json/properties/profileName/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
else {
const err16 = {instancePath:instancePath+"/mailboxes/" + i0+"/profileName",schemaPath:"../outlook/mailbox.schema.json/properties/profileName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data1.source !== undefined){
let data6 = data1.source;
if(typeof data6 === "string"){
if(func2(data6) > 128){
const err17 = {instancePath:instancePath+"/mailboxes/" + i0+"/source",schemaPath:"../outlook/mailbox.schema.json/properties/source/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(func2(data6) < 1){
const err18 = {instancePath:instancePath+"/mailboxes/" + i0+"/source",schemaPath:"../outlook/mailbox.schema.json/properties/source/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/mailboxes/" + i0+"/source",schemaPath:"../outlook/mailbox.schema.json/properties/source/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
}
else {
const err20 = {instancePath:instancePath+"/mailboxes/" + i0,schemaPath:"../outlook/mailbox.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
}
else {
const err21 = {instancePath:instancePath+"/mailboxes",schemaPath:"#/properties/mailboxes/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.warnings !== undefined){
let data7 = data.warnings;
if(Array.isArray(data7)){
if(data7.length > 1024){
const err22 = {instancePath:instancePath+"/warnings",schemaPath:"#/properties/warnings/maxItems",keyword:"maxItems",params:{limit: 1024},message:"must NOT have more than 1024 items"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
const len1 = data7.length;
for(let i1=0; i1<len1; i1++){
let data8 = data7[i1];
if(data8 && typeof data8 == "object" && !Array.isArray(data8)){
if(data8.message === undefined){
const err23 = {instancePath:instancePath+"/warnings/" + i1,schemaPath:"../outlook/listing-warning.schema.json/required",keyword:"required",params:{missingProperty: "message"},message:"must have required property '"+"message"+"'"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data8.path !== undefined){
let data9 = data8.path;
if(typeof data9 === "string"){
if(func2(data9) > 32768){
const err24 = {instancePath:instancePath+"/warnings/" + i1+"/path",schemaPath:"../outlook/listing-warning.schema.json/properties/path/maxLength",keyword:"maxLength",params:{limit: 32768},message:"must NOT have more than 32768 characters"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(func2(data9) < 1){
const err25 = {instancePath:instancePath+"/warnings/" + i1+"/path",schemaPath:"../outlook/listing-warning.schema.json/properties/path/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
else {
const err26 = {instancePath:instancePath+"/warnings/" + i1+"/path",schemaPath:"../outlook/listing-warning.schema.json/properties/path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data8.message !== undefined){
let data10 = data8.message;
if(typeof data10 === "string"){
if(func2(data10) > 4096){
const err27 = {instancePath:instancePath+"/warnings/" + i1+"/message",schemaPath:"../outlook/listing-warning.schema.json/properties/message/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(func2(data10) < 1){
const err28 = {instancePath:instancePath+"/warnings/" + i1+"/message",schemaPath:"../outlook/listing-warning.schema.json/properties/message/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
else {
const err29 = {instancePath:instancePath+"/warnings/" + i1+"/message",schemaPath:"../outlook/listing-warning.schema.json/properties/message/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
}
else {
const err30 = {instancePath:instancePath+"/warnings/" + i1,schemaPath:"../outlook/listing-warning.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
}
else {
const err31 = {instancePath:instancePath+"/warnings",schemaPath:"#/properties/warnings/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
}
else {
const err32 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
validate51.errors = vErrors;
return errors === 0;
}

export const validateOutlookListEmailsV1Params = validate52;
const schema76 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-emails-v1-params.schema.json","title":"OutlookListEmailsV1Params","type":"object","required":["mailboxId"],"properties":{"mailboxId":{"description":"Short opaque identifier returned by outlook.list_mailboxes.v1.","type":"string","pattern":"^[0-9a-f]{32}$"}},"additionalProperties":true};

function validate52(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-emails-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.mailboxId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mailboxId"},message:"must have required property '"+"mailboxId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.mailboxId !== undefined){
let data0 = data.mailboxId;
if(typeof data0 === "string"){
if(!pattern7.test(data0)){
const err1 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{32}$"},message:"must match pattern \""+"^[0-9a-f]{32}$"+"\""};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
else {
const err2 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
}
else {
const err3 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
validate52.errors = vErrors;
return errors === 0;
}

export const validateOutlookListEmailsV1Result = validate53;
const schema77 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-emails-v1-result.schema.json","title":"OutlookListEmailsV1Result","description":"Up to 50 of the newest locally indexed emails in the selected mailbox.","type":"object","required":["mailbox","emails"],"properties":{"mailbox":{"$ref":"../outlook/mailbox.schema.json"},"emails":{"type":"array","items":{"$ref":"../outlook/email-summary.schema.json"},"maxItems":50}},"additionalProperties":true};
const schema79 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/email-summary.schema.json","title":"OutlookEmailSummary","description":"Metadata for one locally indexed Outlook email.","type":"object","required":["id"],"properties":{"id":{"description":"Source-specific stable message identifier.","type":"string","minLength":1,"maxLength":32768},"subject":{"type":"string","maxLength":32768},"senderName":{"type":"string","maxLength":4096},"senderEmailAddress":{"type":"string","maxLength":4096},"receivedAtUnixSeconds":{"description":"UTC Unix timestamp in whole seconds.","type":"integer","minimum":-62135596800,"maximum":253402300799},"internetMessageId":{"type":"string","maxLength":32768}},"additionalProperties":true};

function validate53(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-emails-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.mailbox === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mailbox"},message:"must have required property '"+"mailbox"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.emails === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "emails"},message:"must have required property '"+"emails"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.mailbox !== undefined){
let data0 = data.mailbox;
if(data0 && typeof data0 == "object" && !Array.isArray(data0)){
if(data0.id === undefined){
const err2 = {instancePath:instancePath+"/mailbox",schemaPath:"../outlook/mailbox.schema.json/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data0.displayName === undefined){
const err3 = {instancePath:instancePath+"/mailbox",schemaPath:"../outlook/mailbox.schema.json/required",keyword:"required",params:{missingProperty: "displayName"},message:"must have required property '"+"displayName"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data0.source === undefined){
const err4 = {instancePath:instancePath+"/mailbox",schemaPath:"../outlook/mailbox.schema.json/required",keyword:"required",params:{missingProperty: "source"},message:"must have required property '"+"source"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data0.id !== undefined){
let data1 = data0.id;
if(typeof data1 === "string"){
if(!pattern7.test(data1)){
const err5 = {instancePath:instancePath+"/mailbox/id",schemaPath:"../outlook/mailbox.schema.json/properties/id/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{32}$"},message:"must match pattern \""+"^[0-9a-f]{32}$"+"\""};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/mailbox/id",schemaPath:"../outlook/mailbox.schema.json/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data0.displayName !== undefined){
let data2 = data0.displayName;
if(typeof data2 === "string"){
if(func2(data2) > 1024){
const err7 = {instancePath:instancePath+"/mailbox/displayName",schemaPath:"../outlook/mailbox.schema.json/properties/displayName/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func2(data2) < 1){
const err8 = {instancePath:instancePath+"/mailbox/displayName",schemaPath:"../outlook/mailbox.schema.json/properties/displayName/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/mailbox/displayName",schemaPath:"../outlook/mailbox.schema.json/properties/displayName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data0.emailAddress !== undefined){
let data3 = data0.emailAddress;
if(typeof data3 === "string"){
if(func2(data3) > 1024){
const err10 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"../outlook/mailbox.schema.json/properties/emailAddress/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func2(data3) < 1){
const err11 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"../outlook/mailbox.schema.json/properties/emailAddress/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"../outlook/mailbox.schema.json/properties/emailAddress/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data0.profileName !== undefined){
let data4 = data0.profileName;
if(typeof data4 === "string"){
if(func2(data4) > 1024){
const err13 = {instancePath:instancePath+"/mailbox/profileName",schemaPath:"../outlook/mailbox.schema.json/properties/profileName/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func2(data4) < 1){
const err14 = {instancePath:instancePath+"/mailbox/profileName",schemaPath:"../outlook/mailbox.schema.json/properties/profileName/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/mailbox/profileName",schemaPath:"../outlook/mailbox.schema.json/properties/profileName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data0.source !== undefined){
let data5 = data0.source;
if(typeof data5 === "string"){
if(func2(data5) > 128){
const err16 = {instancePath:instancePath+"/mailbox/source",schemaPath:"../outlook/mailbox.schema.json/properties/source/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func2(data5) < 1){
const err17 = {instancePath:instancePath+"/mailbox/source",schemaPath:"../outlook/mailbox.schema.json/properties/source/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
else {
const err18 = {instancePath:instancePath+"/mailbox/source",schemaPath:"../outlook/mailbox.schema.json/properties/source/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
else {
const err19 = {instancePath:instancePath+"/mailbox",schemaPath:"../outlook/mailbox.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.emails !== undefined){
let data6 = data.emails;
if(Array.isArray(data6)){
if(data6.length > 50){
const err20 = {instancePath:instancePath+"/emails",schemaPath:"#/properties/emails/maxItems",keyword:"maxItems",params:{limit: 50},message:"must NOT have more than 50 items"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
const len0 = data6.length;
for(let i0=0; i0<len0; i0++){
let data7 = data6[i0];
if(data7 && typeof data7 == "object" && !Array.isArray(data7)){
if(data7.id === undefined){
const err21 = {instancePath:instancePath+"/emails/" + i0,schemaPath:"../outlook/email-summary.schema.json/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(data7.id !== undefined){
let data8 = data7.id;
if(typeof data8 === "string"){
if(func2(data8) > 32768){
const err22 = {instancePath:instancePath+"/emails/" + i0+"/id",schemaPath:"../outlook/email-summary.schema.json/properties/id/maxLength",keyword:"maxLength",params:{limit: 32768},message:"must NOT have more than 32768 characters"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(func2(data8) < 1){
const err23 = {instancePath:instancePath+"/emails/" + i0+"/id",schemaPath:"../outlook/email-summary.schema.json/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
else {
const err24 = {instancePath:instancePath+"/emails/" + i0+"/id",schemaPath:"../outlook/email-summary.schema.json/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data7.subject !== undefined){
let data9 = data7.subject;
if(typeof data9 === "string"){
if(func2(data9) > 32768){
const err25 = {instancePath:instancePath+"/emails/" + i0+"/subject",schemaPath:"../outlook/email-summary.schema.json/properties/subject/maxLength",keyword:"maxLength",params:{limit: 32768},message:"must NOT have more than 32768 characters"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
else {
const err26 = {instancePath:instancePath+"/emails/" + i0+"/subject",schemaPath:"../outlook/email-summary.schema.json/properties/subject/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data7.senderName !== undefined){
let data10 = data7.senderName;
if(typeof data10 === "string"){
if(func2(data10) > 4096){
const err27 = {instancePath:instancePath+"/emails/" + i0+"/senderName",schemaPath:"../outlook/email-summary.schema.json/properties/senderName/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/emails/" + i0+"/senderName",schemaPath:"../outlook/email-summary.schema.json/properties/senderName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data7.senderEmailAddress !== undefined){
let data11 = data7.senderEmailAddress;
if(typeof data11 === "string"){
if(func2(data11) > 4096){
const err29 = {instancePath:instancePath+"/emails/" + i0+"/senderEmailAddress",schemaPath:"../outlook/email-summary.schema.json/properties/senderEmailAddress/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
else {
const err30 = {instancePath:instancePath+"/emails/" + i0+"/senderEmailAddress",schemaPath:"../outlook/email-summary.schema.json/properties/senderEmailAddress/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data7.receivedAtUnixSeconds !== undefined){
let data12 = data7.receivedAtUnixSeconds;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err31 = {instancePath:instancePath+"/emails/" + i0+"/receivedAtUnixSeconds",schemaPath:"../outlook/email-summary.schema.json/properties/receivedAtUnixSeconds/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if((typeof data12 == "number") && (isFinite(data12))){
if(data12 > 253402300799 || isNaN(data12)){
const err32 = {instancePath:instancePath+"/emails/" + i0+"/receivedAtUnixSeconds",schemaPath:"../outlook/email-summary.schema.json/properties/receivedAtUnixSeconds/maximum",keyword:"maximum",params:{comparison: "<=", limit: 253402300799},message:"must be <= 253402300799"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(data12 < -62135596800 || isNaN(data12)){
const err33 = {instancePath:instancePath+"/emails/" + i0+"/receivedAtUnixSeconds",schemaPath:"../outlook/email-summary.schema.json/properties/receivedAtUnixSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: -62135596800},message:"must be >= -62135596800"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
if(data7.internetMessageId !== undefined){
let data13 = data7.internetMessageId;
if(typeof data13 === "string"){
if(func2(data13) > 32768){
const err34 = {instancePath:instancePath+"/emails/" + i0+"/internetMessageId",schemaPath:"../outlook/email-summary.schema.json/properties/internetMessageId/maxLength",keyword:"maxLength",params:{limit: 32768},message:"must NOT have more than 32768 characters"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
else {
const err35 = {instancePath:instancePath+"/emails/" + i0+"/internetMessageId",schemaPath:"../outlook/email-summary.schema.json/properties/internetMessageId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
}
else {
const err36 = {instancePath:instancePath+"/emails/" + i0,schemaPath:"../outlook/email-summary.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
}
else {
const err37 = {instancePath:instancePath+"/emails",schemaPath:"#/properties/emails/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
}
else {
const err38 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
validate53.errors = vErrors;
return errors === 0;
}

export const validateOutlookGetConversationV1Params = validate54;
const schema80 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-get-conversation-v1-params.schema.json","title":"OutlookGetConversationV1Params","type":"object","required":["mailboxId","anchor"],"properties":{"mailboxId":{"description":"Short opaque identifier returned by outlook.list_mailboxes.v1.","type":"string","pattern":"^[0-9a-f]{32}$"},"anchor":{"description":"The message the conversation is resolved from.","type":"object","required":["internetMessageId"],"properties":{"internetMessageId":{"description":"RFC 5322 Message-ID of the anchor message, including angle brackets, as reported by outlook.list_emails.v1. Not the Office.js conversationId.","type":"string","minLength":1,"maxLength":32768}},"additionalProperties":true},"maxMessages":{"description":"Cap on the number of returned messages. When the conversation has more, the result is reported as partial.","type":"integer","minimum":1,"maximum":1000}},"additionalProperties":true};

function validate54(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-get-conversation-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.mailboxId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mailboxId"},message:"must have required property '"+"mailboxId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.anchor === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "anchor"},message:"must have required property '"+"anchor"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.mailboxId !== undefined){
let data0 = data.mailboxId;
if(typeof data0 === "string"){
if(!pattern7.test(data0)){
const err2 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{32}$"},message:"must match pattern \""+"^[0-9a-f]{32}$"+"\""};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
else {
const err3 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.anchor !== undefined){
let data1 = data.anchor;
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.internetMessageId === undefined){
const err4 = {instancePath:instancePath+"/anchor",schemaPath:"#/properties/anchor/required",keyword:"required",params:{missingProperty: "internetMessageId"},message:"must have required property '"+"internetMessageId"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.internetMessageId !== undefined){
let data2 = data1.internetMessageId;
if(typeof data2 === "string"){
if(func2(data2) > 32768){
const err5 = {instancePath:instancePath+"/anchor/internetMessageId",schemaPath:"#/properties/anchor/properties/internetMessageId/maxLength",keyword:"maxLength",params:{limit: 32768},message:"must NOT have more than 32768 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(func2(data2) < 1){
const err6 = {instancePath:instancePath+"/anchor/internetMessageId",schemaPath:"#/properties/anchor/properties/internetMessageId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
else {
const err7 = {instancePath:instancePath+"/anchor/internetMessageId",schemaPath:"#/properties/anchor/properties/internetMessageId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
}
else {
const err8 = {instancePath:instancePath+"/anchor",schemaPath:"#/properties/anchor/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.maxMessages !== undefined){
let data3 = data.maxMessages;
if(!(((typeof data3 == "number") && (!(data3 % 1) && !isNaN(data3))) && (isFinite(data3)))){
const err9 = {instancePath:instancePath+"/maxMessages",schemaPath:"#/properties/maxMessages/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 > 1000 || isNaN(data3)){
const err10 = {instancePath:instancePath+"/maxMessages",schemaPath:"#/properties/maxMessages/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1000},message:"must be <= 1000"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data3 < 1 || isNaN(data3)){
const err11 = {instancePath:instancePath+"/maxMessages",schemaPath:"#/properties/maxMessages/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate54.errors = vErrors;
return errors === 0;
}

export const validateOutlookGetConversationV1Result = validate55;
const schema81 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-get-conversation-v1-result.schema.json","title":"OutlookGetConversationV1Result","description":"The messages of the anchored conversation, oldest first, with bodies and attachment bytes carried inline.","type":"object","required":["state","messages"],"properties":{"state":{"description":"Completeness of the conversation. ok means every message and byte reference was produced; partial means some were omitted (see warnings), for example because maxMessages was reached or an attachment could not be read.","type":"string","minLength":1,"maxLength":32},"mailbox":{"$ref":"../outlook/mailbox.schema.json"},"messages":{"type":"array","items":{"$ref":"../outlook/conversation-message.schema.json"}},"warnings":{"type":"array","items":{"$ref":"../outlook/conversation-warning.schema.json"}}},"additionalProperties":true};
const schema89 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/conversation-warning.schema.json","title":"OutlookConversationWarning","description":"A part of a conversation that could not be represented fully, without hiding the rest.","type":"object","required":["code"],"properties":{"code":{"description":"Stable machine-readable warning code. Known values include truncated, attachment_unavailable, and embedded_attachments_omitted.","type":"string","minLength":1,"maxLength":128},"message":{"type":"string","minLength":1,"maxLength":4096},"internetMessageId":{"description":"The message the warning is about, when it is message-scoped.","type":"string","maxLength":32768}},"additionalProperties":true};
const schema83 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/conversation-message.schema.json","title":"OutlookConversationMessage","description":"One message of an Outlook conversation, with its body and attachment bytes carried inline.","type":"object","required":["attachments"],"properties":{"internetMessageId":{"type":"string","maxLength":32768},"subject":{"type":"string","maxLength":32768},"from":{"$ref":"../outlook/message-recipient.schema.json"},"to":{"type":"array","items":{"$ref":"../outlook/message-recipient.schema.json"}},"cc":{"type":"array","items":{"$ref":"../outlook/message-recipient.schema.json"}},"sentAtUnixSeconds":{"description":"UTC Unix timestamp in whole seconds.","type":"integer","minimum":-62135596800,"maximum":253402300799},"receivedAtUnixSeconds":{"description":"UTC Unix timestamp in whole seconds.","type":"integer","minimum":-62135596800,"maximum":253402300799},"isDraft":{"description":"True when the message is an unsent draft.","type":"boolean"},"conversationIndex":{"description":"Lowercase hex PidTagConversationIndex; its embedded GUID groups the thread.","type":"string","maxLength":8192},"body":{"$ref":"../outlook/message-body.schema.json"},"attachments":{"type":"array","items":{"$ref":"../outlook/attachment-reference.schema.json"}}},"additionalProperties":true};
const schema84 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/message-recipient.schema.json","title":"OutlookMessageRecipient","description":"One recipient of an Outlook message.","type":"object","properties":{"name":{"description":"Display name, when present.","type":"string","maxLength":4096},"emailAddress":{"description":"SMTP address. Omitted when only a non-routable Exchange address is stored locally.","type":"string","maxLength":4096}},"additionalProperties":true};
const schema87 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/message-body.schema.json","title":"OutlookMessageBody","description":"A message body carried inline in the JSON-RPC result. The sidecar decodes the stored bytes to text using the message code page before sending.","type":"object","required":["contentType","content"],"properties":{"contentType":{"description":"Media type of the body, for example text/html or text/plain.","type":"string","maxLength":256},"content":{"description":"The decoded body text.","type":"string"}},"additionalProperties":true};
const schema88 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/attachment-reference.schema.json","title":"OutlookAttachmentReference","description":"Metadata and inline bytes for one attachment. When the bytes are available they are base64-encoded in contentBytes; otherwise unavailableReason explains why.","type":"object","properties":{"name":{"description":"File name, when present.","type":"string","maxLength":4096},"contentType":{"description":"Media type of the bytes. Embedded messages are reported as message/rfc822.","type":"string","maxLength":256},"size":{"description":"Exact length of the attachment bytes.","type":"integer","minimum":0},"isInline":{"description":"True when the attachment is referenced from the message body by contentId.","type":"boolean"},"contentId":{"description":"Content-ID for an inline attachment, without angle brackets.","type":"string","maxLength":4096},"sha256":{"description":"Lowercase hex SHA-256 of the attachment bytes, useful for de-duplicating attachments repeated across thread messages.","type":"string","pattern":"^[a-f0-9]{64}$"},"contentBytes":{"description":"Base64-encoded attachment bytes, present when the bytes are available.","type":"string"},"unavailableReason":{"description":"Stable code explaining why bytes are not available, present instead of contentBytes. Known values include unsupported_attachment.","type":"string","minLength":1,"maxLength":128}},"additionalProperties":true};
const pattern12 = new RegExp("^[a-f0-9]{64}$", "u");

function validate56(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/outlook/conversation-message.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.attachments === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "attachments"},message:"must have required property '"+"attachments"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.internetMessageId !== undefined){
let data0 = data.internetMessageId;
if(typeof data0 === "string"){
if(func2(data0) > 32768){
const err1 = {instancePath:instancePath+"/internetMessageId",schemaPath:"#/properties/internetMessageId/maxLength",keyword:"maxLength",params:{limit: 32768},message:"must NOT have more than 32768 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
else {
const err2 = {instancePath:instancePath+"/internetMessageId",schemaPath:"#/properties/internetMessageId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.subject !== undefined){
let data1 = data.subject;
if(typeof data1 === "string"){
if(func2(data1) > 32768){
const err3 = {instancePath:instancePath+"/subject",schemaPath:"#/properties/subject/maxLength",keyword:"maxLength",params:{limit: 32768},message:"must NOT have more than 32768 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/subject",schemaPath:"#/properties/subject/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.from !== undefined){
let data2 = data.from;
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(data2.name !== undefined){
let data3 = data2.name;
if(typeof data3 === "string"){
if(func2(data3) > 4096){
const err5 = {instancePath:instancePath+"/from/name",schemaPath:"../outlook/message-recipient.schema.json/properties/name/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/from/name",schemaPath:"../outlook/message-recipient.schema.json/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data2.emailAddress !== undefined){
let data4 = data2.emailAddress;
if(typeof data4 === "string"){
if(func2(data4) > 4096){
const err7 = {instancePath:instancePath+"/from/emailAddress",schemaPath:"../outlook/message-recipient.schema.json/properties/emailAddress/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/from/emailAddress",schemaPath:"../outlook/message-recipient.schema.json/properties/emailAddress/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
}
else {
const err9 = {instancePath:instancePath+"/from",schemaPath:"../outlook/message-recipient.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.to !== undefined){
let data5 = data.to;
if(Array.isArray(data5)){
const len0 = data5.length;
for(let i0=0; i0<len0; i0++){
let data6 = data5[i0];
if(data6 && typeof data6 == "object" && !Array.isArray(data6)){
if(data6.name !== undefined){
let data7 = data6.name;
if(typeof data7 === "string"){
if(func2(data7) > 4096){
const err10 = {instancePath:instancePath+"/to/" + i0+"/name",schemaPath:"../outlook/message-recipient.schema.json/properties/name/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
else {
const err11 = {instancePath:instancePath+"/to/" + i0+"/name",schemaPath:"../outlook/message-recipient.schema.json/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data6.emailAddress !== undefined){
let data8 = data6.emailAddress;
if(typeof data8 === "string"){
if(func2(data8) > 4096){
const err12 = {instancePath:instancePath+"/to/" + i0+"/emailAddress",schemaPath:"../outlook/message-recipient.schema.json/properties/emailAddress/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
else {
const err13 = {instancePath:instancePath+"/to/" + i0+"/emailAddress",schemaPath:"../outlook/message-recipient.schema.json/properties/emailAddress/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
else {
const err14 = {instancePath:instancePath+"/to/" + i0,schemaPath:"../outlook/message-recipient.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
}
else {
const err15 = {instancePath:instancePath+"/to",schemaPath:"#/properties/to/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.cc !== undefined){
let data9 = data.cc;
if(Array.isArray(data9)){
const len1 = data9.length;
for(let i1=0; i1<len1; i1++){
let data10 = data9[i1];
if(data10 && typeof data10 == "object" && !Array.isArray(data10)){
if(data10.name !== undefined){
let data11 = data10.name;
if(typeof data11 === "string"){
if(func2(data11) > 4096){
const err16 = {instancePath:instancePath+"/cc/" + i1+"/name",schemaPath:"../outlook/message-recipient.schema.json/properties/name/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
else {
const err17 = {instancePath:instancePath+"/cc/" + i1+"/name",schemaPath:"../outlook/message-recipient.schema.json/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data10.emailAddress !== undefined){
let data12 = data10.emailAddress;
if(typeof data12 === "string"){
if(func2(data12) > 4096){
const err18 = {instancePath:instancePath+"/cc/" + i1+"/emailAddress",schemaPath:"../outlook/message-recipient.schema.json/properties/emailAddress/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
else {
const err19 = {instancePath:instancePath+"/cc/" + i1+"/emailAddress",schemaPath:"../outlook/message-recipient.schema.json/properties/emailAddress/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
}
else {
const err20 = {instancePath:instancePath+"/cc/" + i1,schemaPath:"../outlook/message-recipient.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
}
else {
const err21 = {instancePath:instancePath+"/cc",schemaPath:"#/properties/cc/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.sentAtUnixSeconds !== undefined){
let data13 = data.sentAtUnixSeconds;
if(!(((typeof data13 == "number") && (!(data13 % 1) && !isNaN(data13))) && (isFinite(data13)))){
const err22 = {instancePath:instancePath+"/sentAtUnixSeconds",schemaPath:"#/properties/sentAtUnixSeconds/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if((typeof data13 == "number") && (isFinite(data13))){
if(data13 > 253402300799 || isNaN(data13)){
const err23 = {instancePath:instancePath+"/sentAtUnixSeconds",schemaPath:"#/properties/sentAtUnixSeconds/maximum",keyword:"maximum",params:{comparison: "<=", limit: 253402300799},message:"must be <= 253402300799"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data13 < -62135596800 || isNaN(data13)){
const err24 = {instancePath:instancePath+"/sentAtUnixSeconds",schemaPath:"#/properties/sentAtUnixSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: -62135596800},message:"must be >= -62135596800"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
}
if(data.receivedAtUnixSeconds !== undefined){
let data14 = data.receivedAtUnixSeconds;
if(!(((typeof data14 == "number") && (!(data14 % 1) && !isNaN(data14))) && (isFinite(data14)))){
const err25 = {instancePath:instancePath+"/receivedAtUnixSeconds",schemaPath:"#/properties/receivedAtUnixSeconds/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if((typeof data14 == "number") && (isFinite(data14))){
if(data14 > 253402300799 || isNaN(data14)){
const err26 = {instancePath:instancePath+"/receivedAtUnixSeconds",schemaPath:"#/properties/receivedAtUnixSeconds/maximum",keyword:"maximum",params:{comparison: "<=", limit: 253402300799},message:"must be <= 253402300799"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(data14 < -62135596800 || isNaN(data14)){
const err27 = {instancePath:instancePath+"/receivedAtUnixSeconds",schemaPath:"#/properties/receivedAtUnixSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: -62135596800},message:"must be >= -62135596800"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
}
if(data.isDraft !== undefined){
if(typeof data.isDraft !== "boolean"){
const err28 = {instancePath:instancePath+"/isDraft",schemaPath:"#/properties/isDraft/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.conversationIndex !== undefined){
let data16 = data.conversationIndex;
if(typeof data16 === "string"){
if(func2(data16) > 8192){
const err29 = {instancePath:instancePath+"/conversationIndex",schemaPath:"#/properties/conversationIndex/maxLength",keyword:"maxLength",params:{limit: 8192},message:"must NOT have more than 8192 characters"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
else {
const err30 = {instancePath:instancePath+"/conversationIndex",schemaPath:"#/properties/conversationIndex/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.body !== undefined){
let data17 = data.body;
if(data17 && typeof data17 == "object" && !Array.isArray(data17)){
if(data17.contentType === undefined){
const err31 = {instancePath:instancePath+"/body",schemaPath:"../outlook/message-body.schema.json/required",keyword:"required",params:{missingProperty: "contentType"},message:"must have required property '"+"contentType"+"'"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(data17.content === undefined){
const err32 = {instancePath:instancePath+"/body",schemaPath:"../outlook/message-body.schema.json/required",keyword:"required",params:{missingProperty: "content"},message:"must have required property '"+"content"+"'"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(data17.contentType !== undefined){
let data18 = data17.contentType;
if(typeof data18 === "string"){
if(func2(data18) > 256){
const err33 = {instancePath:instancePath+"/body/contentType",schemaPath:"../outlook/message-body.schema.json/properties/contentType/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
else {
const err34 = {instancePath:instancePath+"/body/contentType",schemaPath:"../outlook/message-body.schema.json/properties/contentType/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
if(data17.content !== undefined){
if(typeof data17.content !== "string"){
const err35 = {instancePath:instancePath+"/body/content",schemaPath:"../outlook/message-body.schema.json/properties/content/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
}
else {
const err36 = {instancePath:instancePath+"/body",schemaPath:"../outlook/message-body.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
if(data.attachments !== undefined){
let data20 = data.attachments;
if(Array.isArray(data20)){
const len2 = data20.length;
for(let i2=0; i2<len2; i2++){
let data21 = data20[i2];
if(data21 && typeof data21 == "object" && !Array.isArray(data21)){
if(data21.name !== undefined){
let data22 = data21.name;
if(typeof data22 === "string"){
if(func2(data22) > 4096){
const err37 = {instancePath:instancePath+"/attachments/" + i2+"/name",schemaPath:"../outlook/attachment-reference.schema.json/properties/name/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
else {
const err38 = {instancePath:instancePath+"/attachments/" + i2+"/name",schemaPath:"../outlook/attachment-reference.schema.json/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
}
if(data21.contentType !== undefined){
let data23 = data21.contentType;
if(typeof data23 === "string"){
if(func2(data23) > 256){
const err39 = {instancePath:instancePath+"/attachments/" + i2+"/contentType",schemaPath:"../outlook/attachment-reference.schema.json/properties/contentType/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
else {
const err40 = {instancePath:instancePath+"/attachments/" + i2+"/contentType",schemaPath:"../outlook/attachment-reference.schema.json/properties/contentType/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
if(data21.size !== undefined){
let data24 = data21.size;
if(!(((typeof data24 == "number") && (!(data24 % 1) && !isNaN(data24))) && (isFinite(data24)))){
const err41 = {instancePath:instancePath+"/attachments/" + i2+"/size",schemaPath:"../outlook/attachment-reference.schema.json/properties/size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
if((typeof data24 == "number") && (isFinite(data24))){
if(data24 < 0 || isNaN(data24)){
const err42 = {instancePath:instancePath+"/attachments/" + i2+"/size",schemaPath:"../outlook/attachment-reference.schema.json/properties/size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
}
if(data21.isInline !== undefined){
if(typeof data21.isInline !== "boolean"){
const err43 = {instancePath:instancePath+"/attachments/" + i2+"/isInline",schemaPath:"../outlook/attachment-reference.schema.json/properties/isInline/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
if(data21.contentId !== undefined){
let data26 = data21.contentId;
if(typeof data26 === "string"){
if(func2(data26) > 4096){
const err44 = {instancePath:instancePath+"/attachments/" + i2+"/contentId",schemaPath:"../outlook/attachment-reference.schema.json/properties/contentId/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
else {
const err45 = {instancePath:instancePath+"/attachments/" + i2+"/contentId",schemaPath:"../outlook/attachment-reference.schema.json/properties/contentId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
if(data21.sha256 !== undefined){
let data27 = data21.sha256;
if(typeof data27 === "string"){
if(!pattern12.test(data27)){
const err46 = {instancePath:instancePath+"/attachments/" + i2+"/sha256",schemaPath:"../outlook/attachment-reference.schema.json/properties/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
}
else {
const err47 = {instancePath:instancePath+"/attachments/" + i2+"/sha256",schemaPath:"../outlook/attachment-reference.schema.json/properties/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
}
if(data21.contentBytes !== undefined){
if(typeof data21.contentBytes !== "string"){
const err48 = {instancePath:instancePath+"/attachments/" + i2+"/contentBytes",schemaPath:"../outlook/attachment-reference.schema.json/properties/contentBytes/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
if(data21.unavailableReason !== undefined){
let data29 = data21.unavailableReason;
if(typeof data29 === "string"){
if(func2(data29) > 128){
const err49 = {instancePath:instancePath+"/attachments/" + i2+"/unavailableReason",schemaPath:"../outlook/attachment-reference.schema.json/properties/unavailableReason/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
if(func2(data29) < 1){
const err50 = {instancePath:instancePath+"/attachments/" + i2+"/unavailableReason",schemaPath:"../outlook/attachment-reference.schema.json/properties/unavailableReason/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
else {
const err51 = {instancePath:instancePath+"/attachments/" + i2+"/unavailableReason",schemaPath:"../outlook/attachment-reference.schema.json/properties/unavailableReason/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
}
else {
const err52 = {instancePath:instancePath+"/attachments/" + i2,schemaPath:"../outlook/attachment-reference.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err52];
}
else {
vErrors.push(err52);
}
errors++;
}
}
}
else {
const err53 = {instancePath:instancePath+"/attachments",schemaPath:"#/properties/attachments/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
}
else {
const err54 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
validate56.errors = vErrors;
return errors === 0;
}


function validate55(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-get-conversation-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.state === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.messages === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "messages"},message:"must have required property '"+"messages"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.state !== undefined){
let data0 = data.state;
if(typeof data0 === "string"){
if(func2(data0) > 32){
const err2 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/maxLength",keyword:"maxLength",params:{limit: 32},message:"must NOT have more than 32 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data0) < 1){
const err3 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.mailbox !== undefined){
let data1 = data.mailbox;
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.id === undefined){
const err5 = {instancePath:instancePath+"/mailbox",schemaPath:"../outlook/mailbox.schema.json/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.displayName === undefined){
const err6 = {instancePath:instancePath+"/mailbox",schemaPath:"../outlook/mailbox.schema.json/required",keyword:"required",params:{missingProperty: "displayName"},message:"must have required property '"+"displayName"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.source === undefined){
const err7 = {instancePath:instancePath+"/mailbox",schemaPath:"../outlook/mailbox.schema.json/required",keyword:"required",params:{missingProperty: "source"},message:"must have required property '"+"source"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.id !== undefined){
let data2 = data1.id;
if(typeof data2 === "string"){
if(!pattern7.test(data2)){
const err8 = {instancePath:instancePath+"/mailbox/id",schemaPath:"../outlook/mailbox.schema.json/properties/id/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{32}$"},message:"must match pattern \""+"^[0-9a-f]{32}$"+"\""};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/mailbox/id",schemaPath:"../outlook/mailbox.schema.json/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data1.displayName !== undefined){
let data3 = data1.displayName;
if(typeof data3 === "string"){
if(func2(data3) > 1024){
const err10 = {instancePath:instancePath+"/mailbox/displayName",schemaPath:"../outlook/mailbox.schema.json/properties/displayName/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func2(data3) < 1){
const err11 = {instancePath:instancePath+"/mailbox/displayName",schemaPath:"../outlook/mailbox.schema.json/properties/displayName/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/mailbox/displayName",schemaPath:"../outlook/mailbox.schema.json/properties/displayName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data1.emailAddress !== undefined){
let data4 = data1.emailAddress;
if(typeof data4 === "string"){
if(func2(data4) > 1024){
const err13 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"../outlook/mailbox.schema.json/properties/emailAddress/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func2(data4) < 1){
const err14 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"../outlook/mailbox.schema.json/properties/emailAddress/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"../outlook/mailbox.schema.json/properties/emailAddress/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data1.profileName !== undefined){
let data5 = data1.profileName;
if(typeof data5 === "string"){
if(func2(data5) > 1024){
const err16 = {instancePath:instancePath+"/mailbox/profileName",schemaPath:"../outlook/mailbox.schema.json/properties/profileName/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func2(data5) < 1){
const err17 = {instancePath:instancePath+"/mailbox/profileName",schemaPath:"../outlook/mailbox.schema.json/properties/profileName/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
else {
const err18 = {instancePath:instancePath+"/mailbox/profileName",schemaPath:"../outlook/mailbox.schema.json/properties/profileName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data1.source !== undefined){
let data6 = data1.source;
if(typeof data6 === "string"){
if(func2(data6) > 128){
const err19 = {instancePath:instancePath+"/mailbox/source",schemaPath:"../outlook/mailbox.schema.json/properties/source/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(func2(data6) < 1){
const err20 = {instancePath:instancePath+"/mailbox/source",schemaPath:"../outlook/mailbox.schema.json/properties/source/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/mailbox/source",schemaPath:"../outlook/mailbox.schema.json/properties/source/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
}
else {
const err22 = {instancePath:instancePath+"/mailbox",schemaPath:"../outlook/mailbox.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data.messages !== undefined){
let data7 = data.messages;
if(Array.isArray(data7)){
const len0 = data7.length;
for(let i0=0; i0<len0; i0++){
if(!(validate56(data7[i0], {instancePath:instancePath+"/messages/" + i0,parentData:data7,parentDataProperty:i0,rootData}))){
vErrors = vErrors === null ? validate56.errors : vErrors.concat(validate56.errors);
errors = vErrors.length;
}
}
}
else {
const err23 = {instancePath:instancePath+"/messages",schemaPath:"#/properties/messages/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.warnings !== undefined){
let data9 = data.warnings;
if(Array.isArray(data9)){
const len1 = data9.length;
for(let i1=0; i1<len1; i1++){
let data10 = data9[i1];
if(data10 && typeof data10 == "object" && !Array.isArray(data10)){
if(data10.code === undefined){
const err24 = {instancePath:instancePath+"/warnings/" + i1,schemaPath:"../outlook/conversation-warning.schema.json/required",keyword:"required",params:{missingProperty: "code"},message:"must have required property '"+"code"+"'"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data10.code !== undefined){
let data11 = data10.code;
if(typeof data11 === "string"){
if(func2(data11) > 128){
const err25 = {instancePath:instancePath+"/warnings/" + i1+"/code",schemaPath:"../outlook/conversation-warning.schema.json/properties/code/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(func2(data11) < 1){
const err26 = {instancePath:instancePath+"/warnings/" + i1+"/code",schemaPath:"../outlook/conversation-warning.schema.json/properties/code/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
else {
const err27 = {instancePath:instancePath+"/warnings/" + i1+"/code",schemaPath:"../outlook/conversation-warning.schema.json/properties/code/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data10.message !== undefined){
let data12 = data10.message;
if(typeof data12 === "string"){
if(func2(data12) > 4096){
const err28 = {instancePath:instancePath+"/warnings/" + i1+"/message",schemaPath:"../outlook/conversation-warning.schema.json/properties/message/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if(func2(data12) < 1){
const err29 = {instancePath:instancePath+"/warnings/" + i1+"/message",schemaPath:"../outlook/conversation-warning.schema.json/properties/message/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
else {
const err30 = {instancePath:instancePath+"/warnings/" + i1+"/message",schemaPath:"../outlook/conversation-warning.schema.json/properties/message/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data10.internetMessageId !== undefined){
let data13 = data10.internetMessageId;
if(typeof data13 === "string"){
if(func2(data13) > 32768){
const err31 = {instancePath:instancePath+"/warnings/" + i1+"/internetMessageId",schemaPath:"../outlook/conversation-warning.schema.json/properties/internetMessageId/maxLength",keyword:"maxLength",params:{limit: 32768},message:"must NOT have more than 32768 characters"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
else {
const err32 = {instancePath:instancePath+"/warnings/" + i1+"/internetMessageId",schemaPath:"../outlook/conversation-warning.schema.json/properties/internetMessageId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
}
else {
const err33 = {instancePath:instancePath+"/warnings/" + i1,schemaPath:"../outlook/conversation-warning.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
}
else {
const err34 = {instancePath:instancePath+"/warnings",schemaPath:"#/properties/warnings/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
}
else {
const err35 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
validate55.errors = vErrors;
return errors === 0;
}

export const validateSidecarProgressV1Params = validate58;
const schema90 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-progress-v1-params.schema.json","title":"SidecarProgressV1Params","description":"Names the pending request whose on-device progress the client wants to observe. The request is identified by the JSON-RPC request ID the client generated for it; visibility is scoped to the Origin that issued that request.","type":"object","required":["requestId"],"properties":{"requestId":{"$ref":"../common.schema.json#/definitions/RequestId"}},"additionalProperties":true};

function validate58(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-progress-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.requestId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "requestId"},message:"must have required property '"+"requestId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.requestId !== undefined){
let data0 = data.requestId;
const _errs4 = errors;
let valid2 = false;
let passing0 = null;
const _errs5 = errors;
if(typeof data0 === "string"){
if(func2(data0) > 128){
const err1 = {instancePath:instancePath+"/requestId",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(func2(data0) < 1){
const err2 = {instancePath:instancePath+"/requestId",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
else {
const err3 = {instancePath:instancePath+"/requestId",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
var _valid0 = _errs5 === errors;
if(_valid0){
valid2 = true;
passing0 = 0;
}
const _errs7 = errors;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err4 = {instancePath:instancePath+"/requestId",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf/1/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
var _valid0 = _errs7 === errors;
if(_valid0 && valid2){
valid2 = false;
passing0 = [passing0, 1];
}
else {
if(_valid0){
valid2 = true;
passing0 = 1;
}
}
if(!valid2){
const err5 = {instancePath:instancePath+"/requestId",schemaPath:"../common.schema.json#/definitions/RequestId/oneOf",keyword:"oneOf",params:{passingSchemas: passing0},message:"must match exactly one schema in oneOf"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
else {
errors = _errs4;
if(vErrors !== null){
if(_errs4){
vErrors.length = _errs4;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err6 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
validate58.errors = vErrors;
return errors === 0;
}

export const validateSidecarProgressV1Result = validate59;
const schema92 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-progress-v1-result.schema.json","title":"SidecarProgressV1Result","description":"A point-in-time view of one request's on-device progress. `trace` carries the same append-only event log a result may embed, so a client that applies steps by `sequence` (last one wins) renders a polled log and a complete log identically.","type":"object","required":["state"],"properties":{"state":{"description":"Where the named request is in its lifecycle. Known values are running, finished, and unknown. Receivers treat unrecognized values as running.","type":"string","minLength":1,"maxLength":64},"trace":{"description":"The sidecar's step log for the named request so far. Metadata only — never message content. Absent when the request is unknown or recorded no steps.","$ref":"../outlook/local-trace.schema.json"}},"additionalProperties":true};
const schema93 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/local-trace.schema.json","title":"SidecarLocalTrace","description":"The sidecar's internal on-device steps for one request, as an append-only event log. Protocol 1.0 delivers the whole log with the result; a future delivery mode may append to it incrementally, and a client that applies steps by `sequence` (last one wins) renders both identically. Contains no message content, so it can be shown even when the user declines to share the result.","type":"object","required":["steps"],"properties":{"steps":{"type":"array","items":{"$ref":"../outlook/local-trace-step.schema.json"},"maxItems":32},"totalDurationMs":{"type":"integer","minimum":0}},"additionalProperties":true};
const schema94 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/local-trace-step.schema.json","title":"SidecarLocalTraceStep","description":"One internal on-device processing step, shaped as an event: a stable `sequence` identity carrying a status that may evolve. Metadata only: never message content, snippets, or file names.","type":"object","required":["sequence","id","status"],"properties":{"sequence":{"description":"Stable identity of this step within the request, and its ordering key. A later step with the same sequence supersedes an earlier one, so the same payload works whether the log arrives complete or is appended to over time.","type":"integer","minimum":0},"id":{"description":"Step identifier. Known values include expandQuery, buildIndex, match, and summarize. Receivers ignore unknown values and render them by their raw id.","type":"string","minLength":1,"maxLength":128},"status":{"description":"Step outcome. Known values include running, ok, skipped, degraded, and error. Receivers treat unknown values as running.","type":"string","minLength":1,"maxLength":64},"parentSequence":{"description":"Sequence of the step this one runs inside, when the sidecar nests work (for example a tool call made during a local model turn). Absent for top-level steps.","type":"integer","minimum":0},"startedAtOffsetMs":{"description":"Milliseconds between the start of the request and the start of this step, so a client can order and place steps identically in both delivery modes.","type":"integer","minimum":0},"durationMs":{"type":"integer","minimum":0},"model":{"description":"Identifier of the local model this step used, when it used one.","type":"string","minLength":1,"maxLength":256},"cacheHit":{"description":"Whether this step was served from a local cache (for example the in-memory mailbox index).","type":"boolean"},"detail":{"description":"Short non-sensitive note — the sidecar's counterpart of a progress message: why a step was skipped or degraded, or what it is doing.","type":"string","maxLength":512},"counts":{"description":"Item counts keyed by an open string. Known keys include keywordsIn, keywordsOut, messagesScanned, matched, and hitsReturned.","type":"object","maxProperties":16,"additionalProperties":{"type":"integer","minimum":0}}},"additionalProperties":true};

function validate60(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/outlook/local-trace.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.steps === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "steps"},message:"must have required property '"+"steps"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.steps !== undefined){
let data0 = data.steps;
if(Array.isArray(data0)){
if(data0.length > 32){
const err1 = {instancePath:instancePath+"/steps",schemaPath:"#/properties/steps/maxItems",keyword:"maxItems",params:{limit: 32},message:"must NOT have more than 32 items"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.sequence === undefined){
const err2 = {instancePath:instancePath+"/steps/" + i0,schemaPath:"../outlook/local-trace-step.schema.json/required",keyword:"required",params:{missingProperty: "sequence"},message:"must have required property '"+"sequence"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data1.id === undefined){
const err3 = {instancePath:instancePath+"/steps/" + i0,schemaPath:"../outlook/local-trace-step.schema.json/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data1.status === undefined){
const err4 = {instancePath:instancePath+"/steps/" + i0,schemaPath:"../outlook/local-trace-step.schema.json/required",keyword:"required",params:{missingProperty: "status"},message:"must have required property '"+"status"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.sequence !== undefined){
let data2 = data1.sequence;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err5 = {instancePath:instancePath+"/steps/" + i0+"/sequence",schemaPath:"../outlook/local-trace-step.schema.json/properties/sequence/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err6 = {instancePath:instancePath+"/steps/" + i0+"/sequence",schemaPath:"../outlook/local-trace-step.schema.json/properties/sequence/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
}
if(data1.id !== undefined){
let data3 = data1.id;
if(typeof data3 === "string"){
if(func2(data3) > 128){
const err7 = {instancePath:instancePath+"/steps/" + i0+"/id",schemaPath:"../outlook/local-trace-step.schema.json/properties/id/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func2(data3) < 1){
const err8 = {instancePath:instancePath+"/steps/" + i0+"/id",schemaPath:"../outlook/local-trace-step.schema.json/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/steps/" + i0+"/id",schemaPath:"../outlook/local-trace-step.schema.json/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data1.status !== undefined){
let data4 = data1.status;
if(typeof data4 === "string"){
if(func2(data4) > 64){
const err10 = {instancePath:instancePath+"/steps/" + i0+"/status",schemaPath:"../outlook/local-trace-step.schema.json/properties/status/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func2(data4) < 1){
const err11 = {instancePath:instancePath+"/steps/" + i0+"/status",schemaPath:"../outlook/local-trace-step.schema.json/properties/status/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/steps/" + i0+"/status",schemaPath:"../outlook/local-trace-step.schema.json/properties/status/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data1.parentSequence !== undefined){
let data5 = data1.parentSequence;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err13 = {instancePath:instancePath+"/steps/" + i0+"/parentSequence",schemaPath:"../outlook/local-trace-step.schema.json/properties/parentSequence/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 < 0 || isNaN(data5)){
const err14 = {instancePath:instancePath+"/steps/" + i0+"/parentSequence",schemaPath:"../outlook/local-trace-step.schema.json/properties/parentSequence/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
}
if(data1.startedAtOffsetMs !== undefined){
let data6 = data1.startedAtOffsetMs;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err15 = {instancePath:instancePath+"/steps/" + i0+"/startedAtOffsetMs",schemaPath:"../outlook/local-trace-step.schema.json/properties/startedAtOffsetMs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 < 0 || isNaN(data6)){
const err16 = {instancePath:instancePath+"/steps/" + i0+"/startedAtOffsetMs",schemaPath:"../outlook/local-trace-step.schema.json/properties/startedAtOffsetMs/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
}
if(data1.durationMs !== undefined){
let data7 = data1.durationMs;
if(!(((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7))) && (isFinite(data7)))){
const err17 = {instancePath:instancePath+"/steps/" + i0+"/durationMs",schemaPath:"../outlook/local-trace-step.schema.json/properties/durationMs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if((typeof data7 == "number") && (isFinite(data7))){
if(data7 < 0 || isNaN(data7)){
const err18 = {instancePath:instancePath+"/steps/" + i0+"/durationMs",schemaPath:"../outlook/local-trace-step.schema.json/properties/durationMs/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
if(data1.model !== undefined){
let data8 = data1.model;
if(typeof data8 === "string"){
if(func2(data8) > 256){
const err19 = {instancePath:instancePath+"/steps/" + i0+"/model",schemaPath:"../outlook/local-trace-step.schema.json/properties/model/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(func2(data8) < 1){
const err20 = {instancePath:instancePath+"/steps/" + i0+"/model",schemaPath:"../outlook/local-trace-step.schema.json/properties/model/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
else {
const err21 = {instancePath:instancePath+"/steps/" + i0+"/model",schemaPath:"../outlook/local-trace-step.schema.json/properties/model/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data1.cacheHit !== undefined){
if(typeof data1.cacheHit !== "boolean"){
const err22 = {instancePath:instancePath+"/steps/" + i0+"/cacheHit",schemaPath:"../outlook/local-trace-step.schema.json/properties/cacheHit/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data1.detail !== undefined){
let data10 = data1.detail;
if(typeof data10 === "string"){
if(func2(data10) > 512){
const err23 = {instancePath:instancePath+"/steps/" + i0+"/detail",schemaPath:"../outlook/local-trace-step.schema.json/properties/detail/maxLength",keyword:"maxLength",params:{limit: 512},message:"must NOT have more than 512 characters"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
else {
const err24 = {instancePath:instancePath+"/steps/" + i0+"/detail",schemaPath:"../outlook/local-trace-step.schema.json/properties/detail/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data1.counts !== undefined){
let data11 = data1.counts;
if(data11 && typeof data11 == "object" && !Array.isArray(data11)){
if(Object.keys(data11).length > 16){
const err25 = {instancePath:instancePath+"/steps/" + i0+"/counts",schemaPath:"../outlook/local-trace-step.schema.json/properties/counts/maxProperties",keyword:"maxProperties",params:{limit: 16},message:"must NOT have more than 16 properties"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
for(const key0 in data11){
let data12 = data11[key0];
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err26 = {instancePath:instancePath+"/steps/" + i0+"/counts/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"../outlook/local-trace-step.schema.json/properties/counts/additionalProperties/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if((typeof data12 == "number") && (isFinite(data12))){
if(data12 < 0 || isNaN(data12)){
const err27 = {instancePath:instancePath+"/steps/" + i0+"/counts/" + key0.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"../outlook/local-trace-step.schema.json/properties/counts/additionalProperties/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
}
}
else {
const err28 = {instancePath:instancePath+"/steps/" + i0+"/counts",schemaPath:"../outlook/local-trace-step.schema.json/properties/counts/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
}
else {
const err29 = {instancePath:instancePath+"/steps/" + i0,schemaPath:"../outlook/local-trace-step.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
}
else {
const err30 = {instancePath:instancePath+"/steps",schemaPath:"#/properties/steps/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data.totalDurationMs !== undefined){
let data13 = data.totalDurationMs;
if(!(((typeof data13 == "number") && (!(data13 % 1) && !isNaN(data13))) && (isFinite(data13)))){
const err31 = {instancePath:instancePath+"/totalDurationMs",schemaPath:"#/properties/totalDurationMs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if((typeof data13 == "number") && (isFinite(data13))){
if(data13 < 0 || isNaN(data13)){
const err32 = {instancePath:instancePath+"/totalDurationMs",schemaPath:"#/properties/totalDurationMs/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
}
}
else {
const err33 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
validate60.errors = vErrors;
return errors === 0;
}


function validate59(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-progress-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.state === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.state !== undefined){
let data0 = data.state;
if(typeof data0 === "string"){
if(func2(data0) > 64){
const err1 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/maxLength",keyword:"maxLength",params:{limit: 64},message:"must NOT have more than 64 characters"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(func2(data0) < 1){
const err2 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
else {
const err3 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.trace !== undefined){
if(!(validate60(data.trace, {instancePath:instancePath+"/trace",parentData:data,parentDataProperty:"trace",rootData}))){
vErrors = vErrors === null ? validate60.errors : vErrors.concat(validate60.errors);
errors = vErrors.length;
}
}
}
else {
const err4 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
validate59.errors = vErrors;
return errors === 0;
}

export const validateOutlookSearchEmailsV1Params = validate62;
const schema95 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-search-emails-v1-params.schema.json","title":"OutlookSearchEmailsV1Params","type":"object","required":["mailboxId","query"],"properties":{"mailboxId":{"description":"Short opaque identifier returned by outlook.list_mailboxes.v1.","type":"string","pattern":"^[0-9a-f]{32}$"},"query":{"description":"Natural-language or keyword query. The sidecar may expand it into additional local search terms.","type":"string","minLength":1,"maxLength":1024},"limit":{"description":"Maximum number of hits to return. Defaults to 10.","type":"integer","minimum":1,"maximum":50},"includeAttachments":{"description":"Also match against attachment file names and locally extractable attachment text. Defaults to true.","type":"boolean"},"summarize":{"description":"Produce a locally generated plain-text summary of the hits when a local model is configured. Defaults to true.","type":"boolean"}},"additionalProperties":true};

function validate62(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-search-emails-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.mailboxId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mailboxId"},message:"must have required property '"+"mailboxId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.query === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "query"},message:"must have required property '"+"query"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.mailboxId !== undefined){
let data0 = data.mailboxId;
if(typeof data0 === "string"){
if(!pattern7.test(data0)){
const err2 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{32}$"},message:"must match pattern \""+"^[0-9a-f]{32}$"+"\""};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
else {
const err3 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.query !== undefined){
let data1 = data.query;
if(typeof data1 === "string"){
if(func2(data1) > 1024){
const err4 = {instancePath:instancePath+"/query",schemaPath:"#/properties/query/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(func2(data1) < 1){
const err5 = {instancePath:instancePath+"/query",schemaPath:"#/properties/query/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/query",schemaPath:"#/properties/query/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.limit !== undefined){
let data2 = data.limit;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err7 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 > 50 || isNaN(data2)){
const err8 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 50},message:"must be <= 50"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data2 < 1 || isNaN(data2)){
const err9 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
}
if(data.includeAttachments !== undefined){
if(typeof data.includeAttachments !== "boolean"){
const err10 = {instancePath:instancePath+"/includeAttachments",schemaPath:"#/properties/includeAttachments/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.summarize !== undefined){
if(typeof data.summarize !== "boolean"){
const err11 = {instancePath:instancePath+"/summarize",schemaPath:"#/properties/summarize/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
}
else {
const err12 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
validate62.errors = vErrors;
return errors === 0;
}

export const validateOutlookSearchEmailsV1Result = validate63;
const schema96 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-search-emails-v1-result.schema.json","title":"OutlookSearchEmailsV1Result","description":"Locally matched emails for a query, with an optional locally generated summary. Search and summarization both run entirely on the device.","type":"object","required":["mailbox","hits"],"properties":{"mailbox":{"$ref":"../outlook/mailbox.schema.json"},"hits":{"type":"array","items":{"$ref":"../outlook/search-hit.schema.json"},"maxItems":50},"totalMatched":{"description":"Number of matching messages before the limit was applied.","type":"integer","minimum":0},"summary":{"description":"Plain-text summary of the hits generated by a local model. Absent when summarization was not requested or no local model is available.","type":"string","maxLength":32768},"summaryModel":{"description":"Identifier of the local model that generated the summary, for user-facing transparency.","type":"string","minLength":1,"maxLength":256},"expandedKeywords":{"description":"Search terms actually used after local query expansion.","type":"array","items":{"type":"string","minLength":1,"maxLength":256},"maxItems":32},"warnings":{"description":"Local sources or messages that could not be inspected without hiding successful results.","type":"array","items":{"$ref":"../outlook/listing-warning.schema.json"}},"trace":{"description":"Metadata about the sidecar's internal on-device steps (durations, models, item counts). Never contains message content.","$ref":"../outlook/local-trace.schema.json"}},"additionalProperties":true};
const schema98 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/search-hit.schema.json","title":"OutlookSearchHit","description":"One locally matched email for an outlook.search_emails.v1 query.","type":"object","required":["email"],"properties":{"email":{"$ref":"../outlook/email-summary.schema.json"},"snippet":{"description":"Short plain-text excerpt around the strongest match. Never a full message body.","type":"string","maxLength":2048},"matchedIn":{"description":"Fields the query matched. Known values include subject, body, sender, attachmentName, and attachmentContent. Receivers ignore unknown values.","type":"array","items":{"type":"string","minLength":1,"maxLength":128},"maxItems":16},"matchedAttachmentNames":{"description":"File names of attachments whose name or extracted text matched the query.","type":"array","items":{"type":"string","minLength":1,"maxLength":1024},"maxItems":64}},"additionalProperties":true};

function validate64(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/outlook/search-hit.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.email === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "email"},message:"must have required property '"+"email"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.email !== undefined){
let data0 = data.email;
if(data0 && typeof data0 == "object" && !Array.isArray(data0)){
if(data0.id === undefined){
const err1 = {instancePath:instancePath+"/email",schemaPath:"../outlook/email-summary.schema.json/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data0.id !== undefined){
let data1 = data0.id;
if(typeof data1 === "string"){
if(func2(data1) > 32768){
const err2 = {instancePath:instancePath+"/email/id",schemaPath:"../outlook/email-summary.schema.json/properties/id/maxLength",keyword:"maxLength",params:{limit: 32768},message:"must NOT have more than 32768 characters"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(func2(data1) < 1){
const err3 = {instancePath:instancePath+"/email/id",schemaPath:"../outlook/email-summary.schema.json/properties/id/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
else {
const err4 = {instancePath:instancePath+"/email/id",schemaPath:"../outlook/email-summary.schema.json/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data0.subject !== undefined){
let data2 = data0.subject;
if(typeof data2 === "string"){
if(func2(data2) > 32768){
const err5 = {instancePath:instancePath+"/email/subject",schemaPath:"../outlook/email-summary.schema.json/properties/subject/maxLength",keyword:"maxLength",params:{limit: 32768},message:"must NOT have more than 32768 characters"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/email/subject",schemaPath:"../outlook/email-summary.schema.json/properties/subject/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data0.senderName !== undefined){
let data3 = data0.senderName;
if(typeof data3 === "string"){
if(func2(data3) > 4096){
const err7 = {instancePath:instancePath+"/email/senderName",schemaPath:"../outlook/email-summary.schema.json/properties/senderName/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
else {
const err8 = {instancePath:instancePath+"/email/senderName",schemaPath:"../outlook/email-summary.schema.json/properties/senderName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data0.senderEmailAddress !== undefined){
let data4 = data0.senderEmailAddress;
if(typeof data4 === "string"){
if(func2(data4) > 4096){
const err9 = {instancePath:instancePath+"/email/senderEmailAddress",schemaPath:"../outlook/email-summary.schema.json/properties/senderEmailAddress/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
else {
const err10 = {instancePath:instancePath+"/email/senderEmailAddress",schemaPath:"../outlook/email-summary.schema.json/properties/senderEmailAddress/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data0.receivedAtUnixSeconds !== undefined){
let data5 = data0.receivedAtUnixSeconds;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err11 = {instancePath:instancePath+"/email/receivedAtUnixSeconds",schemaPath:"../outlook/email-summary.schema.json/properties/receivedAtUnixSeconds/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 > 253402300799 || isNaN(data5)){
const err12 = {instancePath:instancePath+"/email/receivedAtUnixSeconds",schemaPath:"../outlook/email-summary.schema.json/properties/receivedAtUnixSeconds/maximum",keyword:"maximum",params:{comparison: "<=", limit: 253402300799},message:"must be <= 253402300799"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data5 < -62135596800 || isNaN(data5)){
const err13 = {instancePath:instancePath+"/email/receivedAtUnixSeconds",schemaPath:"../outlook/email-summary.schema.json/properties/receivedAtUnixSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: -62135596800},message:"must be >= -62135596800"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
}
if(data0.internetMessageId !== undefined){
let data6 = data0.internetMessageId;
if(typeof data6 === "string"){
if(func2(data6) > 32768){
const err14 = {instancePath:instancePath+"/email/internetMessageId",schemaPath:"../outlook/email-summary.schema.json/properties/internetMessageId/maxLength",keyword:"maxLength",params:{limit: 32768},message:"must NOT have more than 32768 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/email/internetMessageId",schemaPath:"../outlook/email-summary.schema.json/properties/internetMessageId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
}
else {
const err16 = {instancePath:instancePath+"/email",schemaPath:"../outlook/email-summary.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data.snippet !== undefined){
let data7 = data.snippet;
if(typeof data7 === "string"){
if(func2(data7) > 2048){
const err17 = {instancePath:instancePath+"/snippet",schemaPath:"#/properties/snippet/maxLength",keyword:"maxLength",params:{limit: 2048},message:"must NOT have more than 2048 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
else {
const err18 = {instancePath:instancePath+"/snippet",schemaPath:"#/properties/snippet/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.matchedIn !== undefined){
let data8 = data.matchedIn;
if(Array.isArray(data8)){
if(data8.length > 16){
const err19 = {instancePath:instancePath+"/matchedIn",schemaPath:"#/properties/matchedIn/maxItems",keyword:"maxItems",params:{limit: 16},message:"must NOT have more than 16 items"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
const len0 = data8.length;
for(let i0=0; i0<len0; i0++){
let data9 = data8[i0];
if(typeof data9 === "string"){
if(func2(data9) > 128){
const err20 = {instancePath:instancePath+"/matchedIn/" + i0,schemaPath:"#/properties/matchedIn/items/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(func2(data9) < 1){
const err21 = {instancePath:instancePath+"/matchedIn/" + i0,schemaPath:"#/properties/matchedIn/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
else {
const err22 = {instancePath:instancePath+"/matchedIn/" + i0,schemaPath:"#/properties/matchedIn/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
}
else {
const err23 = {instancePath:instancePath+"/matchedIn",schemaPath:"#/properties/matchedIn/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.matchedAttachmentNames !== undefined){
let data10 = data.matchedAttachmentNames;
if(Array.isArray(data10)){
if(data10.length > 64){
const err24 = {instancePath:instancePath+"/matchedAttachmentNames",schemaPath:"#/properties/matchedAttachmentNames/maxItems",keyword:"maxItems",params:{limit: 64},message:"must NOT have more than 64 items"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
const len1 = data10.length;
for(let i1=0; i1<len1; i1++){
let data11 = data10[i1];
if(typeof data11 === "string"){
if(func2(data11) > 1024){
const err25 = {instancePath:instancePath+"/matchedAttachmentNames/" + i1,schemaPath:"#/properties/matchedAttachmentNames/items/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if(func2(data11) < 1){
const err26 = {instancePath:instancePath+"/matchedAttachmentNames/" + i1,schemaPath:"#/properties/matchedAttachmentNames/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
else {
const err27 = {instancePath:instancePath+"/matchedAttachmentNames/" + i1,schemaPath:"#/properties/matchedAttachmentNames/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
}
else {
const err28 = {instancePath:instancePath+"/matchedAttachmentNames",schemaPath:"#/properties/matchedAttachmentNames/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
}
else {
const err29 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
validate64.errors = vErrors;
return errors === 0;
}


function validate63(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-search-emails-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.mailbox === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mailbox"},message:"must have required property '"+"mailbox"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.hits === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "hits"},message:"must have required property '"+"hits"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.mailbox !== undefined){
let data0 = data.mailbox;
if(data0 && typeof data0 == "object" && !Array.isArray(data0)){
if(data0.id === undefined){
const err2 = {instancePath:instancePath+"/mailbox",schemaPath:"../outlook/mailbox.schema.json/required",keyword:"required",params:{missingProperty: "id"},message:"must have required property '"+"id"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data0.displayName === undefined){
const err3 = {instancePath:instancePath+"/mailbox",schemaPath:"../outlook/mailbox.schema.json/required",keyword:"required",params:{missingProperty: "displayName"},message:"must have required property '"+"displayName"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data0.source === undefined){
const err4 = {instancePath:instancePath+"/mailbox",schemaPath:"../outlook/mailbox.schema.json/required",keyword:"required",params:{missingProperty: "source"},message:"must have required property '"+"source"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data0.id !== undefined){
let data1 = data0.id;
if(typeof data1 === "string"){
if(!pattern7.test(data1)){
const err5 = {instancePath:instancePath+"/mailbox/id",schemaPath:"../outlook/mailbox.schema.json/properties/id/pattern",keyword:"pattern",params:{pattern: "^[0-9a-f]{32}$"},message:"must match pattern \""+"^[0-9a-f]{32}$"+"\""};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
else {
const err6 = {instancePath:instancePath+"/mailbox/id",schemaPath:"../outlook/mailbox.schema.json/properties/id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data0.displayName !== undefined){
let data2 = data0.displayName;
if(typeof data2 === "string"){
if(func2(data2) > 1024){
const err7 = {instancePath:instancePath+"/mailbox/displayName",schemaPath:"../outlook/mailbox.schema.json/properties/displayName/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(func2(data2) < 1){
const err8 = {instancePath:instancePath+"/mailbox/displayName",schemaPath:"../outlook/mailbox.schema.json/properties/displayName/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
else {
const err9 = {instancePath:instancePath+"/mailbox/displayName",schemaPath:"../outlook/mailbox.schema.json/properties/displayName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data0.emailAddress !== undefined){
let data3 = data0.emailAddress;
if(typeof data3 === "string"){
if(func2(data3) > 1024){
const err10 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"../outlook/mailbox.schema.json/properties/emailAddress/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(func2(data3) < 1){
const err11 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"../outlook/mailbox.schema.json/properties/emailAddress/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
else {
const err12 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"../outlook/mailbox.schema.json/properties/emailAddress/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data0.profileName !== undefined){
let data4 = data0.profileName;
if(typeof data4 === "string"){
if(func2(data4) > 1024){
const err13 = {instancePath:instancePath+"/mailbox/profileName",schemaPath:"../outlook/mailbox.schema.json/properties/profileName/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(func2(data4) < 1){
const err14 = {instancePath:instancePath+"/mailbox/profileName",schemaPath:"../outlook/mailbox.schema.json/properties/profileName/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
else {
const err15 = {instancePath:instancePath+"/mailbox/profileName",schemaPath:"../outlook/mailbox.schema.json/properties/profileName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data0.source !== undefined){
let data5 = data0.source;
if(typeof data5 === "string"){
if(func2(data5) > 128){
const err16 = {instancePath:instancePath+"/mailbox/source",schemaPath:"../outlook/mailbox.schema.json/properties/source/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
if(func2(data5) < 1){
const err17 = {instancePath:instancePath+"/mailbox/source",schemaPath:"../outlook/mailbox.schema.json/properties/source/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
else {
const err18 = {instancePath:instancePath+"/mailbox/source",schemaPath:"../outlook/mailbox.schema.json/properties/source/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
}
else {
const err19 = {instancePath:instancePath+"/mailbox",schemaPath:"../outlook/mailbox.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.hits !== undefined){
let data6 = data.hits;
if(Array.isArray(data6)){
if(data6.length > 50){
const err20 = {instancePath:instancePath+"/hits",schemaPath:"#/properties/hits/maxItems",keyword:"maxItems",params:{limit: 50},message:"must NOT have more than 50 items"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
const len0 = data6.length;
for(let i0=0; i0<len0; i0++){
if(!(validate64(data6[i0], {instancePath:instancePath+"/hits/" + i0,parentData:data6,parentDataProperty:i0,rootData}))){
vErrors = vErrors === null ? validate64.errors : vErrors.concat(validate64.errors);
errors = vErrors.length;
}
}
}
else {
const err21 = {instancePath:instancePath+"/hits",schemaPath:"#/properties/hits/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.totalMatched !== undefined){
let data8 = data.totalMatched;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err22 = {instancePath:instancePath+"/totalMatched",schemaPath:"#/properties/totalMatched/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 < 0 || isNaN(data8)){
const err23 = {instancePath:instancePath+"/totalMatched",schemaPath:"#/properties/totalMatched/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
}
if(data.summary !== undefined){
let data9 = data.summary;
if(typeof data9 === "string"){
if(func2(data9) > 32768){
const err24 = {instancePath:instancePath+"/summary",schemaPath:"#/properties/summary/maxLength",keyword:"maxLength",params:{limit: 32768},message:"must NOT have more than 32768 characters"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
else {
const err25 = {instancePath:instancePath+"/summary",schemaPath:"#/properties/summary/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.summaryModel !== undefined){
let data10 = data.summaryModel;
if(typeof data10 === "string"){
if(func2(data10) > 256){
const err26 = {instancePath:instancePath+"/summaryModel",schemaPath:"#/properties/summaryModel/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(func2(data10) < 1){
const err27 = {instancePath:instancePath+"/summaryModel",schemaPath:"#/properties/summaryModel/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
else {
const err28 = {instancePath:instancePath+"/summaryModel",schemaPath:"#/properties/summaryModel/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data.expandedKeywords !== undefined){
let data11 = data.expandedKeywords;
if(Array.isArray(data11)){
if(data11.length > 32){
const err29 = {instancePath:instancePath+"/expandedKeywords",schemaPath:"#/properties/expandedKeywords/maxItems",keyword:"maxItems",params:{limit: 32},message:"must NOT have more than 32 items"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
const len1 = data11.length;
for(let i1=0; i1<len1; i1++){
let data12 = data11[i1];
if(typeof data12 === "string"){
if(func2(data12) > 256){
const err30 = {instancePath:instancePath+"/expandedKeywords/" + i1,schemaPath:"#/properties/expandedKeywords/items/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(func2(data12) < 1){
const err31 = {instancePath:instancePath+"/expandedKeywords/" + i1,schemaPath:"#/properties/expandedKeywords/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
else {
const err32 = {instancePath:instancePath+"/expandedKeywords/" + i1,schemaPath:"#/properties/expandedKeywords/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
}
else {
const err33 = {instancePath:instancePath+"/expandedKeywords",schemaPath:"#/properties/expandedKeywords/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
if(data.warnings !== undefined){
let data13 = data.warnings;
if(Array.isArray(data13)){
const len2 = data13.length;
for(let i2=0; i2<len2; i2++){
let data14 = data13[i2];
if(data14 && typeof data14 == "object" && !Array.isArray(data14)){
if(data14.message === undefined){
const err34 = {instancePath:instancePath+"/warnings/" + i2,schemaPath:"../outlook/listing-warning.schema.json/required",keyword:"required",params:{missingProperty: "message"},message:"must have required property '"+"message"+"'"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(data14.path !== undefined){
let data15 = data14.path;
if(typeof data15 === "string"){
if(func2(data15) > 32768){
const err35 = {instancePath:instancePath+"/warnings/" + i2+"/path",schemaPath:"../outlook/listing-warning.schema.json/properties/path/maxLength",keyword:"maxLength",params:{limit: 32768},message:"must NOT have more than 32768 characters"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
if(func2(data15) < 1){
const err36 = {instancePath:instancePath+"/warnings/" + i2+"/path",schemaPath:"../outlook/listing-warning.schema.json/properties/path/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
else {
const err37 = {instancePath:instancePath+"/warnings/" + i2+"/path",schemaPath:"../outlook/listing-warning.schema.json/properties/path/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data14.message !== undefined){
let data16 = data14.message;
if(typeof data16 === "string"){
if(func2(data16) > 4096){
const err38 = {instancePath:instancePath+"/warnings/" + i2+"/message",schemaPath:"../outlook/listing-warning.schema.json/properties/message/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(func2(data16) < 1){
const err39 = {instancePath:instancePath+"/warnings/" + i2+"/message",schemaPath:"../outlook/listing-warning.schema.json/properties/message/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
else {
const err40 = {instancePath:instancePath+"/warnings/" + i2+"/message",schemaPath:"../outlook/listing-warning.schema.json/properties/message/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
}
else {
const err41 = {instancePath:instancePath+"/warnings/" + i2,schemaPath:"../outlook/listing-warning.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
}
else {
const err42 = {instancePath:instancePath+"/warnings",schemaPath:"#/properties/warnings/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
if(data.trace !== undefined){
if(!(validate60(data.trace, {instancePath:instancePath+"/trace",parentData:data,parentDataProperty:"trace",rootData}))){
vErrors = vErrors === null ? validate60.errors : vErrors.concat(validate60.errors);
errors = vErrors.length;
}
}
}
else {
const err43 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
validate63.errors = vErrors;
return errors === 0;
}

