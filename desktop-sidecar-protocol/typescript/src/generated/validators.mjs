"use strict";
export const validateOutlookFileProvenance = validate10;
const schema11 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/file-provenance.schema.json","title":"OutlookFileProvenance","description":"Versioned Outlook source metadata for an uploaded file. Multiple origins preserve distinct containing messages when identical bytes are deduplicated. This standalone contract does not add a field to existing v1 RPC responses.","type":"object","properties":{"version":{"type":"integer","const":1},"origins":{"type":"array","minItems":1,"items":{"type":"object","properties":{"document":{"description":"The uploaded email's own message reference. Omit for an ordinary file attachment with no message identity. For a thread export, identifies the requested subject only.","allOf":[{"$ref":"./message-reference.schema.json"}]},"topLevelParent":{"description":"The outermost containing mailbox message. Never substitute this reference for the uploaded document's own identity.","allOf":[{"$ref":"./message-reference.schema.json"}]}},"additionalProperties":false,"minProperties":1}}},"required":["version","origins"],"additionalProperties":false};
const schema12 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/message-reference.schema.json","title":"OutlookMessageReference","description":"A reference to one Outlook message, preserving its own identifiers and mailbox context. This is metadata, not an instruction or proof that the item is accessible.","type":"object","properties":{"documentId":{"description":"Originating sidecar catalog UUID, when indexed. Requires resolution against that catalog and is not portable across devices.","type":"string","format":"uuid"},"external_ids":{"allOf":[{"$ref":"../source/external-ids.schema.json"},{"type":"array","items":{"type":"object","properties":{"key":{},"value":{}},"if":{"properties":{"key":{"enum":["outlook_entry_id","outlook_store_id"]}},"required":["key"]},"then":{"properties":{"value":{"type":"string","pattern":"^(?:[0-9a-fA-F]{2})+$"}}}}}]},"mailbox":{"$ref":"./mailbox-reference.schema.json"}},"required":["external_ids"],"anyOf":[{"required":["documentId"],"properties":{"documentId":{"description":"Originating sidecar catalog UUID, when indexed. Requires resolution against that catalog and is not portable across devices.","type":"string","format":"uuid"}}},{"properties":{"external_ids":{"type":"array","minItems":1}}}],"additionalProperties":false};
const schema13 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/source/external-ids.schema.json","title":"DocumentExternalIds","description":"Externally relatable identifiers for the document. Identifier keys are open-ended so new identifier kinds do not require a protocol change.","type":"array","items":{"type":"object","properties":{"key":{"type":"string","minLength":1},"value":{"type":"string","minLength":1}},"required":["key","value"],"additionalProperties":false}};
const schema14 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/mailbox-reference.schema.json","title":"OutlookMailboxReference","description":"Mailbox context captured with a message reference. Local IDs are scoped to the originating Outlook installation; emailAddress identifies the mailbox owner, including a shared mailbox, not necessarily the signed-in user.","type":"object","properties":{"mailboxId":{"description":"Local sidecar mailbox ID. Both the compact Outlook RPC spelling and the UUID spelling used by search are accepted. Not a Microsoft Graph mailbox ID or a portable device identity.","type":"string","pattern":"^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$"},"emailAddress":{"description":"SMTP address of the mailbox owning the referenced item, when known.","type":"string","minLength":1,"maxLength":1024,"pattern":"\\S"},"profileName":{"description":"Name of the originating Outlook profile, when available. A profile name alone does not identify a mailbox.","type":"string","minLength":1,"maxLength":1024,"pattern":"\\S"}},"anyOf":[{"required":["mailboxId"],"properties":{"mailboxId":{"description":"Local sidecar mailbox ID. Both the compact Outlook RPC spelling and the UUID spelling used by search are accepted. Not a Microsoft Graph mailbox ID or a portable device identity.","type":"string","pattern":"^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$"}}},{"required":["emailAddress"],"properties":{"emailAddress":{"description":"SMTP address of the mailbox owning the referenced item, when known.","type":"string","minLength":1,"maxLength":1024,"pattern":"\\S"}}}],"additionalProperties":false};
const formats0 = /^(?:urn:uuid:)?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const func2 = (value) => Array.from(value).length;
const pattern0 = new RegExp("^(?:[0-9a-fA-F]{2})+$", "u");
const pattern1 = new RegExp("^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$", "u");
const pattern2 = new RegExp("\\S", "u");

function validate11(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/outlook/message-reference.schema.json" */;
let vErrors = null;
let errors = 0;
const _errs1 = errors;
let valid0 = false;
const _errs2 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.documentId === undefined){
const err0 = {instancePath,schemaPath:"#/anyOf/0/required",keyword:"required",params:{missingProperty: "documentId"},message:"must have required property '"+"documentId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.documentId !== undefined){
let data0 = data.documentId;
if(typeof data0 === "string"){
if(!(formats0.test(data0))){
const err1 = {instancePath:instancePath+"/documentId",schemaPath:"#/anyOf/0/properties/documentId/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err2 = {instancePath:instancePath+"/documentId",schemaPath:"#/anyOf/0/properties/documentId/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
var _valid0 = _errs2 === errors;
valid0 = valid0 || _valid0;
if(!valid0){
const _errs5 = errors;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.external_ids !== undefined){
let data1 = data.external_ids;
if(Array.isArray(data1)){
if(data1.length < 1){
const err3 = {instancePath:instancePath+"/external_ids",schemaPath:"#/anyOf/1/properties/external_ids/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
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
const err4 = {instancePath:instancePath+"/external_ids",schemaPath:"#/anyOf/1/properties/external_ids/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
}
var _valid0 = _errs5 === errors;
valid0 = valid0 || _valid0;
}
if(!valid0){
const err5 = {instancePath,schemaPath:"#/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
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
if(data.external_ids === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "external_ids"},message:"must have required property '"+"external_ids"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key0 in data){
if(!(((key0 === "documentId") || (key0 === "external_ids")) || (key0 === "mailbox"))){
const err7 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.documentId !== undefined){
let data2 = data.documentId;
if(typeof data2 === "string"){
if(!(formats0.test(data2))){
const err8 = {instancePath:instancePath+"/documentId",schemaPath:"#/properties/documentId/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err9 = {instancePath:instancePath+"/documentId",schemaPath:"#/properties/documentId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.external_ids !== undefined){
let data3 = data.external_ids;
if(Array.isArray(data3)){
const len0 = data3.length;
for(let i0=0; i0<len0; i0++){
let data4 = data3[i0];
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.key === undefined){
const err10 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"../source/external-ids.schema.json/items/required",keyword:"required",params:{missingProperty: "key"},message:"must have required property '"+"key"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data4.value === undefined){
const err11 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"../source/external-ids.schema.json/items/required",keyword:"required",params:{missingProperty: "value"},message:"must have required property '"+"value"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
for(const key1 in data4){
if(!((key1 === "key") || (key1 === "value"))){
const err12 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"../source/external-ids.schema.json/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data4.key !== undefined){
let data5 = data4.key;
if(typeof data5 === "string"){
if(func2(data5) < 1){
const err13 = {instancePath:instancePath+"/external_ids/" + i0+"/key",schemaPath:"../source/external-ids.schema.json/items/properties/key/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err14 = {instancePath:instancePath+"/external_ids/" + i0+"/key",schemaPath:"../source/external-ids.schema.json/items/properties/key/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data4.value !== undefined){
let data6 = data4.value;
if(typeof data6 === "string"){
if(func2(data6) < 1){
const err15 = {instancePath:instancePath+"/external_ids/" + i0+"/value",schemaPath:"../source/external-ids.schema.json/items/properties/value/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err16 = {instancePath:instancePath+"/external_ids/" + i0+"/value",schemaPath:"../source/external-ids.schema.json/items/properties/value/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err17 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"../source/external-ids.schema.json/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err18 = {instancePath:instancePath+"/external_ids",schemaPath:"../source/external-ids.schema.json/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(Array.isArray(data3)){
const len1 = data3.length;
for(let i1=0; i1<len1; i1++){
let data7 = data3[i1];
const _errs26 = errors;
let valid11 = true;
const _errs27 = errors;
if(data7 && typeof data7 == "object" && !Array.isArray(data7)){
let missing0;
if((data7.key === undefined) && (missing0 = "key")){
const err19 = {};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
else {
if(data7.key !== undefined){
let data8 = data7.key;
if(!((data8 === "outlook_entry_id") || (data8 === "outlook_store_id"))){
const err20 = {};
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
}
var _valid1 = _errs27 === errors;
errors = _errs26;
if(vErrors !== null){
if(_errs26){
vErrors.length = _errs26;
}
else {
vErrors = null;
}
}
if(_valid1){
const _errs29 = errors;
if(data7 && typeof data7 == "object" && !Array.isArray(data7)){
if(data7.value !== undefined){
let data9 = data7.value;
if(typeof data9 === "string"){
if(!pattern0.test(data9)){
const err21 = {instancePath:instancePath+"/external_ids/" + i1+"/value",schemaPath:"#/properties/external_ids/allOf/1/items/then/properties/value/pattern",keyword:"pattern",params:{pattern: "^(?:[0-9a-fA-F]{2})+$"},message:"must match pattern \""+"^(?:[0-9a-fA-F]{2})+$"+"\""};
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
const err22 = {instancePath:instancePath+"/external_ids/" + i1+"/value",schemaPath:"#/properties/external_ids/allOf/1/items/then/properties/value/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
var _valid1 = _errs29 === errors;
valid11 = _valid1;
}
if(!valid11){
const err23 = {instancePath:instancePath+"/external_ids/" + i1,schemaPath:"#/properties/external_ids/allOf/1/items/if",keyword:"if",params:{failingKeyword: "then"},message:"must match \"then\" schema"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(!(data7 && typeof data7 == "object" && !Array.isArray(data7))){
const err24 = {instancePath:instancePath+"/external_ids/" + i1,schemaPath:"#/properties/external_ids/allOf/1/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
else {
const err25 = {instancePath:instancePath+"/external_ids",schemaPath:"#/properties/external_ids/allOf/1/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.mailbox !== undefined){
let data10 = data.mailbox;
const _errs35 = errors;
let valid15 = false;
const _errs36 = errors;
if(data10 && typeof data10 == "object" && !Array.isArray(data10)){
if(data10.mailboxId === undefined){
const err26 = {instancePath:instancePath+"/mailbox",schemaPath:"./mailbox-reference.schema.json/anyOf/0/required",keyword:"required",params:{missingProperty: "mailboxId"},message:"must have required property '"+"mailboxId"+"'"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(data10.mailboxId !== undefined){
let data11 = data10.mailboxId;
if(typeof data11 === "string"){
if(!pattern1.test(data11)){
const err27 = {instancePath:instancePath+"/mailbox/mailboxId",schemaPath:"./mailbox-reference.schema.json/anyOf/0/properties/mailboxId/pattern",keyword:"pattern",params:{pattern: "^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$"},message:"must match pattern \""+"^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$"+"\""};
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
const err28 = {instancePath:instancePath+"/mailbox/mailboxId",schemaPath:"./mailbox-reference.schema.json/anyOf/0/properties/mailboxId/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
var _valid2 = _errs36 === errors;
valid15 = valid15 || _valid2;
if(!valid15){
const _errs39 = errors;
if(data10 && typeof data10 == "object" && !Array.isArray(data10)){
if(data10.emailAddress === undefined){
const err29 = {instancePath:instancePath+"/mailbox",schemaPath:"./mailbox-reference.schema.json/anyOf/1/required",keyword:"required",params:{missingProperty: "emailAddress"},message:"must have required property '"+"emailAddress"+"'"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(data10.emailAddress !== undefined){
let data12 = data10.emailAddress;
if(typeof data12 === "string"){
if(func2(data12) > 1024){
const err30 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"./mailbox-reference.schema.json/anyOf/1/properties/emailAddress/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(func2(data12) < 1){
const err31 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"./mailbox-reference.schema.json/anyOf/1/properties/emailAddress/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(!pattern2.test(data12)){
const err32 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"./mailbox-reference.schema.json/anyOf/1/properties/emailAddress/pattern",keyword:"pattern",params:{pattern: "\\S"},message:"must match pattern \""+"\\S"+"\""};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
else {
const err33 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"./mailbox-reference.schema.json/anyOf/1/properties/emailAddress/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
var _valid2 = _errs39 === errors;
valid15 = valid15 || _valid2;
}
if(!valid15){
const err34 = {instancePath:instancePath+"/mailbox",schemaPath:"./mailbox-reference.schema.json/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
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
if(data10 && typeof data10 == "object" && !Array.isArray(data10)){
for(const key2 in data10){
if(!(((key2 === "mailboxId") || (key2 === "emailAddress")) || (key2 === "profileName"))){
const err35 = {instancePath:instancePath+"/mailbox",schemaPath:"./mailbox-reference.schema.json/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
if(data10.mailboxId !== undefined){
let data13 = data10.mailboxId;
if(typeof data13 === "string"){
if(!pattern1.test(data13)){
const err36 = {instancePath:instancePath+"/mailbox/mailboxId",schemaPath:"./mailbox-reference.schema.json/properties/mailboxId/pattern",keyword:"pattern",params:{pattern: "^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$"},message:"must match pattern \""+"^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$"+"\""};
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
const err37 = {instancePath:instancePath+"/mailbox/mailboxId",schemaPath:"./mailbox-reference.schema.json/properties/mailboxId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data10.emailAddress !== undefined){
let data14 = data10.emailAddress;
if(typeof data14 === "string"){
if(func2(data14) > 1024){
const err38 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"./mailbox-reference.schema.json/properties/emailAddress/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(func2(data14) < 1){
const err39 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"./mailbox-reference.schema.json/properties/emailAddress/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if(!pattern2.test(data14)){
const err40 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"./mailbox-reference.schema.json/properties/emailAddress/pattern",keyword:"pattern",params:{pattern: "\\S"},message:"must match pattern \""+"\\S"+"\""};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
else {
const err41 = {instancePath:instancePath+"/mailbox/emailAddress",schemaPath:"./mailbox-reference.schema.json/properties/emailAddress/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
if(data10.profileName !== undefined){
let data15 = data10.profileName;
if(typeof data15 === "string"){
if(func2(data15) > 1024){
const err42 = {instancePath:instancePath+"/mailbox/profileName",schemaPath:"./mailbox-reference.schema.json/properties/profileName/maxLength",keyword:"maxLength",params:{limit: 1024},message:"must NOT have more than 1024 characters"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if(func2(data15) < 1){
const err43 = {instancePath:instancePath+"/mailbox/profileName",schemaPath:"./mailbox-reference.schema.json/properties/profileName/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if(!pattern2.test(data15)){
const err44 = {instancePath:instancePath+"/mailbox/profileName",schemaPath:"./mailbox-reference.schema.json/properties/profileName/pattern",keyword:"pattern",params:{pattern: "\\S"},message:"must match pattern \""+"\\S"+"\""};
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
const err45 = {instancePath:instancePath+"/mailbox/profileName",schemaPath:"./mailbox-reference.schema.json/properties/profileName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
}
else {
const err46 = {instancePath:instancePath+"/mailbox",schemaPath:"./mailbox-reference.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err47 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
validate11.errors = vErrors;
return errors === 0;
}


function validate10(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/outlook/file-provenance.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.version === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "version"},message:"must have required property '"+"version"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.origins === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "origins"},message:"must have required property '"+"origins"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "version") || (key0 === "origins"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.version !== undefined){
let data0 = data.version;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err3 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(1 !== data0){
const err4 = {instancePath:instancePath+"/version",schemaPath:"#/properties/version/const",keyword:"const",params:{allowedValue: 1},message:"must be equal to constant"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.origins !== undefined){
let data1 = data.origins;
if(Array.isArray(data1)){
if(data1.length < 1){
const err5 = {instancePath:instancePath+"/origins",schemaPath:"#/properties/origins/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
const len0 = data1.length;
for(let i0=0; i0<len0; i0++){
let data2 = data1[i0];
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(Object.keys(data2).length < 1){
const err6 = {instancePath:instancePath+"/origins/" + i0,schemaPath:"#/properties/origins/items/minProperties",keyword:"minProperties",params:{limit: 1},message:"must NOT have fewer than 1 properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key1 in data2){
if(!((key1 === "document") || (key1 === "topLevelParent"))){
const err7 = {instancePath:instancePath+"/origins/" + i0,schemaPath:"#/properties/origins/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data2.document !== undefined){
if(!(validate11(data2.document, {instancePath:instancePath+"/origins/" + i0+"/document",parentData:data2,parentDataProperty:"document",rootData}))){
vErrors = vErrors === null ? validate11.errors : vErrors.concat(validate11.errors);
errors = vErrors.length;
}
}
if(data2.topLevelParent !== undefined){
if(!(validate11(data2.topLevelParent, {instancePath:instancePath+"/origins/" + i0+"/topLevelParent",parentData:data2,parentDataProperty:"topLevelParent",rootData}))){
vErrors = vErrors === null ? validate11.errors : vErrors.concat(validate11.errors);
errors = vErrors.length;
}
}
}
else {
const err8 = {instancePath:instancePath+"/origins/" + i0,schemaPath:"#/properties/origins/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err9 = {instancePath:instancePath+"/origins",schemaPath:"#/properties/origins/type",keyword:"type",params:{type: "array"},message:"must be array"};
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
validate10.errors = vErrors;
return errors === 0;
}

export const validateIndexingBenchmarkListV1Params = validate14;
const schema15 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-list-v1-params.schema.json","title":"IndexingBenchmarkListV1Params","type":"object","properties":{"limit":{"type":"integer","minimum":1,"maximum":100,"default":50},"offset":{"type":"integer","minimum":0,"maximum":9007199254740991,"default":0}},"required":[],"additionalProperties":false};

function validate14(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-list-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!((key0 === "limit") || (key0 === "offset"))){
const err0 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
if(data.limit !== undefined){
let data0 = data.limit;
if(!(((typeof data0 == "number") && (!(data0 % 1) && !isNaN(data0))) && (isFinite(data0)))){
const err1 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if((typeof data0 == "number") && (isFinite(data0))){
if(data0 > 100 || isNaN(data0)){
const err2 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 100},message:"must be <= 100"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data0 < 1 || isNaN(data0)){
const err3 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
}
if(data.offset !== undefined){
let data1 = data.offset;
if(!(((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1))) && (isFinite(data1)))){
const err4 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if((typeof data1 == "number") && (isFinite(data1))){
if(data1 > 9007199254740991 || isNaN(data1)){
const err5 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1 < 0 || isNaN(data1)){
const err6 = {instancePath:instancePath+"/offset",schemaPath:"#/properties/offset/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
validate14.errors = vErrors;
return errors === 0;
}

export const validateIndexingBenchmarkListV1Result = validate15;
const schema16 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-list-v1-result.schema.json","title":"IndexingBenchmarkListV1Result","type":"object","properties":{"runs":{"type":"array","maxItems":100,"items":{"type":"object","properties":{"runId":{"type":"string","format":"uuid"},"mailboxId":{"type":"string","pattern":"^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"},"mode":{"type":"string","enum":["fiveMinutes","fullMailbox"]},"state":{"type":"string","enum":["preparing","running","completed","failed"]},"startedAt":{"type":"string","format":"date-time"},"finishedAt":{"type":["string","null"],"format":"date-time"}},"required":["runId","mailboxId","mode","state","startedAt","finishedAt"],"additionalProperties":false}},"nextOffset":{"type":["integer","null"],"minimum":0,"maximum":9007199254740991}},"required":["runs","nextOffset"],"additionalProperties":false};
const formats6 = { validate: (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value)) };
const pattern6 = new RegExp("^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$", "u");

function validate15(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-list-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.runs === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "runs"},message:"must have required property '"+"runs"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.nextOffset === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "nextOffset"},message:"must have required property '"+"nextOffset"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "runs") || (key0 === "nextOffset"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.runs !== undefined){
let data0 = data.runs;
if(Array.isArray(data0)){
if(data0.length > 100){
const err3 = {instancePath:instancePath+"/runs",schemaPath:"#/properties/runs/maxItems",keyword:"maxItems",params:{limit: 100},message:"must NOT have more than 100 items"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.runId === undefined){
const err4 = {instancePath:instancePath+"/runs/" + i0,schemaPath:"#/properties/runs/items/required",keyword:"required",params:{missingProperty: "runId"},message:"must have required property '"+"runId"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.mailboxId === undefined){
const err5 = {instancePath:instancePath+"/runs/" + i0,schemaPath:"#/properties/runs/items/required",keyword:"required",params:{missingProperty: "mailboxId"},message:"must have required property '"+"mailboxId"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.mode === undefined){
const err6 = {instancePath:instancePath+"/runs/" + i0,schemaPath:"#/properties/runs/items/required",keyword:"required",params:{missingProperty: "mode"},message:"must have required property '"+"mode"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.state === undefined){
const err7 = {instancePath:instancePath+"/runs/" + i0,schemaPath:"#/properties/runs/items/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.startedAt === undefined){
const err8 = {instancePath:instancePath+"/runs/" + i0,schemaPath:"#/properties/runs/items/required",keyword:"required",params:{missingProperty: "startedAt"},message:"must have required property '"+"startedAt"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data1.finishedAt === undefined){
const err9 = {instancePath:instancePath+"/runs/" + i0,schemaPath:"#/properties/runs/items/required",keyword:"required",params:{missingProperty: "finishedAt"},message:"must have required property '"+"finishedAt"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
for(const key1 in data1){
if(!((((((key1 === "runId") || (key1 === "mailboxId")) || (key1 === "mode")) || (key1 === "state")) || (key1 === "startedAt")) || (key1 === "finishedAt"))){
const err10 = {instancePath:instancePath+"/runs/" + i0,schemaPath:"#/properties/runs/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data1.runId !== undefined){
let data2 = data1.runId;
if(typeof data2 === "string"){
if(!(formats0.test(data2))){
const err11 = {instancePath:instancePath+"/runs/" + i0+"/runId",schemaPath:"#/properties/runs/items/properties/runId/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err12 = {instancePath:instancePath+"/runs/" + i0+"/runId",schemaPath:"#/properties/runs/items/properties/runId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data1.mailboxId !== undefined){
let data3 = data1.mailboxId;
if(typeof data3 === "string"){
if(!pattern6.test(data3)){
const err13 = {instancePath:instancePath+"/runs/" + i0+"/mailboxId",schemaPath:"#/properties/runs/items/properties/mailboxId/pattern",keyword:"pattern",params:{pattern: "^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"},message:"must match pattern \""+"^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"+"\""};
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
const err14 = {instancePath:instancePath+"/runs/" + i0+"/mailboxId",schemaPath:"#/properties/runs/items/properties/mailboxId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data1.mode !== undefined){
let data4 = data1.mode;
if(typeof data4 !== "string"){
const err15 = {instancePath:instancePath+"/runs/" + i0+"/mode",schemaPath:"#/properties/runs/items/properties/mode/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(!((data4 === "fiveMinutes") || (data4 === "fullMailbox"))){
const err16 = {instancePath:instancePath+"/runs/" + i0+"/mode",schemaPath:"#/properties/runs/items/properties/mode/enum",keyword:"enum",params:{allowedValues: schema16.properties.runs.items.properties.mode.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data1.state !== undefined){
let data5 = data1.state;
if(typeof data5 !== "string"){
const err17 = {instancePath:instancePath+"/runs/" + i0+"/state",schemaPath:"#/properties/runs/items/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!((((data5 === "preparing") || (data5 === "running")) || (data5 === "completed")) || (data5 === "failed"))){
const err18 = {instancePath:instancePath+"/runs/" + i0+"/state",schemaPath:"#/properties/runs/items/properties/state/enum",keyword:"enum",params:{allowedValues: schema16.properties.runs.items.properties.state.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data1.startedAt !== undefined){
let data6 = data1.startedAt;
if(typeof data6 === "string"){
if(!(formats6.validate(data6))){
const err19 = {instancePath:instancePath+"/runs/" + i0+"/startedAt",schemaPath:"#/properties/runs/items/properties/startedAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
else {
const err20 = {instancePath:instancePath+"/runs/" + i0+"/startedAt",schemaPath:"#/properties/runs/items/properties/startedAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data1.finishedAt !== undefined){
let data7 = data1.finishedAt;
if((typeof data7 !== "string") && (data7 !== null)){
const err21 = {instancePath:instancePath+"/runs/" + i0+"/finishedAt",schemaPath:"#/properties/runs/items/properties/finishedAt/type",keyword:"type",params:{type: schema16.properties.runs.items.properties.finishedAt.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(typeof data7 === "string"){
if(!(formats6.validate(data7))){
const err22 = {instancePath:instancePath+"/runs/" + i0+"/finishedAt",schemaPath:"#/properties/runs/items/properties/finishedAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
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
}
else {
const err23 = {instancePath:instancePath+"/runs/" + i0,schemaPath:"#/properties/runs/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err24 = {instancePath:instancePath+"/runs",schemaPath:"#/properties/runs/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data.nextOffset !== undefined){
let data8 = data.nextOffset;
if((!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))) && (data8 !== null)){
const err25 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/type",keyword:"type",params:{type: schema16.properties.nextOffset.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 > 9007199254740991 || isNaN(data8)){
const err26 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if(data8 < 0 || isNaN(data8)){
const err27 = {instancePath:instancePath+"/nextOffset",schemaPath:"#/properties/nextOffset/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
const err28 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
validate15.errors = vErrors;
return errors === 0;
}

export const validateIndexingBenchmarkStartV1Params = validate16;
const schema17 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-start-v1-params.schema.json","title":"IndexingBenchmarkStartV1Params","type":"object","properties":{"mailboxId":{"type":"string","pattern":"^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"},"mode":{"type":"string","enum":["fiveMinutes","fullMailbox"],"default":"fiveMinutes"}},"required":["mailboxId"],"additionalProperties":false};

function validate16(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-start-v1-params.schema.json" */;
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
for(const key0 in data){
if(!((key0 === "mailboxId") || (key0 === "mode"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.mailboxId !== undefined){
let data0 = data.mailboxId;
if(typeof data0 === "string"){
if(!pattern6.test(data0)){
const err2 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/pattern",keyword:"pattern",params:{pattern: "^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"},message:"must match pattern \""+"^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"+"\""};
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
if(data.mode !== undefined){
let data1 = data.mode;
if(typeof data1 !== "string"){
const err4 = {instancePath:instancePath+"/mode",schemaPath:"#/properties/mode/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!((data1 === "fiveMinutes") || (data1 === "fullMailbox"))){
const err5 = {instancePath:instancePath+"/mode",schemaPath:"#/properties/mode/enum",keyword:"enum",params:{allowedValues: schema17.properties.mode.enum},message:"must be equal to one of the allowed values"};
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
validate16.errors = vErrors;
return errors === 0;
}

export const validateIndexingBenchmarkStartV1Result = validate17;
const schema18 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-start-v1-result.schema.json","title":"IndexingBenchmarkStartV1Result","type":"object","properties":{"runId":{"type":"string","format":"uuid"},"mailboxId":{"type":"string","pattern":"^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"},"mode":{"type":"string","enum":["fiveMinutes","fullMailbox"]},"state":{"type":"string","enum":["preparing","running","completed","failed"]},"parallelism":{"type":"integer","minimum":1},"elapsedSeconds":{"type":"number","minimum":0},"discoveredDocuments":{"type":"integer","minimum":0,"maximum":9007199254740991},"indexedDocuments":{"type":"integer","minimum":0,"maximum":9007199254740991},"failedDocuments":{"type":"integer","minimum":0,"maximum":9007199254740991},"indexedByType":{"type":"object","additionalProperties":{"type":"integer","minimum":0,"maximum":9007199254740991}},"mailboxBytes":{"type":"integer","minimum":0,"maximum":9007199254740991},"emailsWithUnknownSize":{"type":"integer","minimum":0,"maximum":9007199254740991},"discoveryComplete":{"type":"boolean"},"timedOut":{"type":"boolean"},"error":{"type":["string","null"]},"startedAt":{"type":"string","format":"date-time"},"finishedAt":{"type":["string","null"],"format":"date-time"}},"required":["runId","mailboxId","mode","state","parallelism","elapsedSeconds","discoveredDocuments","indexedDocuments","failedDocuments","indexedByType","mailboxBytes","emailsWithUnknownSize","discoveryComplete","timedOut","error","startedAt","finishedAt"],"additionalProperties":false};
const func10 = Object.prototype.hasOwnProperty;

function validate17(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-start-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.runId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "runId"},message:"must have required property '"+"runId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.mailboxId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mailboxId"},message:"must have required property '"+"mailboxId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.mode === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mode"},message:"must have required property '"+"mode"+"'"};
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
if(data.parallelism === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "parallelism"},message:"must have required property '"+"parallelism"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.elapsedSeconds === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "elapsedSeconds"},message:"must have required property '"+"elapsedSeconds"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.discoveredDocuments === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "discoveredDocuments"},message:"must have required property '"+"discoveredDocuments"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.indexedDocuments === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "indexedDocuments"},message:"must have required property '"+"indexedDocuments"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.failedDocuments === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "failedDocuments"},message:"must have required property '"+"failedDocuments"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.indexedByType === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "indexedByType"},message:"must have required property '"+"indexedByType"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.mailboxBytes === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mailboxBytes"},message:"must have required property '"+"mailboxBytes"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.emailsWithUnknownSize === undefined){
const err11 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "emailsWithUnknownSize"},message:"must have required property '"+"emailsWithUnknownSize"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data.discoveryComplete === undefined){
const err12 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "discoveryComplete"},message:"must have required property '"+"discoveryComplete"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data.timedOut === undefined){
const err13 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "timedOut"},message:"must have required property '"+"timedOut"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data.error === undefined){
const err14 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "error"},message:"must have required property '"+"error"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data.startedAt === undefined){
const err15 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "startedAt"},message:"must have required property '"+"startedAt"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data.finishedAt === undefined){
const err16 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "finishedAt"},message:"must have required property '"+"finishedAt"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
for(const key0 in data){
if(!(func10.call(schema18.properties, key0))){
const err17 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.runId !== undefined){
let data0 = data.runId;
if(typeof data0 === "string"){
if(!(formats0.test(data0))){
const err18 = {instancePath:instancePath+"/runId",schemaPath:"#/properties/runId/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err19 = {instancePath:instancePath+"/runId",schemaPath:"#/properties/runId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.mailboxId !== undefined){
let data1 = data.mailboxId;
if(typeof data1 === "string"){
if(!pattern6.test(data1)){
const err20 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/pattern",keyword:"pattern",params:{pattern: "^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"},message:"must match pattern \""+"^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"+"\""};
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
const err21 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.mode !== undefined){
let data2 = data.mode;
if(typeof data2 !== "string"){
const err22 = {instancePath:instancePath+"/mode",schemaPath:"#/properties/mode/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(!((data2 === "fiveMinutes") || (data2 === "fullMailbox"))){
const err23 = {instancePath:instancePath+"/mode",schemaPath:"#/properties/mode/enum",keyword:"enum",params:{allowedValues: schema18.properties.mode.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.state !== undefined){
let data3 = data.state;
if(typeof data3 !== "string"){
const err24 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(!((((data3 === "preparing") || (data3 === "running")) || (data3 === "completed")) || (data3 === "failed"))){
const err25 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/enum",keyword:"enum",params:{allowedValues: schema18.properties.state.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.parallelism !== undefined){
let data4 = data.parallelism;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err26 = {instancePath:instancePath+"/parallelism",schemaPath:"#/properties/parallelism/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 < 1 || isNaN(data4)){
const err27 = {instancePath:instancePath+"/parallelism",schemaPath:"#/properties/parallelism/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data.elapsedSeconds !== undefined){
let data5 = data.elapsedSeconds;
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 < 0 || isNaN(data5)){
const err28 = {instancePath:instancePath+"/elapsedSeconds",schemaPath:"#/properties/elapsedSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
const err29 = {instancePath:instancePath+"/elapsedSeconds",schemaPath:"#/properties/elapsedSeconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data.discoveredDocuments !== undefined){
let data6 = data.discoveredDocuments;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err30 = {instancePath:instancePath+"/discoveredDocuments",schemaPath:"#/properties/discoveredDocuments/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 > 9007199254740991 || isNaN(data6)){
const err31 = {instancePath:instancePath+"/discoveredDocuments",schemaPath:"#/properties/discoveredDocuments/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(data6 < 0 || isNaN(data6)){
const err32 = {instancePath:instancePath+"/discoveredDocuments",schemaPath:"#/properties/discoveredDocuments/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.indexedDocuments !== undefined){
let data7 = data.indexedDocuments;
if(!(((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7))) && (isFinite(data7)))){
const err33 = {instancePath:instancePath+"/indexedDocuments",schemaPath:"#/properties/indexedDocuments/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if((typeof data7 == "number") && (isFinite(data7))){
if(data7 > 9007199254740991 || isNaN(data7)){
const err34 = {instancePath:instancePath+"/indexedDocuments",schemaPath:"#/properties/indexedDocuments/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(data7 < 0 || isNaN(data7)){
const err35 = {instancePath:instancePath+"/indexedDocuments",schemaPath:"#/properties/indexedDocuments/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.failedDocuments !== undefined){
let data8 = data.failedDocuments;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err36 = {instancePath:instancePath+"/failedDocuments",schemaPath:"#/properties/failedDocuments/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 > 9007199254740991 || isNaN(data8)){
const err37 = {instancePath:instancePath+"/failedDocuments",schemaPath:"#/properties/failedDocuments/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(data8 < 0 || isNaN(data8)){
const err38 = {instancePath:instancePath+"/failedDocuments",schemaPath:"#/properties/failedDocuments/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.indexedByType !== undefined){
let data9 = data.indexedByType;
if(data9 && typeof data9 == "object" && !Array.isArray(data9)){
for(const key1 in data9){
let data10 = data9[key1];
if(!(((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10))) && (isFinite(data10)))){
const err39 = {instancePath:instancePath+"/indexedByType/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/indexedByType/additionalProperties/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if((typeof data10 == "number") && (isFinite(data10))){
if(data10 > 9007199254740991 || isNaN(data10)){
const err40 = {instancePath:instancePath+"/indexedByType/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/indexedByType/additionalProperties/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
if(data10 < 0 || isNaN(data10)){
const err41 = {instancePath:instancePath+"/indexedByType/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/indexedByType/additionalProperties/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
}
else {
const err42 = {instancePath:instancePath+"/indexedByType",schemaPath:"#/properties/indexedByType/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
if(data.mailboxBytes !== undefined){
let data11 = data.mailboxBytes;
if(!(((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11))) && (isFinite(data11)))){
const err43 = {instancePath:instancePath+"/mailboxBytes",schemaPath:"#/properties/mailboxBytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if((typeof data11 == "number") && (isFinite(data11))){
if(data11 > 9007199254740991 || isNaN(data11)){
const err44 = {instancePath:instancePath+"/mailboxBytes",schemaPath:"#/properties/mailboxBytes/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
if(data11 < 0 || isNaN(data11)){
const err45 = {instancePath:instancePath+"/mailboxBytes",schemaPath:"#/properties/mailboxBytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
}
if(data.emailsWithUnknownSize !== undefined){
let data12 = data.emailsWithUnknownSize;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err46 = {instancePath:instancePath+"/emailsWithUnknownSize",schemaPath:"#/properties/emailsWithUnknownSize/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
if((typeof data12 == "number") && (isFinite(data12))){
if(data12 > 9007199254740991 || isNaN(data12)){
const err47 = {instancePath:instancePath+"/emailsWithUnknownSize",schemaPath:"#/properties/emailsWithUnknownSize/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
if(data12 < 0 || isNaN(data12)){
const err48 = {instancePath:instancePath+"/emailsWithUnknownSize",schemaPath:"#/properties/emailsWithUnknownSize/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
}
if(data.discoveryComplete !== undefined){
if(typeof data.discoveryComplete !== "boolean"){
const err49 = {instancePath:instancePath+"/discoveryComplete",schemaPath:"#/properties/discoveryComplete/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
if(data.timedOut !== undefined){
if(typeof data.timedOut !== "boolean"){
const err50 = {instancePath:instancePath+"/timedOut",schemaPath:"#/properties/timedOut/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
if(data.error !== undefined){
let data15 = data.error;
if((typeof data15 !== "string") && (data15 !== null)){
const err51 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/type",keyword:"type",params:{type: schema18.properties.error.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
if(data.startedAt !== undefined){
let data16 = data.startedAt;
if(typeof data16 === "string"){
if(!(formats6.validate(data16))){
const err52 = {instancePath:instancePath+"/startedAt",schemaPath:"#/properties/startedAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
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
const err53 = {instancePath:instancePath+"/startedAt",schemaPath:"#/properties/startedAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
if(data.finishedAt !== undefined){
let data17 = data.finishedAt;
if((typeof data17 !== "string") && (data17 !== null)){
const err54 = {instancePath:instancePath+"/finishedAt",schemaPath:"#/properties/finishedAt/type",keyword:"type",params:{type: schema18.properties.finishedAt.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
if(typeof data17 === "string"){
if(!(formats6.validate(data17))){
const err55 = {instancePath:instancePath+"/finishedAt",schemaPath:"#/properties/finishedAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
}
}
else {
const err56 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
validate17.errors = vErrors;
return errors === 0;
}

export const validateIndexingBenchmarkStatusV1Params = validate18;
const schema19 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-status-v1-params.schema.json","title":"IndexingBenchmarkStatusV1Params","type":"object","properties":{"runId":{"type":"string","format":"uuid"}},"required":["runId"],"additionalProperties":false};

function validate18(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-status-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.runId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "runId"},message:"must have required property '"+"runId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "runId")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.runId !== undefined){
let data0 = data.runId;
if(typeof data0 === "string"){
if(!(formats0.test(data0))){
const err2 = {instancePath:instancePath+"/runId",schemaPath:"#/properties/runId/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err3 = {instancePath:instancePath+"/runId",schemaPath:"#/properties/runId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
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
validate18.errors = vErrors;
return errors === 0;
}

export const validateIndexingBenchmarkStatusV1Result = validate19;
const schema20 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-status-v1-result.schema.json","title":"IndexingBenchmarkStatusV1Result","type":"object","properties":{"runId":{"type":"string","format":"uuid"},"mailboxId":{"type":"string","pattern":"^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"},"mode":{"type":"string","enum":["fiveMinutes","fullMailbox"]},"state":{"type":"string","enum":["preparing","running","completed","failed"]},"parallelism":{"type":"integer","minimum":1},"elapsedSeconds":{"type":"number","minimum":0},"discoveredDocuments":{"type":"integer","minimum":0,"maximum":9007199254740991},"indexedDocuments":{"type":"integer","minimum":0,"maximum":9007199254740991},"failedDocuments":{"type":"integer","minimum":0,"maximum":9007199254740991},"indexedByType":{"type":"object","additionalProperties":{"type":"integer","minimum":0,"maximum":9007199254740991}},"mailboxBytes":{"type":"integer","minimum":0,"maximum":9007199254740991},"emailsWithUnknownSize":{"type":"integer","minimum":0,"maximum":9007199254740991},"discoveryComplete":{"type":"boolean"},"timedOut":{"type":"boolean"},"error":{"type":["string","null"]},"startedAt":{"type":"string","format":"date-time"},"finishedAt":{"type":["string","null"],"format":"date-time"}},"required":["runId","mailboxId","mode","state","parallelism","elapsedSeconds","discoveredDocuments","indexedDocuments","failedDocuments","indexedByType","mailboxBytes","emailsWithUnknownSize","discoveryComplete","timedOut","error","startedAt","finishedAt"],"additionalProperties":false};

function validate19(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-benchmark-status-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.runId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "runId"},message:"must have required property '"+"runId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.mailboxId === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mailboxId"},message:"must have required property '"+"mailboxId"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.mode === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mode"},message:"must have required property '"+"mode"+"'"};
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
if(data.parallelism === undefined){
const err4 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "parallelism"},message:"must have required property '"+"parallelism"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data.elapsedSeconds === undefined){
const err5 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "elapsedSeconds"},message:"must have required property '"+"elapsedSeconds"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data.discoveredDocuments === undefined){
const err6 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "discoveredDocuments"},message:"must have required property '"+"discoveredDocuments"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data.indexedDocuments === undefined){
const err7 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "indexedDocuments"},message:"must have required property '"+"indexedDocuments"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data.failedDocuments === undefined){
const err8 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "failedDocuments"},message:"must have required property '"+"failedDocuments"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data.indexedByType === undefined){
const err9 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "indexedByType"},message:"must have required property '"+"indexedByType"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data.mailboxBytes === undefined){
const err10 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mailboxBytes"},message:"must have required property '"+"mailboxBytes"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data.emailsWithUnknownSize === undefined){
const err11 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "emailsWithUnknownSize"},message:"must have required property '"+"emailsWithUnknownSize"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data.discoveryComplete === undefined){
const err12 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "discoveryComplete"},message:"must have required property '"+"discoveryComplete"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data.timedOut === undefined){
const err13 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "timedOut"},message:"must have required property '"+"timedOut"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data.error === undefined){
const err14 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "error"},message:"must have required property '"+"error"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data.startedAt === undefined){
const err15 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "startedAt"},message:"must have required property '"+"startedAt"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data.finishedAt === undefined){
const err16 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "finishedAt"},message:"must have required property '"+"finishedAt"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
for(const key0 in data){
if(!(func10.call(schema20.properties, key0))){
const err17 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data.runId !== undefined){
let data0 = data.runId;
if(typeof data0 === "string"){
if(!(formats0.test(data0))){
const err18 = {instancePath:instancePath+"/runId",schemaPath:"#/properties/runId/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err19 = {instancePath:instancePath+"/runId",schemaPath:"#/properties/runId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data.mailboxId !== undefined){
let data1 = data.mailboxId;
if(typeof data1 === "string"){
if(!pattern6.test(data1)){
const err20 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/pattern",keyword:"pattern",params:{pattern: "^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"},message:"must match pattern \""+"^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"+"\""};
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
const err21 = {instancePath:instancePath+"/mailboxId",schemaPath:"#/properties/mailboxId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data.mode !== undefined){
let data2 = data.mode;
if(typeof data2 !== "string"){
const err22 = {instancePath:instancePath+"/mode",schemaPath:"#/properties/mode/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(!((data2 === "fiveMinutes") || (data2 === "fullMailbox"))){
const err23 = {instancePath:instancePath+"/mode",schemaPath:"#/properties/mode/enum",keyword:"enum",params:{allowedValues: schema20.properties.mode.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.state !== undefined){
let data3 = data.state;
if(typeof data3 !== "string"){
const err24 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(!((((data3 === "preparing") || (data3 === "running")) || (data3 === "completed")) || (data3 === "failed"))){
const err25 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/enum",keyword:"enum",params:{allowedValues: schema20.properties.state.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err25];
}
else {
vErrors.push(err25);
}
errors++;
}
}
if(data.parallelism !== undefined){
let data4 = data.parallelism;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err26 = {instancePath:instancePath+"/parallelism",schemaPath:"#/properties/parallelism/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 < 1 || isNaN(data4)){
const err27 = {instancePath:instancePath+"/parallelism",schemaPath:"#/properties/parallelism/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data.elapsedSeconds !== undefined){
let data5 = data.elapsedSeconds;
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 < 0 || isNaN(data5)){
const err28 = {instancePath:instancePath+"/elapsedSeconds",schemaPath:"#/properties/elapsedSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
const err29 = {instancePath:instancePath+"/elapsedSeconds",schemaPath:"#/properties/elapsedSeconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data.discoveredDocuments !== undefined){
let data6 = data.discoveredDocuments;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err30 = {instancePath:instancePath+"/discoveredDocuments",schemaPath:"#/properties/discoveredDocuments/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if((typeof data6 == "number") && (isFinite(data6))){
if(data6 > 9007199254740991 || isNaN(data6)){
const err31 = {instancePath:instancePath+"/discoveredDocuments",schemaPath:"#/properties/discoveredDocuments/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(data6 < 0 || isNaN(data6)){
const err32 = {instancePath:instancePath+"/discoveredDocuments",schemaPath:"#/properties/discoveredDocuments/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.indexedDocuments !== undefined){
let data7 = data.indexedDocuments;
if(!(((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7))) && (isFinite(data7)))){
const err33 = {instancePath:instancePath+"/indexedDocuments",schemaPath:"#/properties/indexedDocuments/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if((typeof data7 == "number") && (isFinite(data7))){
if(data7 > 9007199254740991 || isNaN(data7)){
const err34 = {instancePath:instancePath+"/indexedDocuments",schemaPath:"#/properties/indexedDocuments/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(data7 < 0 || isNaN(data7)){
const err35 = {instancePath:instancePath+"/indexedDocuments",schemaPath:"#/properties/indexedDocuments/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.failedDocuments !== undefined){
let data8 = data.failedDocuments;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err36 = {instancePath:instancePath+"/failedDocuments",schemaPath:"#/properties/failedDocuments/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 > 9007199254740991 || isNaN(data8)){
const err37 = {instancePath:instancePath+"/failedDocuments",schemaPath:"#/properties/failedDocuments/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(data8 < 0 || isNaN(data8)){
const err38 = {instancePath:instancePath+"/failedDocuments",schemaPath:"#/properties/failedDocuments/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.indexedByType !== undefined){
let data9 = data.indexedByType;
if(data9 && typeof data9 == "object" && !Array.isArray(data9)){
for(const key1 in data9){
let data10 = data9[key1];
if(!(((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10))) && (isFinite(data10)))){
const err39 = {instancePath:instancePath+"/indexedByType/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/indexedByType/additionalProperties/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
if((typeof data10 == "number") && (isFinite(data10))){
if(data10 > 9007199254740991 || isNaN(data10)){
const err40 = {instancePath:instancePath+"/indexedByType/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/indexedByType/additionalProperties/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
if(data10 < 0 || isNaN(data10)){
const err41 = {instancePath:instancePath+"/indexedByType/" + key1.replace(/~/g, "~0").replace(/\//g, "~1"),schemaPath:"#/properties/indexedByType/additionalProperties/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
}
else {
const err42 = {instancePath:instancePath+"/indexedByType",schemaPath:"#/properties/indexedByType/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
if(data.mailboxBytes !== undefined){
let data11 = data.mailboxBytes;
if(!(((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11))) && (isFinite(data11)))){
const err43 = {instancePath:instancePath+"/mailboxBytes",schemaPath:"#/properties/mailboxBytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if((typeof data11 == "number") && (isFinite(data11))){
if(data11 > 9007199254740991 || isNaN(data11)){
const err44 = {instancePath:instancePath+"/mailboxBytes",schemaPath:"#/properties/mailboxBytes/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
if(data11 < 0 || isNaN(data11)){
const err45 = {instancePath:instancePath+"/mailboxBytes",schemaPath:"#/properties/mailboxBytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
}
if(data.emailsWithUnknownSize !== undefined){
let data12 = data.emailsWithUnknownSize;
if(!(((typeof data12 == "number") && (!(data12 % 1) && !isNaN(data12))) && (isFinite(data12)))){
const err46 = {instancePath:instancePath+"/emailsWithUnknownSize",schemaPath:"#/properties/emailsWithUnknownSize/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
if((typeof data12 == "number") && (isFinite(data12))){
if(data12 > 9007199254740991 || isNaN(data12)){
const err47 = {instancePath:instancePath+"/emailsWithUnknownSize",schemaPath:"#/properties/emailsWithUnknownSize/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
if(data12 < 0 || isNaN(data12)){
const err48 = {instancePath:instancePath+"/emailsWithUnknownSize",schemaPath:"#/properties/emailsWithUnknownSize/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
}
if(data.discoveryComplete !== undefined){
if(typeof data.discoveryComplete !== "boolean"){
const err49 = {instancePath:instancePath+"/discoveryComplete",schemaPath:"#/properties/discoveryComplete/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
if(data.timedOut !== undefined){
if(typeof data.timedOut !== "boolean"){
const err50 = {instancePath:instancePath+"/timedOut",schemaPath:"#/properties/timedOut/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err50];
}
else {
vErrors.push(err50);
}
errors++;
}
}
if(data.error !== undefined){
let data15 = data.error;
if((typeof data15 !== "string") && (data15 !== null)){
const err51 = {instancePath:instancePath+"/error",schemaPath:"#/properties/error/type",keyword:"type",params:{type: schema20.properties.error.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
if(data.startedAt !== undefined){
let data16 = data.startedAt;
if(typeof data16 === "string"){
if(!(formats6.validate(data16))){
const err52 = {instancePath:instancePath+"/startedAt",schemaPath:"#/properties/startedAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
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
const err53 = {instancePath:instancePath+"/startedAt",schemaPath:"#/properties/startedAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
if(data.finishedAt !== undefined){
let data17 = data.finishedAt;
if((typeof data17 !== "string") && (data17 !== null)){
const err54 = {instancePath:instancePath+"/finishedAt",schemaPath:"#/properties/finishedAt/type",keyword:"type",params:{type: schema20.properties.finishedAt.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
if(typeof data17 === "string"){
if(!(formats6.validate(data17))){
const err55 = {instancePath:instancePath+"/finishedAt",schemaPath:"#/properties/finishedAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
}
}
else {
const err56 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
validate19.errors = vErrors;
return errors === 0;
}

export const validateIndexingStartV1Params = validate20;
const schema21 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-start-v1-params.schema.json","title":"IndexingStartV1Params","type":"object","properties":{"rebuild":{"type":"object","properties":{"k1":{"type":"number","exclusiveMinimum":0},"b":{"type":"number","minimum":0,"maximum":1},"indexedAvgdl":{"type":"number","exclusiveMinimum":0},"maxTextBytes":{"type":"integer","minimum":1,"maximum":67108864}},"required":[],"additionalProperties":false}},"required":[],"additionalProperties":false};

function validate20(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-start-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!(key0 === "rebuild")){
const err0 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
if(data.rebuild !== undefined){
let data0 = data.rebuild;
if(data0 && typeof data0 == "object" && !Array.isArray(data0)){
for(const key1 in data0){
if(!((((key1 === "k1") || (key1 === "b")) || (key1 === "indexedAvgdl")) || (key1 === "maxTextBytes"))){
const err1 = {instancePath:instancePath+"/rebuild",schemaPath:"#/properties/rebuild/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data0.k1 !== undefined){
let data1 = data0.k1;
if((typeof data1 == "number") && (isFinite(data1))){
if(data1 <= 0 || isNaN(data1)){
const err2 = {instancePath:instancePath+"/rebuild/k1",schemaPath:"#/properties/rebuild/properties/k1/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
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
const err3 = {instancePath:instancePath+"/rebuild/k1",schemaPath:"#/properties/rebuild/properties/k1/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data0.b !== undefined){
let data2 = data0.b;
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 > 1 || isNaN(data2)){
const err4 = {instancePath:instancePath+"/rebuild/b",schemaPath:"#/properties/rebuild/properties/b/maximum",keyword:"maximum",params:{comparison: "<=", limit: 1},message:"must be <= 1"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data2 < 0 || isNaN(data2)){
const err5 = {instancePath:instancePath+"/rebuild/b",schemaPath:"#/properties/rebuild/properties/b/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
const err6 = {instancePath:instancePath+"/rebuild/b",schemaPath:"#/properties/rebuild/properties/b/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data0.indexedAvgdl !== undefined){
let data3 = data0.indexedAvgdl;
if((typeof data3 == "number") && (isFinite(data3))){
if(data3 <= 0 || isNaN(data3)){
const err7 = {instancePath:instancePath+"/rebuild/indexedAvgdl",schemaPath:"#/properties/rebuild/properties/indexedAvgdl/exclusiveMinimum",keyword:"exclusiveMinimum",params:{comparison: ">", limit: 0},message:"must be > 0"};
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
const err8 = {instancePath:instancePath+"/rebuild/indexedAvgdl",schemaPath:"#/properties/rebuild/properties/indexedAvgdl/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data0.maxTextBytes !== undefined){
let data4 = data0.maxTextBytes;
if(!(((typeof data4 == "number") && (!(data4 % 1) && !isNaN(data4))) && (isFinite(data4)))){
const err9 = {instancePath:instancePath+"/rebuild/maxTextBytes",schemaPath:"#/properties/rebuild/properties/maxTextBytes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if((typeof data4 == "number") && (isFinite(data4))){
if(data4 > 67108864 || isNaN(data4)){
const err10 = {instancePath:instancePath+"/rebuild/maxTextBytes",schemaPath:"#/properties/rebuild/properties/maxTextBytes/maximum",keyword:"maximum",params:{comparison: "<=", limit: 67108864},message:"must be <= 67108864"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data4 < 1 || isNaN(data4)){
const err11 = {instancePath:instancePath+"/rebuild/maxTextBytes",schemaPath:"#/properties/rebuild/properties/maxTextBytes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
const err12 = {instancePath:instancePath+"/rebuild",schemaPath:"#/properties/rebuild/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
else {
const err13 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
validate20.errors = vErrors;
return errors === 0;
}

export const validateIndexingStartV1Result = validate21;
const schema22 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-start-v1-result.schema.json","title":"IndexingStartV1Result","$ref":"./indexing-status-v1-result.schema.json"};
const schema23 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-status-v1-result.schema.json","title":"IndexingStatusV1Result","type":"object","properties":{"configuration":{"description":"Persisted layers for editing configuration without losing unrelated settings. Updated sidecars include both layers; absent on older servers.","type":"object","properties":{"user_configuration":{"$ref":"../configuration/sidecar-configuration.schema.json"},"organization_configuration":{"$ref":"../configuration/sidecar-configuration.schema.json"}},"required":["user_configuration","organization_configuration"],"additionalProperties":true},"sampledAt":{"type":"string","format":"date-time"},"sessionId":{"type":"string","minLength":1},"uptimeSeconds":{"type":"number","minimum":0},"state":{"type":"string","enum":["running","stopping","stopped","blocked"]},"effectiveConfiguration":{"$ref":"#/definitions/EffectiveIndexingConfiguration"},"resources":{"$ref":"#/definitions/Resources"},"generations":{"type":"array","items":{"$ref":"#/definitions/Generation"}},"discovery":{"type":"array","items":{"$ref":"#/definitions/DiscoverySource"}},"search":{"$ref":"#/definitions/SearchStatistics"},"resetInProgress":{"type":"boolean","default":false,"description":"True while a full reset is draining activity or deleting files. State is stopping during reset. Optional; absence means false."},"indexingDirectory":{"type":"string","minLength":1,"pattern":"^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)","description":"Absolute local filesystem path of the sidecar-managed indexing root, in the sidecar OS native path syntax (not a URI). Report it even before initialization or after reset, without creating the directory. Updated implementations must include it; optional in the wire schema for compatibility with older v1 servers."}},"required":["sampledAt","sessionId","uptimeSeconds","state","effectiveConfiguration","resources","generations","discovery","search"],"additionalProperties":true,"definitions":{"EffectiveIndexingConfiguration":{"type":"object","properties":{"parallelism":{"type":"integer","minimum":1,"maximum":9007199254740991},"documentsPerMinute":{"type":"integer","minimum":1,"maximum":9007199254740991}},"required":["parallelism","documentsPerMinute"],"additionalProperties":true},"UnavailableMetric":{"type":"object","properties":{"metric":{"type":"string","minLength":1},"reason":{"type":"string","minLength":1}},"required":["metric","reason"],"additionalProperties":true,"description":"Metric is a dotted path relative to its containing section. Every unavailable null measurement must have an entry; zero means an observed zero."},"ProcessResources":{"type":"object","properties":{"processCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"cpuCoresUsed":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"memoryResidentBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"memoryResidentPeakBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"diskReadBytesPerSecond":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"diskWriteBytesPerSecond":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableMetrics":{"type":"array","items":{"$ref":"#/definitions/UnavailableMetric"}}},"required":["processCount","cpuCoresUsed","memoryResidentBytes","memoryResidentPeakBytes","diskReadBytesPerSecond","diskWriteBytesPerSecond","unavailableMetrics"],"additionalProperties":true,"description":"Sidecar measurements include search and discovery. Worker measurements aggregate extraction children, including CPU/I/O accrued by children that exit between samples. Resident sums may double-count shared pages; peak is the maximum simultaneously observed aggregate since process startup."},"DiskUsage":{"type":"object","properties":{"allocatedBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"logicalBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]}},"required":["allocatedBytes","logicalBytes"],"additionalProperties":true},"Resources":{"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"observationSeconds":{"type":"number","minimum":0},"sidecar":{"$ref":"#/definitions/ProcessResources"},"extractionWorkers":{"$ref":"#/definitions/ProcessResources"},"disk":{"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"allocatedBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"logicalBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"availableBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"breakdown":{"type":"object","properties":{"control":{"$ref":"#/definitions/DiskUsage"},"catalog":{"$ref":"#/definitions/DiskUsage"},"activeIndex":{"$ref":"#/definitions/DiskUsage"},"buildingIndex":{"$ref":"#/definitions/DiskUsage"},"retiredIndexes":{"$ref":"#/definitions/DiskUsage"},"wal":{"$ref":"#/definitions/DiskUsage"},"temporary":{"$ref":"#/definitions/DiskUsage"}},"required":["control","catalog","activeIndex","buildingIndex","retiredIndexes","wal","temporary"],"additionalProperties":true},"unavailableMetrics":{"type":"array","items":{"$ref":"#/definitions/UnavailableMetric"}}},"required":["sampledAt","allocatedBytes","logicalBytes","availableBytes","breakdown","unavailableMetrics"],"additionalProperties":true},"liveExtractionWorkers":{"type":"array","description":"Individual currently live workers. Their memory sums can double-count shared pages. Aggregate CPU/I/O above also includes workers that exited during the sample.","items":{"type":"object","properties":{"processId":{"type":"integer","minimum":1,"maximum":9007199254740991},"sampledAt":{"type":"string","format":"date-time"},"resources":{"$ref":"#/definitions/ProcessResources"}},"required":["processId","sampledAt","resources"],"additionalProperties":true}}},"required":["sampledAt","observationSeconds","sidecar","extractionWorkers","disk","liveExtractionWorkers"],"additionalProperties":true},"ThroughputWindow":{"type":"object","properties":{"targetWindowSeconds":{"type":"integer","enum":[60,300]},"observationSeconds":{"type":"number","minimum":0},"sampleCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"indexedPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"emptyPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unindexablePerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"completedPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"attemptsPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"retriesPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"deletionsPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"extractedTextBytesPerSecond":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["targetWindowSeconds","observationSeconds","sampleCount","indexedPerMinute","emptyPerMinute","unindexablePerMinute","completedPerMinute","attemptsPerMinute","retriesPerMinute","deletionsPerMinute","extractedTextBytesPerSecond","unavailableReason"],"additionalProperties":true},"Backlog":{"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"discoveryComplete":{"type":"boolean"},"remaining":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"ready":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"inProgress":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"retryDeferred":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"blocked":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"firstTime":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"updates":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sampledAt","discoveryComplete","remaining","ready","inProgress","retryDeferred","blocked","firstTime","updates","unavailableReason"],"additionalProperties":true,"description":"Counts concern current eligible revisions, not queue entries. remaining = ready + inProgress + retryDeferred + blocked = firstTime + updates. Incomplete discovery still permits exact counts for known work. Terminal outcomes and deletion-only cleanup are excluded."},"Eta":{"type":"object","properties":{"state":{"type":"string","enum":["available","unavailable"]},"estimatedRemainingSeconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"estimatedCompletionAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"basis":{"const":"knownBacklog"},"rateWindowSeconds":{"type":"integer","enum":[60,300]},"observationSeconds":{"type":"number","minimum":0},"sampleCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["state","estimatedRemainingSeconds","estimatedCompletionAt","basis","rateWindowSeconds","observationSeconds","sampleCount","unavailableReason"],"additionalProperties":true,"allOf":[{"if":{"properties":{"state":{"const":"available"}},"required":["state"]},"then":{"properties":{"estimatedRemainingSeconds":{"type":"number","minimum":0},"estimatedCompletionAt":{"type":"string","format":"date-time"},"unavailableReason":{"type":"null"}}},"else":{"properties":{"estimatedRemainingSeconds":{"type":"null"},"estimatedCompletionAt":{"type":"null"},"unavailableReason":{"type":"string","minLength":1}}}}]},"Coverage":{"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"knownEligible":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"indexedCurrent":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"emptyCurrent":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unindexableCurrent":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"stale":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"neverProcessed":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"pendingDeletions":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sampledAt","knownEligible","indexedCurrent","emptyCurrent","unindexableCurrent","stale","neverProcessed","pendingDeletions","unavailableReason"],"additionalProperties":true,"description":"knownEligible is the sum of the five mutually exclusive revision states. stale means an older receipt exists, including an older failed receipt. pendingDeletions is separate. These counts do not imply discovery is complete."},"DepthBoundary":{"type":"object","properties":{"at":{"type":"string","format":"date-time"},"inclusive":{"type":"boolean"}},"required":["at","inclusive"],"additionalProperties":true,"description":"All known eligible dated documents between this boundary and the snapshot are covered; inclusive says whether documents exactly at the boundary are included. An old pending document makes an exclusive boundary possible without rounding timestamps."},"Depth":{"type":"object","properties":{"state":{"type":"string","enum":["applicable","notApplicable","unknown"]},"dateBasis":{"anyOf":[{"type":"string","enum":["emailReceivedAtThenSentAt","parentEmailReceivedAtThenSentAt","sourceDefined"]},{"type":"null"}]},"sourceDateField":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"discoveryComplete":{"type":"boolean"},"oldestIndexedDocumentAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"fullyIndexedSince":{"anyOf":[{"$ref":"#/definitions/DepthBoundary"},{"type":"null"}]},"processedSince":{"anyOf":[{"$ref":"#/definitions/DepthBoundary"},{"type":"null"}]},"pendingDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unindexableDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"undatedDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["state","dateBasis","sourceDateField","discoveryComplete","oldestIndexedDocumentAt","fullyIndexedSince","processedSince","pendingDocuments","unindexableDocuments","undatedDocuments","unavailableReason"],"additionalProperties":true,"description":"Only applicable to chronologically prioritized kinds. fullyIndexedSince requires current indexed/empty receipts; processedSince also accepts current terminal failures. Unknown dates are excluded from the boundary and counted explicitly. Oldest indexed date alone makes no coverage claim."},"Latency":{"type":"object","properties":{"observationSeconds":{"type":"number","minimum":0},"sampleCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"p50Seconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"p95Seconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["observationSeconds","sampleCount","p50Seconds","p95Seconds","unavailableReason"],"additionalProperties":true,"description":"Freshness is measured from discovery of a revision until its first searchable commit. Retry attempts do not reset the start; failed/empty/deleted revisions are excluded."},"ErrorCount":{"type":"object","properties":{"code":{"type":"string","minLength":1},"count":{"type":"integer","minimum":0,"maximum":9007199254740991},"lastOccurredAt":{"type":"string","format":"date-time"}},"required":["code","count","lastOccurredAt"],"additionalProperties":true},"ErrorWindow":{"type":"object","properties":{"observationSeconds":{"type":"number","minimum":0},"attemptFailures":{"type":"integer","minimum":0,"maximum":9007199254740991},"terminalFailures":{"type":"integer","minimum":0,"maximum":9007199254740991},"byCode":{"type":"array","items":{"$ref":"#/definitions/ErrorCount"}},"truncated":{"type":"boolean"}},"required":["observationSeconds","attemptFailures","terminalFailures","byCode","truncated"],"additionalProperties":true,"description":"Bounded recent error-code histogram, without content or filesystem paths. Counts include all failures even when byCode is truncated."},"Segment":{"type":"object","properties":{"kind":{"type":"string","enum":["email","file","teams_message"]},"sourceId":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"mailboxId":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"fileType":{"anyOf":[{"type":"string","enum":["pdf","office","text","image","email","archive","other"]},{"type":"null"}]},"throughput":{"type":"array","items":{"$ref":"#/definitions/ThroughputWindow"}},"backlog":{"$ref":"#/definitions/Backlog"},"eta":{"$ref":"#/definitions/Eta"},"coverage":{"$ref":"#/definitions/Coverage"},"depth":{"$ref":"#/definitions/Depth"},"freshness":{"$ref":"#/definitions/Latency"},"errors":{"$ref":"#/definitions/ErrorWindow"}},"required":["kind","sourceId","mailboxId","fileType","throughput","backlog","eta","coverage","depth","freshness","errors"],"additionalProperties":true,"description":"Null source/mailbox denotes an all-source aggregate. Non-null scopes are independent views, not additional documents. Null fileType denotes all file types; breakdowns apply only to file rows. There must be one 60-second and one 300-second throughput window per segment."},"Generation":{"type":"object","properties":{"instanceId":{"type":"string","minLength":1},"role":{"type":"string","enum":["active","building"]},"sampledAt":{"type":"string","format":"date-time"},"segments":{"type":"array","items":{"$ref":"#/definitions/Segment"}},"chunks":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"terms":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"indexedAvgdl":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"observedAvgdl":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["instanceId","role","sampledAt","segments","chunks","terms","indexedAvgdl","observedAvgdl","unavailableReason"],"additionalProperties":true,"description":"Active and building counters have independent revision receipts. Never sum generations to estimate mailbox progress. An extraction shared across generations can appear in both generation throughput views."},"DiscoverySource":{"type":"object","properties":{"sourceId":{"type":"string","minLength":1},"mailboxId":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"state":{"type":"string","enum":["notStarted","scanning","complete","failed","disabled"]},"discoveryComplete":{"type":"boolean"},"scanStartedAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"lastSuccessfulScanAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"discoveredDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"accessible":{"type":"boolean"},"lastErrorCode":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sourceId","mailboxId","state","discoveryComplete","scanStartedAt","lastSuccessfulScanAt","discoveredDocuments","accessible","lastErrorCode"],"additionalProperties":true,"description":"discoveryComplete refers to the current inventory snapshot; a successful older scan does not imply a current scan is complete."},"SearchStatistics":{"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"observationSeconds":{"type":"number","minimum":0},"queryCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"errorCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"inFlight":{"type":"integer","minimum":0,"maximum":9007199254740991},"p50LatencyMilliseconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"p95LatencyMilliseconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sampledAt","observationSeconds","queryCount","errorCount","inFlight","p50LatencyMilliseconds","p95LatencyMilliseconds","unavailableReason"],"additionalProperties":true}}};
const schema24 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/configuration/sidecar-configuration.schema.json","title":"SidecarConfiguration","description":"An extensible configuration layer. Unknown properties must be accepted and preserved.","type":"object","properties":{"indexing_mailboxes":{"description":"Mailbox indexing overrides. Priority is explicit and independent of array order: lower numbers are processed first, with mailbox ID as a deterministic tie-breaker. Unlisted mailboxes remain enabled with priority 9007199254740991. Null inherits the other layer; an empty array explicitly uses defaults. Mailbox IDs must be unique. Disabling stops new discovery and processing but retains existing searchable data; in-flight work may finish.","type":["array","null"],"items":{"type":"object","properties":{"mailbox_id":{"type":"string","format":"uuid"},"enabled":{"type":"boolean"},"priority":{"description":"Indexing priority; lower numbers are processed first. Array order has no effect.","type":"integer","minimum":0,"maximum":9007199254740991}},"required":["mailbox_id","enabled","priority"],"additionalProperties":true}},"show_tray_icon":{"description":"Whether the sidecar should show its system tray icon. Null leaves the decision to the other configuration layer or the sidecar default.","type":["boolean","null"]},"indexing_parallelism":{"type":["integer","null"],"minimum":1,"maximum":9007199254740991,"description":"Maximum documents concurrently processed across all kinds and generations, including extraction and commit. Lowering it lets in-flight documents finish and prevents excess new starts. Null or absence inherits the other layer; the sidecar default is 1. Zero is invalid and does not pause indexing."},"indexing_documents_per_minute":{"type":["integer","null"],"minimum":1,"maximum":9007199254740991,"description":"Global maximum document-processing starts per rolling 60 seconds, shared by all workers, kinds and generations. Retry attempts consume this budget; one extraction shared by generations consumes it once. Deletion-only cleanup does not consume it. Null or absence inherits the other layer; the sidecar default is 40. Zero is invalid and does not pause indexing."}},"additionalProperties":true};
const schema26 = {"type":"object","properties":{"parallelism":{"type":"integer","minimum":1,"maximum":9007199254740991},"documentsPerMinute":{"type":"integer","minimum":1,"maximum":9007199254740991}},"required":["parallelism","documentsPerMinute"],"additionalProperties":true};
const schema50 = {"type":"object","properties":{"sourceId":{"type":"string","minLength":1},"mailboxId":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"state":{"type":"string","enum":["notStarted","scanning","complete","failed","disabled"]},"discoveryComplete":{"type":"boolean"},"scanStartedAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"lastSuccessfulScanAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"discoveredDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"accessible":{"type":"boolean"},"lastErrorCode":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sourceId","mailboxId","state","discoveryComplete","scanStartedAt","lastSuccessfulScanAt","discoveredDocuments","accessible","lastErrorCode"],"additionalProperties":true,"description":"discoveryComplete refers to the current inventory snapshot; a successful older scan does not imply a current scan is complete."};
const schema51 = {"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"observationSeconds":{"type":"number","minimum":0},"queryCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"errorCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"inFlight":{"type":"integer","minimum":0,"maximum":9007199254740991},"p50LatencyMilliseconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"p95LatencyMilliseconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sampledAt","observationSeconds","queryCount","errorCount","inFlight","p50LatencyMilliseconds","p95LatencyMilliseconds","unavailableReason"],"additionalProperties":true};
const schema27 = {"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"observationSeconds":{"type":"number","minimum":0},"sidecar":{"$ref":"#/definitions/ProcessResources"},"extractionWorkers":{"$ref":"#/definitions/ProcessResources"},"disk":{"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"allocatedBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"logicalBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"availableBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"breakdown":{"type":"object","properties":{"control":{"$ref":"#/definitions/DiskUsage"},"catalog":{"$ref":"#/definitions/DiskUsage"},"activeIndex":{"$ref":"#/definitions/DiskUsage"},"buildingIndex":{"$ref":"#/definitions/DiskUsage"},"retiredIndexes":{"$ref":"#/definitions/DiskUsage"},"wal":{"$ref":"#/definitions/DiskUsage"},"temporary":{"$ref":"#/definitions/DiskUsage"}},"required":["control","catalog","activeIndex","buildingIndex","retiredIndexes","wal","temporary"],"additionalProperties":true},"unavailableMetrics":{"type":"array","items":{"$ref":"#/definitions/UnavailableMetric"}}},"required":["sampledAt","allocatedBytes","logicalBytes","availableBytes","breakdown","unavailableMetrics"],"additionalProperties":true},"liveExtractionWorkers":{"type":"array","description":"Individual currently live workers. Their memory sums can double-count shared pages. Aggregate CPU/I/O above also includes workers that exited during the sample.","items":{"type":"object","properties":{"processId":{"type":"integer","minimum":1,"maximum":9007199254740991},"sampledAt":{"type":"string","format":"date-time"},"resources":{"$ref":"#/definitions/ProcessResources"}},"required":["processId","sampledAt","resources"],"additionalProperties":true}}},"required":["sampledAt","observationSeconds","sidecar","extractionWorkers","disk","liveExtractionWorkers"],"additionalProperties":true};
const schema30 = {"type":"object","properties":{"allocatedBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"logicalBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]}},"required":["allocatedBytes","logicalBytes"],"additionalProperties":true};
const schema29 = {"type":"object","properties":{"metric":{"type":"string","minLength":1},"reason":{"type":"string","minLength":1}},"required":["metric","reason"],"additionalProperties":true,"description":"Metric is a dotted path relative to its containing section. Every unavailable null measurement must have an entry; zero means an observed zero."};
const schema28 = {"type":"object","properties":{"processCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"cpuCoresUsed":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"memoryResidentBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"memoryResidentPeakBytes":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"diskReadBytesPerSecond":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"diskWriteBytesPerSecond":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableMetrics":{"type":"array","items":{"$ref":"#/definitions/UnavailableMetric"}}},"required":["processCount","cpuCoresUsed","memoryResidentBytes","memoryResidentPeakBytes","diskReadBytesPerSecond","diskWriteBytesPerSecond","unavailableMetrics"],"additionalProperties":true,"description":"Sidecar measurements include search and discovery. Worker measurements aggregate extraction children, including CPU/I/O accrued by children that exit between samples. Resident sums may double-count shared pages; peak is the maximum simultaneously observed aggregate since process startup."};

function validate24(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate24.errors = vErrors;
return errors === 0;
}


function validate23(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!(formats6.validate(data0))){
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
if(!(validate24(data.sidecar, {instancePath:instancePath+"/sidecar",parentData:data,parentDataProperty:"sidecar",rootData}))){
vErrors = vErrors === null ? validate24.errors : vErrors.concat(validate24.errors);
errors = vErrors.length;
}
}
if(data.extractionWorkers !== undefined){
if(!(validate24(data.extractionWorkers, {instancePath:instancePath+"/extractionWorkers",parentData:data,parentDataProperty:"extractionWorkers",rootData}))){
vErrors = vErrors === null ? validate24.errors : vErrors.concat(validate24.errors);
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
if(!(formats6.validate(data5))){
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
if(!(formats6.validate(data38))){
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
if(!(validate24(data36.resources, {instancePath:instancePath+"/liveExtractionWorkers/" + i1+"/resources",parentData:data36,parentDataProperty:"resources",rootData}))){
vErrors = vErrors === null ? validate24.errors : vErrors.concat(validate24.errors);
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
validate23.errors = vErrors;
return errors === 0;
}

const schema38 = {"type":"object","properties":{"instanceId":{"type":"string","minLength":1},"role":{"type":"string","enum":["active","building"]},"sampledAt":{"type":"string","format":"date-time"},"segments":{"type":"array","items":{"$ref":"#/definitions/Segment"}},"chunks":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"terms":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"indexedAvgdl":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"observedAvgdl":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["instanceId","role","sampledAt","segments","chunks","terms","indexedAvgdl","observedAvgdl","unavailableReason"],"additionalProperties":true,"description":"Active and building counters have independent revision receipts. Never sum generations to estimate mailbox progress. An extraction shared across generations can appear in both generation throughput views."};
const schema39 = {"type":"object","properties":{"kind":{"type":"string","enum":["email","file","teams_message"]},"sourceId":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"mailboxId":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"fileType":{"anyOf":[{"type":"string","enum":["pdf","office","text","image","email","archive","other"]},{"type":"null"}]},"throughput":{"type":"array","items":{"$ref":"#/definitions/ThroughputWindow"}},"backlog":{"$ref":"#/definitions/Backlog"},"eta":{"$ref":"#/definitions/Eta"},"coverage":{"$ref":"#/definitions/Coverage"},"depth":{"$ref":"#/definitions/Depth"},"freshness":{"$ref":"#/definitions/Latency"},"errors":{"$ref":"#/definitions/ErrorWindow"}},"required":["kind","sourceId","mailboxId","fileType","throughput","backlog","eta","coverage","depth","freshness","errors"],"additionalProperties":true,"description":"Null source/mailbox denotes an all-source aggregate. Non-null scopes are independent views, not additional documents. Null fileType denotes all file types; breakdowns apply only to file rows. There must be one 60-second and one 300-second throughput window per segment."};
const schema40 = {"type":"object","properties":{"targetWindowSeconds":{"type":"integer","enum":[60,300]},"observationSeconds":{"type":"number","minimum":0},"sampleCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"indexedPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"emptyPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unindexablePerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"completedPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"attemptsPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"retriesPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"deletionsPerMinute":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"extractedTextBytesPerSecond":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["targetWindowSeconds","observationSeconds","sampleCount","indexedPerMinute","emptyPerMinute","unindexablePerMinute","completedPerMinute","attemptsPerMinute","retriesPerMinute","deletionsPerMinute","extractedTextBytesPerSecond","unavailableReason"],"additionalProperties":true};
const schema41 = {"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"discoveryComplete":{"type":"boolean"},"remaining":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"ready":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"inProgress":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"retryDeferred":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"blocked":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"firstTime":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"updates":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sampledAt","discoveryComplete","remaining","ready","inProgress","retryDeferred","blocked","firstTime","updates","unavailableReason"],"additionalProperties":true,"description":"Counts concern current eligible revisions, not queue entries. remaining = ready + inProgress + retryDeferred + blocked = firstTime + updates. Incomplete discovery still permits exact counts for known work. Terminal outcomes and deletion-only cleanup are excluded."};
const schema42 = {"type":"object","properties":{"state":{"type":"string","enum":["available","unavailable"]},"estimatedRemainingSeconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"estimatedCompletionAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"basis":{"const":"knownBacklog"},"rateWindowSeconds":{"type":"integer","enum":[60,300]},"observationSeconds":{"type":"number","minimum":0},"sampleCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["state","estimatedRemainingSeconds","estimatedCompletionAt","basis","rateWindowSeconds","observationSeconds","sampleCount","unavailableReason"],"additionalProperties":true,"allOf":[{"if":{"properties":{"state":{"const":"available"}},"required":["state"]},"then":{"properties":{"estimatedRemainingSeconds":{"type":"number","minimum":0},"estimatedCompletionAt":{"type":"string","format":"date-time"},"unavailableReason":{"type":"null"}}},"else":{"properties":{"estimatedRemainingSeconds":{"type":"null"},"estimatedCompletionAt":{"type":"null"},"unavailableReason":{"type":"string","minLength":1}}}}]};
const schema43 = {"type":"object","properties":{"sampledAt":{"type":"string","format":"date-time"},"knownEligible":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"indexedCurrent":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"emptyCurrent":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unindexableCurrent":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"stale":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"neverProcessed":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"pendingDeletions":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["sampledAt","knownEligible","indexedCurrent","emptyCurrent","unindexableCurrent","stale","neverProcessed","pendingDeletions","unavailableReason"],"additionalProperties":true,"description":"knownEligible is the sum of the five mutually exclusive revision states. stale means an older receipt exists, including an older failed receipt. pendingDeletions is separate. These counts do not imply discovery is complete."};
const schema47 = {"type":"object","properties":{"observationSeconds":{"type":"number","minimum":0},"sampleCount":{"type":"integer","minimum":0,"maximum":9007199254740991},"p50Seconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"p95Seconds":{"anyOf":[{"type":"number","minimum":0},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["observationSeconds","sampleCount","p50Seconds","p95Seconds","unavailableReason"],"additionalProperties":true,"description":"Freshness is measured from discovery of a revision until its first searchable commit. Retry attempts do not reset the start; failed/empty/deleted revisions are excluded."};
const schema44 = {"type":"object","properties":{"state":{"type":"string","enum":["applicable","notApplicable","unknown"]},"dateBasis":{"anyOf":[{"type":"string","enum":["emailReceivedAtThenSentAt","parentEmailReceivedAtThenSentAt","sourceDefined"]},{"type":"null"}]},"sourceDateField":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]},"discoveryComplete":{"type":"boolean"},"oldestIndexedDocumentAt":{"anyOf":[{"type":"string","format":"date-time"},{"type":"null"}]},"fullyIndexedSince":{"anyOf":[{"$ref":"#/definitions/DepthBoundary"},{"type":"null"}]},"processedSince":{"anyOf":[{"$ref":"#/definitions/DepthBoundary"},{"type":"null"}]},"pendingDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unindexableDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"undatedDocuments":{"anyOf":[{"type":"integer","minimum":0,"maximum":9007199254740991},{"type":"null"}]},"unavailableReason":{"anyOf":[{"type":"string","minLength":1},{"type":"null"}]}},"required":["state","dateBasis","sourceDateField","discoveryComplete","oldestIndexedDocumentAt","fullyIndexedSince","processedSince","pendingDocuments","unindexableDocuments","undatedDocuments","unavailableReason"],"additionalProperties":true,"description":"Only applicable to chronologically prioritized kinds. fullyIndexedSince requires current indexed/empty receipts; processedSince also accepts current terminal failures. Unknown dates are excluded from the boundary and counted explicitly. Oldest indexed date alone makes no coverage claim."};
const schema45 = {"type":"object","properties":{"at":{"type":"string","format":"date-time"},"inclusive":{"type":"boolean"}},"required":["at","inclusive"],"additionalProperties":true,"description":"All known eligible dated documents between this boundary and the snapshot are covered; inclusive says whether documents exactly at the boundary are included. An old pending document makes an exclusive boundary possible without rounding timestamps."};

function validate31(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
const err12 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/enum",keyword:"enum",params:{allowedValues: schema44.properties.state.enum},message:"must be equal to one of the allowed values"};
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
const err14 = {instancePath:instancePath+"/dateBasis",schemaPath:"#/properties/dateBasis/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema44.properties.dateBasis.anyOf[0].enum},message:"must be equal to one of the allowed values"};
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
if(!(formats6.validate(data4))){
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
if(!(formats6.validate(data6))){
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
if(!(formats6.validate(data9))){
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
validate31.errors = vErrors;
return errors === 0;
}

const schema48 = {"type":"object","properties":{"observationSeconds":{"type":"number","minimum":0},"attemptFailures":{"type":"integer","minimum":0,"maximum":9007199254740991},"terminalFailures":{"type":"integer","minimum":0,"maximum":9007199254740991},"byCode":{"type":"array","items":{"$ref":"#/definitions/ErrorCount"}},"truncated":{"type":"boolean"}},"required":["observationSeconds","attemptFailures","terminalFailures","byCode","truncated"],"additionalProperties":true,"description":"Bounded recent error-code histogram, without content or filesystem paths. Counts include all failures even when byCode is truncated."};
const schema49 = {"type":"object","properties":{"code":{"type":"string","minLength":1},"count":{"type":"integer","minimum":0,"maximum":9007199254740991},"lastOccurredAt":{"type":"string","format":"date-time"}},"required":["code","count","lastOccurredAt"],"additionalProperties":true};

function validate33(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!(formats6.validate(data7))){
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
validate33.errors = vErrors;
return errors === 0;
}


function validate30(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!(((data0 === "email") || (data0 === "file")) || (data0 === "teams_message"))){
const err12 = {instancePath:instancePath+"/kind",schemaPath:"#/properties/kind/enum",keyword:"enum",params:{allowedValues: schema39.properties.kind.enum},message:"must be equal to one of the allowed values"};
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
const err22 = {instancePath:instancePath+"/fileType",schemaPath:"#/properties/fileType/anyOf/0/enum",keyword:"enum",params:{allowedValues: schema39.properties.fileType.anyOf[0].enum},message:"must be equal to one of the allowed values"};
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
const err38 = {instancePath:instancePath+"/throughput/" + i0+"/targetWindowSeconds",schemaPath:"#/definitions/ThroughputWindow/properties/targetWindowSeconds/enum",keyword:"enum",params:{allowedValues: schema40.properties.targetWindowSeconds.enum},message:"must be equal to one of the allowed values"};
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
if(!(formats6.validate(data19))){
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
if(!(formats6.validate(data32))){
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
const err156 = {instancePath:instancePath+"/eta/state",schemaPath:"#/definitions/Eta/properties/state/enum",keyword:"enum",params:{allowedValues: schema42.properties.state.enum},message:"must be equal to one of the allowed values"};
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
if(!(formats6.validate(data39))){
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
const err167 = {instancePath:instancePath+"/eta/rateWindowSeconds",schemaPath:"#/definitions/Eta/properties/rateWindowSeconds/enum",keyword:"enum",params:{allowedValues: schema42.properties.rateWindowSeconds.enum},message:"must be equal to one of the allowed values"};
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
if(!(formats6.validate(data46))){
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
if(!(validate31(data.depth, {instancePath:instancePath+"/depth",parentData:data,parentDataProperty:"depth",rootData}))){
vErrors = vErrors === null ? validate31.errors : vErrors.concat(validate31.errors);
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
if(!(validate33(data.errors, {instancePath:instancePath+"/errors",parentData:data,parentDataProperty:"errors",rootData}))){
vErrors = vErrors === null ? validate33.errors : vErrors.concat(validate33.errors);
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
validate30.errors = vErrors;
return errors === 0;
}


function validate29(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
const err12 = {instancePath:instancePath+"/role",schemaPath:"#/properties/role/enum",keyword:"enum",params:{allowedValues: schema38.properties.role.enum},message:"must be equal to one of the allowed values"};
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
if(!(formats6.validate(data2))){
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
if(!(validate30(data3[i0], {instancePath:instancePath+"/segments/" + i0,parentData:data3,parentDataProperty:i0,rootData}))){
vErrors = vErrors === null ? validate30.errors : vErrors.concat(validate30.errors);
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
validate29.errors = vErrors;
return errors === 0;
}

const pattern10 = new RegExp("^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)", "u");

function validate22(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(data.configuration !== undefined){
let data0 = data.configuration;
if(data0 && typeof data0 == "object" && !Array.isArray(data0)){
if(data0.user_configuration === undefined){
const err9 = {instancePath:instancePath+"/configuration",schemaPath:"#/properties/configuration/required",keyword:"required",params:{missingProperty: "user_configuration"},message:"must have required property '"+"user_configuration"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data0.organization_configuration === undefined){
const err10 = {instancePath:instancePath+"/configuration",schemaPath:"#/properties/configuration/required",keyword:"required",params:{missingProperty: "organization_configuration"},message:"must have required property '"+"organization_configuration"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data0.user_configuration !== undefined){
let data1 = data0.user_configuration;
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.indexing_mailboxes !== undefined){
let data2 = data1.indexing_mailboxes;
if((!(Array.isArray(data2))) && (data2 !== null)){
const err11 = {instancePath:instancePath+"/configuration/user_configuration/indexing_mailboxes",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/type",keyword:"type",params:{type: schema24.properties.indexing_mailboxes.type},message:"must be array,null"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(Array.isArray(data2)){
const len0 = data2.length;
for(let i0=0; i0<len0; i0++){
let data3 = data2[i0];
if(data3 && typeof data3 == "object" && !Array.isArray(data3)){
if(data3.mailbox_id === undefined){
const err12 = {instancePath:instancePath+"/configuration/user_configuration/indexing_mailboxes/" + i0,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/required",keyword:"required",params:{missingProperty: "mailbox_id"},message:"must have required property '"+"mailbox_id"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data3.enabled === undefined){
const err13 = {instancePath:instancePath+"/configuration/user_configuration/indexing_mailboxes/" + i0,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/required",keyword:"required",params:{missingProperty: "enabled"},message:"must have required property '"+"enabled"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data3.priority === undefined){
const err14 = {instancePath:instancePath+"/configuration/user_configuration/indexing_mailboxes/" + i0,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/required",keyword:"required",params:{missingProperty: "priority"},message:"must have required property '"+"priority"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
if(data3.mailbox_id !== undefined){
let data4 = data3.mailbox_id;
if(typeof data4 === "string"){
if(!(formats0.test(data4))){
const err15 = {instancePath:instancePath+"/configuration/user_configuration/indexing_mailboxes/" + i0+"/mailbox_id",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/mailbox_id/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err16 = {instancePath:instancePath+"/configuration/user_configuration/indexing_mailboxes/" + i0+"/mailbox_id",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/mailbox_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data3.enabled !== undefined){
if(typeof data3.enabled !== "boolean"){
const err17 = {instancePath:instancePath+"/configuration/user_configuration/indexing_mailboxes/" + i0+"/enabled",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/enabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data3.priority !== undefined){
let data6 = data3.priority;
if(!(((typeof data6 == "number") && (!(data6 % 1) && !isNaN(data6))) && (isFinite(data6)))){
const err18 = {instancePath:instancePath+"/configuration/user_configuration/indexing_mailboxes/" + i0+"/priority",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/priority/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
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
const err19 = {instancePath:instancePath+"/configuration/user_configuration/indexing_mailboxes/" + i0+"/priority",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/priority/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
if(data6 < 0 || isNaN(data6)){
const err20 = {instancePath:instancePath+"/configuration/user_configuration/indexing_mailboxes/" + i0+"/priority",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/priority/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
}
else {
const err21 = {instancePath:instancePath+"/configuration/user_configuration/indexing_mailboxes/" + i0,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
}
if(data1.show_tray_icon !== undefined){
let data7 = data1.show_tray_icon;
if((typeof data7 !== "boolean") && (data7 !== null)){
const err22 = {instancePath:instancePath+"/configuration/user_configuration/show_tray_icon",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/show_tray_icon/type",keyword:"type",params:{type: schema24.properties.show_tray_icon.type},message:"must be boolean,null"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data1.indexing_parallelism !== undefined){
let data8 = data1.indexing_parallelism;
if((!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))) && (data8 !== null)){
const err23 = {instancePath:instancePath+"/configuration/user_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/type",keyword:"type",params:{type: schema24.properties.indexing_parallelism.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 > 9007199254740991 || isNaN(data8)){
const err24 = {instancePath:instancePath+"/configuration/user_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data8 < 1 || isNaN(data8)){
const err25 = {instancePath:instancePath+"/configuration/user_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data1.indexing_documents_per_minute !== undefined){
let data9 = data1.indexing_documents_per_minute;
if((!(((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9))) && (isFinite(data9)))) && (data9 !== null)){
const err26 = {instancePath:instancePath+"/configuration/user_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/type",keyword:"type",params:{type: schema24.properties.indexing_documents_per_minute.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
if((typeof data9 == "number") && (isFinite(data9))){
if(data9 > 9007199254740991 || isNaN(data9)){
const err27 = {instancePath:instancePath+"/configuration/user_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
if(data9 < 1 || isNaN(data9)){
const err28 = {instancePath:instancePath+"/configuration/user_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
}
else {
const err29 = {instancePath:instancePath+"/configuration/user_configuration",schemaPath:"../configuration/sidecar-configuration.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data0.organization_configuration !== undefined){
let data10 = data0.organization_configuration;
if(data10 && typeof data10 == "object" && !Array.isArray(data10)){
if(data10.indexing_mailboxes !== undefined){
let data11 = data10.indexing_mailboxes;
if((!(Array.isArray(data11))) && (data11 !== null)){
const err30 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_mailboxes",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/type",keyword:"type",params:{type: schema24.properties.indexing_mailboxes.type},message:"must be array,null"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
if(Array.isArray(data11)){
const len1 = data11.length;
for(let i1=0; i1<len1; i1++){
let data12 = data11[i1];
if(data12 && typeof data12 == "object" && !Array.isArray(data12)){
if(data12.mailbox_id === undefined){
const err31 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_mailboxes/" + i1,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/required",keyword:"required",params:{missingProperty: "mailbox_id"},message:"must have required property '"+"mailbox_id"+"'"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
if(data12.enabled === undefined){
const err32 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_mailboxes/" + i1,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/required",keyword:"required",params:{missingProperty: "enabled"},message:"must have required property '"+"enabled"+"'"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
if(data12.priority === undefined){
const err33 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_mailboxes/" + i1,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/required",keyword:"required",params:{missingProperty: "priority"},message:"must have required property '"+"priority"+"'"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if(data12.mailbox_id !== undefined){
let data13 = data12.mailbox_id;
if(typeof data13 === "string"){
if(!(formats0.test(data13))){
const err34 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_mailboxes/" + i1+"/mailbox_id",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/mailbox_id/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err35 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_mailboxes/" + i1+"/mailbox_id",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/mailbox_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
if(data12.enabled !== undefined){
if(typeof data12.enabled !== "boolean"){
const err36 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_mailboxes/" + i1+"/enabled",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/enabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
if(data12.priority !== undefined){
let data15 = data12.priority;
if(!(((typeof data15 == "number") && (!(data15 % 1) && !isNaN(data15))) && (isFinite(data15)))){
const err37 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_mailboxes/" + i1+"/priority",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/priority/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if((typeof data15 == "number") && (isFinite(data15))){
if(data15 > 9007199254740991 || isNaN(data15)){
const err38 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_mailboxes/" + i1+"/priority",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/priority/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(data15 < 0 || isNaN(data15)){
const err39 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_mailboxes/" + i1+"/priority",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/priority/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
}
else {
const err40 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_mailboxes/" + i1,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
}
if(data10.show_tray_icon !== undefined){
let data16 = data10.show_tray_icon;
if((typeof data16 !== "boolean") && (data16 !== null)){
const err41 = {instancePath:instancePath+"/configuration/organization_configuration/show_tray_icon",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/show_tray_icon/type",keyword:"type",params:{type: schema24.properties.show_tray_icon.type},message:"must be boolean,null"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
if(data10.indexing_parallelism !== undefined){
let data17 = data10.indexing_parallelism;
if((!(((typeof data17 == "number") && (!(data17 % 1) && !isNaN(data17))) && (isFinite(data17)))) && (data17 !== null)){
const err42 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/type",keyword:"type",params:{type: schema24.properties.indexing_parallelism.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if((typeof data17 == "number") && (isFinite(data17))){
if(data17 > 9007199254740991 || isNaN(data17)){
const err43 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
if(data17 < 1 || isNaN(data17)){
const err44 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
}
if(data10.indexing_documents_per_minute !== undefined){
let data18 = data10.indexing_documents_per_minute;
if((!(((typeof data18 == "number") && (!(data18 % 1) && !isNaN(data18))) && (isFinite(data18)))) && (data18 !== null)){
const err45 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/type",keyword:"type",params:{type: schema24.properties.indexing_documents_per_minute.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
if((typeof data18 == "number") && (isFinite(data18))){
if(data18 > 9007199254740991 || isNaN(data18)){
const err46 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
if(data18 < 1 || isNaN(data18)){
const err47 = {instancePath:instancePath+"/configuration/organization_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
}
else {
const err48 = {instancePath:instancePath+"/configuration/organization_configuration",schemaPath:"../configuration/sidecar-configuration.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err48];
}
else {
vErrors.push(err48);
}
errors++;
}
}
}
else {
const err49 = {instancePath:instancePath+"/configuration",schemaPath:"#/properties/configuration/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err49];
}
else {
vErrors.push(err49);
}
errors++;
}
}
if(data.sampledAt !== undefined){
let data19 = data.sampledAt;
if(typeof data19 === "string"){
if(!(formats6.validate(data19))){
const err50 = {instancePath:instancePath+"/sampledAt",schemaPath:"#/properties/sampledAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
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
const err51 = {instancePath:instancePath+"/sampledAt",schemaPath:"#/properties/sampledAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err51];
}
else {
vErrors.push(err51);
}
errors++;
}
}
if(data.sessionId !== undefined){
let data20 = data.sessionId;
if(typeof data20 === "string"){
if(func2(data20) < 1){
const err52 = {instancePath:instancePath+"/sessionId",schemaPath:"#/properties/sessionId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err53 = {instancePath:instancePath+"/sessionId",schemaPath:"#/properties/sessionId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err53];
}
else {
vErrors.push(err53);
}
errors++;
}
}
if(data.uptimeSeconds !== undefined){
let data21 = data.uptimeSeconds;
if((typeof data21 == "number") && (isFinite(data21))){
if(data21 < 0 || isNaN(data21)){
const err54 = {instancePath:instancePath+"/uptimeSeconds",schemaPath:"#/properties/uptimeSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err54];
}
else {
vErrors.push(err54);
}
errors++;
}
}
else {
const err55 = {instancePath:instancePath+"/uptimeSeconds",schemaPath:"#/properties/uptimeSeconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err55];
}
else {
vErrors.push(err55);
}
errors++;
}
}
if(data.state !== undefined){
let data22 = data.state;
if(typeof data22 !== "string"){
const err56 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err56];
}
else {
vErrors.push(err56);
}
errors++;
}
if(!((((data22 === "running") || (data22 === "stopping")) || (data22 === "stopped")) || (data22 === "blocked"))){
const err57 = {instancePath:instancePath+"/state",schemaPath:"#/properties/state/enum",keyword:"enum",params:{allowedValues: schema23.properties.state.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err57];
}
else {
vErrors.push(err57);
}
errors++;
}
}
if(data.effectiveConfiguration !== undefined){
let data23 = data.effectiveConfiguration;
if(data23 && typeof data23 == "object" && !Array.isArray(data23)){
if(data23.parallelism === undefined){
const err58 = {instancePath:instancePath+"/effectiveConfiguration",schemaPath:"#/definitions/EffectiveIndexingConfiguration/required",keyword:"required",params:{missingProperty: "parallelism"},message:"must have required property '"+"parallelism"+"'"};
if(vErrors === null){
vErrors = [err58];
}
else {
vErrors.push(err58);
}
errors++;
}
if(data23.documentsPerMinute === undefined){
const err59 = {instancePath:instancePath+"/effectiveConfiguration",schemaPath:"#/definitions/EffectiveIndexingConfiguration/required",keyword:"required",params:{missingProperty: "documentsPerMinute"},message:"must have required property '"+"documentsPerMinute"+"'"};
if(vErrors === null){
vErrors = [err59];
}
else {
vErrors.push(err59);
}
errors++;
}
if(data23.parallelism !== undefined){
let data24 = data23.parallelism;
if(!(((typeof data24 == "number") && (!(data24 % 1) && !isNaN(data24))) && (isFinite(data24)))){
const err60 = {instancePath:instancePath+"/effectiveConfiguration/parallelism",schemaPath:"#/definitions/EffectiveIndexingConfiguration/properties/parallelism/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err60];
}
else {
vErrors.push(err60);
}
errors++;
}
if((typeof data24 == "number") && (isFinite(data24))){
if(data24 > 9007199254740991 || isNaN(data24)){
const err61 = {instancePath:instancePath+"/effectiveConfiguration/parallelism",schemaPath:"#/definitions/EffectiveIndexingConfiguration/properties/parallelism/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err61];
}
else {
vErrors.push(err61);
}
errors++;
}
if(data24 < 1 || isNaN(data24)){
const err62 = {instancePath:instancePath+"/effectiveConfiguration/parallelism",schemaPath:"#/definitions/EffectiveIndexingConfiguration/properties/parallelism/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err62];
}
else {
vErrors.push(err62);
}
errors++;
}
}
}
if(data23.documentsPerMinute !== undefined){
let data25 = data23.documentsPerMinute;
if(!(((typeof data25 == "number") && (!(data25 % 1) && !isNaN(data25))) && (isFinite(data25)))){
const err63 = {instancePath:instancePath+"/effectiveConfiguration/documentsPerMinute",schemaPath:"#/definitions/EffectiveIndexingConfiguration/properties/documentsPerMinute/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err63];
}
else {
vErrors.push(err63);
}
errors++;
}
if((typeof data25 == "number") && (isFinite(data25))){
if(data25 > 9007199254740991 || isNaN(data25)){
const err64 = {instancePath:instancePath+"/effectiveConfiguration/documentsPerMinute",schemaPath:"#/definitions/EffectiveIndexingConfiguration/properties/documentsPerMinute/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err64];
}
else {
vErrors.push(err64);
}
errors++;
}
if(data25 < 1 || isNaN(data25)){
const err65 = {instancePath:instancePath+"/effectiveConfiguration/documentsPerMinute",schemaPath:"#/definitions/EffectiveIndexingConfiguration/properties/documentsPerMinute/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
if(vErrors === null){
vErrors = [err65];
}
else {
vErrors.push(err65);
}
errors++;
}
}
}
}
else {
const err66 = {instancePath:instancePath+"/effectiveConfiguration",schemaPath:"#/definitions/EffectiveIndexingConfiguration/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err66];
}
else {
vErrors.push(err66);
}
errors++;
}
}
if(data.resources !== undefined){
if(!(validate23(data.resources, {instancePath:instancePath+"/resources",parentData:data,parentDataProperty:"resources",rootData}))){
vErrors = vErrors === null ? validate23.errors : vErrors.concat(validate23.errors);
errors = vErrors.length;
}
}
if(data.generations !== undefined){
let data27 = data.generations;
if(Array.isArray(data27)){
const len2 = data27.length;
for(let i2=0; i2<len2; i2++){
if(!(validate29(data27[i2], {instancePath:instancePath+"/generations/" + i2,parentData:data27,parentDataProperty:i2,rootData}))){
vErrors = vErrors === null ? validate29.errors : vErrors.concat(validate29.errors);
errors = vErrors.length;
}
}
}
else {
const err67 = {instancePath:instancePath+"/generations",schemaPath:"#/properties/generations/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err67];
}
else {
vErrors.push(err67);
}
errors++;
}
}
if(data.discovery !== undefined){
let data29 = data.discovery;
if(Array.isArray(data29)){
const len3 = data29.length;
for(let i3=0; i3<len3; i3++){
let data30 = data29[i3];
if(data30 && typeof data30 == "object" && !Array.isArray(data30)){
if(data30.sourceId === undefined){
const err68 = {instancePath:instancePath+"/discovery/" + i3,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "sourceId"},message:"must have required property '"+"sourceId"+"'"};
if(vErrors === null){
vErrors = [err68];
}
else {
vErrors.push(err68);
}
errors++;
}
if(data30.mailboxId === undefined){
const err69 = {instancePath:instancePath+"/discovery/" + i3,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "mailboxId"},message:"must have required property '"+"mailboxId"+"'"};
if(vErrors === null){
vErrors = [err69];
}
else {
vErrors.push(err69);
}
errors++;
}
if(data30.state === undefined){
const err70 = {instancePath:instancePath+"/discovery/" + i3,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "state"},message:"must have required property '"+"state"+"'"};
if(vErrors === null){
vErrors = [err70];
}
else {
vErrors.push(err70);
}
errors++;
}
if(data30.discoveryComplete === undefined){
const err71 = {instancePath:instancePath+"/discovery/" + i3,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "discoveryComplete"},message:"must have required property '"+"discoveryComplete"+"'"};
if(vErrors === null){
vErrors = [err71];
}
else {
vErrors.push(err71);
}
errors++;
}
if(data30.scanStartedAt === undefined){
const err72 = {instancePath:instancePath+"/discovery/" + i3,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "scanStartedAt"},message:"must have required property '"+"scanStartedAt"+"'"};
if(vErrors === null){
vErrors = [err72];
}
else {
vErrors.push(err72);
}
errors++;
}
if(data30.lastSuccessfulScanAt === undefined){
const err73 = {instancePath:instancePath+"/discovery/" + i3,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "lastSuccessfulScanAt"},message:"must have required property '"+"lastSuccessfulScanAt"+"'"};
if(vErrors === null){
vErrors = [err73];
}
else {
vErrors.push(err73);
}
errors++;
}
if(data30.discoveredDocuments === undefined){
const err74 = {instancePath:instancePath+"/discovery/" + i3,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "discoveredDocuments"},message:"must have required property '"+"discoveredDocuments"+"'"};
if(vErrors === null){
vErrors = [err74];
}
else {
vErrors.push(err74);
}
errors++;
}
if(data30.accessible === undefined){
const err75 = {instancePath:instancePath+"/discovery/" + i3,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "accessible"},message:"must have required property '"+"accessible"+"'"};
if(vErrors === null){
vErrors = [err75];
}
else {
vErrors.push(err75);
}
errors++;
}
if(data30.lastErrorCode === undefined){
const err76 = {instancePath:instancePath+"/discovery/" + i3,schemaPath:"#/definitions/DiscoverySource/required",keyword:"required",params:{missingProperty: "lastErrorCode"},message:"must have required property '"+"lastErrorCode"+"'"};
if(vErrors === null){
vErrors = [err76];
}
else {
vErrors.push(err76);
}
errors++;
}
if(data30.sourceId !== undefined){
let data31 = data30.sourceId;
if(typeof data31 === "string"){
if(func2(data31) < 1){
const err77 = {instancePath:instancePath+"/discovery/" + i3+"/sourceId",schemaPath:"#/definitions/DiscoverySource/properties/sourceId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err77];
}
else {
vErrors.push(err77);
}
errors++;
}
}
else {
const err78 = {instancePath:instancePath+"/discovery/" + i3+"/sourceId",schemaPath:"#/definitions/DiscoverySource/properties/sourceId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err78];
}
else {
vErrors.push(err78);
}
errors++;
}
}
if(data30.mailboxId !== undefined){
let data32 = data30.mailboxId;
const _errs76 = errors;
let valid20 = false;
const _errs77 = errors;
if(typeof data32 === "string"){
if(func2(data32) < 1){
const err79 = {instancePath:instancePath+"/discovery/" + i3+"/mailboxId",schemaPath:"#/definitions/DiscoverySource/properties/mailboxId/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err79];
}
else {
vErrors.push(err79);
}
errors++;
}
}
else {
const err80 = {instancePath:instancePath+"/discovery/" + i3+"/mailboxId",schemaPath:"#/definitions/DiscoverySource/properties/mailboxId/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err80];
}
else {
vErrors.push(err80);
}
errors++;
}
var _valid0 = _errs77 === errors;
valid20 = valid20 || _valid0;
if(!valid20){
const _errs79 = errors;
if(data32 !== null){
const err81 = {instancePath:instancePath+"/discovery/" + i3+"/mailboxId",schemaPath:"#/definitions/DiscoverySource/properties/mailboxId/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err81];
}
else {
vErrors.push(err81);
}
errors++;
}
var _valid0 = _errs79 === errors;
valid20 = valid20 || _valid0;
}
if(!valid20){
const err82 = {instancePath:instancePath+"/discovery/" + i3+"/mailboxId",schemaPath:"#/definitions/DiscoverySource/properties/mailboxId/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err82];
}
else {
vErrors.push(err82);
}
errors++;
}
else {
errors = _errs76;
if(vErrors !== null){
if(_errs76){
vErrors.length = _errs76;
}
else {
vErrors = null;
}
}
}
}
if(data30.state !== undefined){
let data33 = data30.state;
if(typeof data33 !== "string"){
const err83 = {instancePath:instancePath+"/discovery/" + i3+"/state",schemaPath:"#/definitions/DiscoverySource/properties/state/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err83];
}
else {
vErrors.push(err83);
}
errors++;
}
if(!(((((data33 === "notStarted") || (data33 === "scanning")) || (data33 === "complete")) || (data33 === "failed")) || (data33 === "disabled"))){
const err84 = {instancePath:instancePath+"/discovery/" + i3+"/state",schemaPath:"#/definitions/DiscoverySource/properties/state/enum",keyword:"enum",params:{allowedValues: schema50.properties.state.enum},message:"must be equal to one of the allowed values"};
if(vErrors === null){
vErrors = [err84];
}
else {
vErrors.push(err84);
}
errors++;
}
}
if(data30.discoveryComplete !== undefined){
if(typeof data30.discoveryComplete !== "boolean"){
const err85 = {instancePath:instancePath+"/discovery/" + i3+"/discoveryComplete",schemaPath:"#/definitions/DiscoverySource/properties/discoveryComplete/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err85];
}
else {
vErrors.push(err85);
}
errors++;
}
}
if(data30.scanStartedAt !== undefined){
let data35 = data30.scanStartedAt;
const _errs86 = errors;
let valid21 = false;
const _errs87 = errors;
if(typeof data35 === "string"){
if(!(formats6.validate(data35))){
const err86 = {instancePath:instancePath+"/discovery/" + i3+"/scanStartedAt",schemaPath:"#/definitions/DiscoverySource/properties/scanStartedAt/anyOf/0/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
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
const err87 = {instancePath:instancePath+"/discovery/" + i3+"/scanStartedAt",schemaPath:"#/definitions/DiscoverySource/properties/scanStartedAt/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err87];
}
else {
vErrors.push(err87);
}
errors++;
}
var _valid1 = _errs87 === errors;
valid21 = valid21 || _valid1;
if(!valid21){
const _errs89 = errors;
if(data35 !== null){
const err88 = {instancePath:instancePath+"/discovery/" + i3+"/scanStartedAt",schemaPath:"#/definitions/DiscoverySource/properties/scanStartedAt/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err88];
}
else {
vErrors.push(err88);
}
errors++;
}
var _valid1 = _errs89 === errors;
valid21 = valid21 || _valid1;
}
if(!valid21){
const err89 = {instancePath:instancePath+"/discovery/" + i3+"/scanStartedAt",schemaPath:"#/definitions/DiscoverySource/properties/scanStartedAt/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err89];
}
else {
vErrors.push(err89);
}
errors++;
}
else {
errors = _errs86;
if(vErrors !== null){
if(_errs86){
vErrors.length = _errs86;
}
else {
vErrors = null;
}
}
}
}
if(data30.lastSuccessfulScanAt !== undefined){
let data36 = data30.lastSuccessfulScanAt;
const _errs92 = errors;
let valid22 = false;
const _errs93 = errors;
if(typeof data36 === "string"){
if(!(formats6.validate(data36))){
const err90 = {instancePath:instancePath+"/discovery/" + i3+"/lastSuccessfulScanAt",schemaPath:"#/definitions/DiscoverySource/properties/lastSuccessfulScanAt/anyOf/0/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
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
const err91 = {instancePath:instancePath+"/discovery/" + i3+"/lastSuccessfulScanAt",schemaPath:"#/definitions/DiscoverySource/properties/lastSuccessfulScanAt/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err91];
}
else {
vErrors.push(err91);
}
errors++;
}
var _valid2 = _errs93 === errors;
valid22 = valid22 || _valid2;
if(!valid22){
const _errs95 = errors;
if(data36 !== null){
const err92 = {instancePath:instancePath+"/discovery/" + i3+"/lastSuccessfulScanAt",schemaPath:"#/definitions/DiscoverySource/properties/lastSuccessfulScanAt/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err92];
}
else {
vErrors.push(err92);
}
errors++;
}
var _valid2 = _errs95 === errors;
valid22 = valid22 || _valid2;
}
if(!valid22){
const err93 = {instancePath:instancePath+"/discovery/" + i3+"/lastSuccessfulScanAt",schemaPath:"#/definitions/DiscoverySource/properties/lastSuccessfulScanAt/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err93];
}
else {
vErrors.push(err93);
}
errors++;
}
else {
errors = _errs92;
if(vErrors !== null){
if(_errs92){
vErrors.length = _errs92;
}
else {
vErrors = null;
}
}
}
}
if(data30.discoveredDocuments !== undefined){
let data37 = data30.discoveredDocuments;
const _errs98 = errors;
let valid23 = false;
const _errs99 = errors;
if(!(((typeof data37 == "number") && (!(data37 % 1) && !isNaN(data37))) && (isFinite(data37)))){
const err94 = {instancePath:instancePath+"/discovery/" + i3+"/discoveredDocuments",schemaPath:"#/definitions/DiscoverySource/properties/discoveredDocuments/anyOf/0/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err94];
}
else {
vErrors.push(err94);
}
errors++;
}
if((typeof data37 == "number") && (isFinite(data37))){
if(data37 > 9007199254740991 || isNaN(data37)){
const err95 = {instancePath:instancePath+"/discovery/" + i3+"/discoveredDocuments",schemaPath:"#/definitions/DiscoverySource/properties/discoveredDocuments/anyOf/0/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err95];
}
else {
vErrors.push(err95);
}
errors++;
}
if(data37 < 0 || isNaN(data37)){
const err96 = {instancePath:instancePath+"/discovery/" + i3+"/discoveredDocuments",schemaPath:"#/definitions/DiscoverySource/properties/discoveredDocuments/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err96];
}
else {
vErrors.push(err96);
}
errors++;
}
}
var _valid3 = _errs99 === errors;
valid23 = valid23 || _valid3;
if(!valid23){
const _errs101 = errors;
if(data37 !== null){
const err97 = {instancePath:instancePath+"/discovery/" + i3+"/discoveredDocuments",schemaPath:"#/definitions/DiscoverySource/properties/discoveredDocuments/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err97];
}
else {
vErrors.push(err97);
}
errors++;
}
var _valid3 = _errs101 === errors;
valid23 = valid23 || _valid3;
}
if(!valid23){
const err98 = {instancePath:instancePath+"/discovery/" + i3+"/discoveredDocuments",schemaPath:"#/definitions/DiscoverySource/properties/discoveredDocuments/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err98];
}
else {
vErrors.push(err98);
}
errors++;
}
else {
errors = _errs98;
if(vErrors !== null){
if(_errs98){
vErrors.length = _errs98;
}
else {
vErrors = null;
}
}
}
}
if(data30.accessible !== undefined){
if(typeof data30.accessible !== "boolean"){
const err99 = {instancePath:instancePath+"/discovery/" + i3+"/accessible",schemaPath:"#/definitions/DiscoverySource/properties/accessible/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err99];
}
else {
vErrors.push(err99);
}
errors++;
}
}
if(data30.lastErrorCode !== undefined){
let data39 = data30.lastErrorCode;
const _errs106 = errors;
let valid24 = false;
const _errs107 = errors;
if(typeof data39 === "string"){
if(func2(data39) < 1){
const err100 = {instancePath:instancePath+"/discovery/" + i3+"/lastErrorCode",schemaPath:"#/definitions/DiscoverySource/properties/lastErrorCode/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err100];
}
else {
vErrors.push(err100);
}
errors++;
}
}
else {
const err101 = {instancePath:instancePath+"/discovery/" + i3+"/lastErrorCode",schemaPath:"#/definitions/DiscoverySource/properties/lastErrorCode/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err101];
}
else {
vErrors.push(err101);
}
errors++;
}
var _valid4 = _errs107 === errors;
valid24 = valid24 || _valid4;
if(!valid24){
const _errs109 = errors;
if(data39 !== null){
const err102 = {instancePath:instancePath+"/discovery/" + i3+"/lastErrorCode",schemaPath:"#/definitions/DiscoverySource/properties/lastErrorCode/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err102];
}
else {
vErrors.push(err102);
}
errors++;
}
var _valid4 = _errs109 === errors;
valid24 = valid24 || _valid4;
}
if(!valid24){
const err103 = {instancePath:instancePath+"/discovery/" + i3+"/lastErrorCode",schemaPath:"#/definitions/DiscoverySource/properties/lastErrorCode/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err103];
}
else {
vErrors.push(err103);
}
errors++;
}
else {
errors = _errs106;
if(vErrors !== null){
if(_errs106){
vErrors.length = _errs106;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err104 = {instancePath:instancePath+"/discovery/" + i3,schemaPath:"#/definitions/DiscoverySource/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err104];
}
else {
vErrors.push(err104);
}
errors++;
}
}
}
else {
const err105 = {instancePath:instancePath+"/discovery",schemaPath:"#/properties/discovery/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err105];
}
else {
vErrors.push(err105);
}
errors++;
}
}
if(data.search !== undefined){
let data40 = data.search;
if(data40 && typeof data40 == "object" && !Array.isArray(data40)){
if(data40.sampledAt === undefined){
const err106 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "sampledAt"},message:"must have required property '"+"sampledAt"+"'"};
if(vErrors === null){
vErrors = [err106];
}
else {
vErrors.push(err106);
}
errors++;
}
if(data40.observationSeconds === undefined){
const err107 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "observationSeconds"},message:"must have required property '"+"observationSeconds"+"'"};
if(vErrors === null){
vErrors = [err107];
}
else {
vErrors.push(err107);
}
errors++;
}
if(data40.queryCount === undefined){
const err108 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "queryCount"},message:"must have required property '"+"queryCount"+"'"};
if(vErrors === null){
vErrors = [err108];
}
else {
vErrors.push(err108);
}
errors++;
}
if(data40.errorCount === undefined){
const err109 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "errorCount"},message:"must have required property '"+"errorCount"+"'"};
if(vErrors === null){
vErrors = [err109];
}
else {
vErrors.push(err109);
}
errors++;
}
if(data40.inFlight === undefined){
const err110 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "inFlight"},message:"must have required property '"+"inFlight"+"'"};
if(vErrors === null){
vErrors = [err110];
}
else {
vErrors.push(err110);
}
errors++;
}
if(data40.p50LatencyMilliseconds === undefined){
const err111 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "p50LatencyMilliseconds"},message:"must have required property '"+"p50LatencyMilliseconds"+"'"};
if(vErrors === null){
vErrors = [err111];
}
else {
vErrors.push(err111);
}
errors++;
}
if(data40.p95LatencyMilliseconds === undefined){
const err112 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "p95LatencyMilliseconds"},message:"must have required property '"+"p95LatencyMilliseconds"+"'"};
if(vErrors === null){
vErrors = [err112];
}
else {
vErrors.push(err112);
}
errors++;
}
if(data40.unavailableReason === undefined){
const err113 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/required",keyword:"required",params:{missingProperty: "unavailableReason"},message:"must have required property '"+"unavailableReason"+"'"};
if(vErrors === null){
vErrors = [err113];
}
else {
vErrors.push(err113);
}
errors++;
}
if(data40.sampledAt !== undefined){
let data41 = data40.sampledAt;
if(typeof data41 === "string"){
if(!(formats6.validate(data41))){
const err114 = {instancePath:instancePath+"/search/sampledAt",schemaPath:"#/definitions/SearchStatistics/properties/sampledAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
if(vErrors === null){
vErrors = [err114];
}
else {
vErrors.push(err114);
}
errors++;
}
}
else {
const err115 = {instancePath:instancePath+"/search/sampledAt",schemaPath:"#/definitions/SearchStatistics/properties/sampledAt/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err115];
}
else {
vErrors.push(err115);
}
errors++;
}
}
if(data40.observationSeconds !== undefined){
let data42 = data40.observationSeconds;
if((typeof data42 == "number") && (isFinite(data42))){
if(data42 < 0 || isNaN(data42)){
const err116 = {instancePath:instancePath+"/search/observationSeconds",schemaPath:"#/definitions/SearchStatistics/properties/observationSeconds/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err116];
}
else {
vErrors.push(err116);
}
errors++;
}
}
else {
const err117 = {instancePath:instancePath+"/search/observationSeconds",schemaPath:"#/definitions/SearchStatistics/properties/observationSeconds/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err117];
}
else {
vErrors.push(err117);
}
errors++;
}
}
if(data40.queryCount !== undefined){
let data43 = data40.queryCount;
if(!(((typeof data43 == "number") && (!(data43 % 1) && !isNaN(data43))) && (isFinite(data43)))){
const err118 = {instancePath:instancePath+"/search/queryCount",schemaPath:"#/definitions/SearchStatistics/properties/queryCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err118];
}
else {
vErrors.push(err118);
}
errors++;
}
if((typeof data43 == "number") && (isFinite(data43))){
if(data43 > 9007199254740991 || isNaN(data43)){
const err119 = {instancePath:instancePath+"/search/queryCount",schemaPath:"#/definitions/SearchStatistics/properties/queryCount/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err119];
}
else {
vErrors.push(err119);
}
errors++;
}
if(data43 < 0 || isNaN(data43)){
const err120 = {instancePath:instancePath+"/search/queryCount",schemaPath:"#/definitions/SearchStatistics/properties/queryCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err120];
}
else {
vErrors.push(err120);
}
errors++;
}
}
}
if(data40.errorCount !== undefined){
let data44 = data40.errorCount;
if(!(((typeof data44 == "number") && (!(data44 % 1) && !isNaN(data44))) && (isFinite(data44)))){
const err121 = {instancePath:instancePath+"/search/errorCount",schemaPath:"#/definitions/SearchStatistics/properties/errorCount/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err121];
}
else {
vErrors.push(err121);
}
errors++;
}
if((typeof data44 == "number") && (isFinite(data44))){
if(data44 > 9007199254740991 || isNaN(data44)){
const err122 = {instancePath:instancePath+"/search/errorCount",schemaPath:"#/definitions/SearchStatistics/properties/errorCount/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err122];
}
else {
vErrors.push(err122);
}
errors++;
}
if(data44 < 0 || isNaN(data44)){
const err123 = {instancePath:instancePath+"/search/errorCount",schemaPath:"#/definitions/SearchStatistics/properties/errorCount/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err123];
}
else {
vErrors.push(err123);
}
errors++;
}
}
}
if(data40.inFlight !== undefined){
let data45 = data40.inFlight;
if(!(((typeof data45 == "number") && (!(data45 % 1) && !isNaN(data45))) && (isFinite(data45)))){
const err124 = {instancePath:instancePath+"/search/inFlight",schemaPath:"#/definitions/SearchStatistics/properties/inFlight/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err124];
}
else {
vErrors.push(err124);
}
errors++;
}
if((typeof data45 == "number") && (isFinite(data45))){
if(data45 > 9007199254740991 || isNaN(data45)){
const err125 = {instancePath:instancePath+"/search/inFlight",schemaPath:"#/definitions/SearchStatistics/properties/inFlight/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err125];
}
else {
vErrors.push(err125);
}
errors++;
}
if(data45 < 0 || isNaN(data45)){
const err126 = {instancePath:instancePath+"/search/inFlight",schemaPath:"#/definitions/SearchStatistics/properties/inFlight/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err126];
}
else {
vErrors.push(err126);
}
errors++;
}
}
}
if(data40.p50LatencyMilliseconds !== undefined){
let data46 = data40.p50LatencyMilliseconds;
const _errs126 = errors;
let valid27 = false;
const _errs127 = errors;
if((typeof data46 == "number") && (isFinite(data46))){
if(data46 < 0 || isNaN(data46)){
const err127 = {instancePath:instancePath+"/search/p50LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p50LatencyMilliseconds/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err127];
}
else {
vErrors.push(err127);
}
errors++;
}
}
else {
const err128 = {instancePath:instancePath+"/search/p50LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p50LatencyMilliseconds/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err128];
}
else {
vErrors.push(err128);
}
errors++;
}
var _valid5 = _errs127 === errors;
valid27 = valid27 || _valid5;
if(!valid27){
const _errs129 = errors;
if(data46 !== null){
const err129 = {instancePath:instancePath+"/search/p50LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p50LatencyMilliseconds/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err129];
}
else {
vErrors.push(err129);
}
errors++;
}
var _valid5 = _errs129 === errors;
valid27 = valid27 || _valid5;
}
if(!valid27){
const err130 = {instancePath:instancePath+"/search/p50LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p50LatencyMilliseconds/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err130];
}
else {
vErrors.push(err130);
}
errors++;
}
else {
errors = _errs126;
if(vErrors !== null){
if(_errs126){
vErrors.length = _errs126;
}
else {
vErrors = null;
}
}
}
}
if(data40.p95LatencyMilliseconds !== undefined){
let data47 = data40.p95LatencyMilliseconds;
const _errs132 = errors;
let valid28 = false;
const _errs133 = errors;
if((typeof data47 == "number") && (isFinite(data47))){
if(data47 < 0 || isNaN(data47)){
const err131 = {instancePath:instancePath+"/search/p95LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p95LatencyMilliseconds/anyOf/0/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err131];
}
else {
vErrors.push(err131);
}
errors++;
}
}
else {
const err132 = {instancePath:instancePath+"/search/p95LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p95LatencyMilliseconds/anyOf/0/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err132];
}
else {
vErrors.push(err132);
}
errors++;
}
var _valid6 = _errs133 === errors;
valid28 = valid28 || _valid6;
if(!valid28){
const _errs135 = errors;
if(data47 !== null){
const err133 = {instancePath:instancePath+"/search/p95LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p95LatencyMilliseconds/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err133];
}
else {
vErrors.push(err133);
}
errors++;
}
var _valid6 = _errs135 === errors;
valid28 = valid28 || _valid6;
}
if(!valid28){
const err134 = {instancePath:instancePath+"/search/p95LatencyMilliseconds",schemaPath:"#/definitions/SearchStatistics/properties/p95LatencyMilliseconds/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err134];
}
else {
vErrors.push(err134);
}
errors++;
}
else {
errors = _errs132;
if(vErrors !== null){
if(_errs132){
vErrors.length = _errs132;
}
else {
vErrors = null;
}
}
}
}
if(data40.unavailableReason !== undefined){
let data48 = data40.unavailableReason;
const _errs138 = errors;
let valid29 = false;
const _errs139 = errors;
if(typeof data48 === "string"){
if(func2(data48) < 1){
const err135 = {instancePath:instancePath+"/search/unavailableReason",schemaPath:"#/definitions/SearchStatistics/properties/unavailableReason/anyOf/0/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err135];
}
else {
vErrors.push(err135);
}
errors++;
}
}
else {
const err136 = {instancePath:instancePath+"/search/unavailableReason",schemaPath:"#/definitions/SearchStatistics/properties/unavailableReason/anyOf/0/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err136];
}
else {
vErrors.push(err136);
}
errors++;
}
var _valid7 = _errs139 === errors;
valid29 = valid29 || _valid7;
if(!valid29){
const _errs141 = errors;
if(data48 !== null){
const err137 = {instancePath:instancePath+"/search/unavailableReason",schemaPath:"#/definitions/SearchStatistics/properties/unavailableReason/anyOf/1/type",keyword:"type",params:{type: "null"},message:"must be null"};
if(vErrors === null){
vErrors = [err137];
}
else {
vErrors.push(err137);
}
errors++;
}
var _valid7 = _errs141 === errors;
valid29 = valid29 || _valid7;
}
if(!valid29){
const err138 = {instancePath:instancePath+"/search/unavailableReason",schemaPath:"#/definitions/SearchStatistics/properties/unavailableReason/anyOf",keyword:"anyOf",params:{},message:"must match a schema in anyOf"};
if(vErrors === null){
vErrors = [err138];
}
else {
vErrors.push(err138);
}
errors++;
}
else {
errors = _errs138;
if(vErrors !== null){
if(_errs138){
vErrors.length = _errs138;
}
else {
vErrors = null;
}
}
}
}
}
else {
const err139 = {instancePath:instancePath+"/search",schemaPath:"#/definitions/SearchStatistics/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err139];
}
else {
vErrors.push(err139);
}
errors++;
}
}
if(data.resetInProgress !== undefined){
if(typeof data.resetInProgress !== "boolean"){
const err140 = {instancePath:instancePath+"/resetInProgress",schemaPath:"#/properties/resetInProgress/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err140];
}
else {
vErrors.push(err140);
}
errors++;
}
}
if(data.indexingDirectory !== undefined){
let data50 = data.indexingDirectory;
if(typeof data50 === "string"){
if(func2(data50) < 1){
const err141 = {instancePath:instancePath+"/indexingDirectory",schemaPath:"#/properties/indexingDirectory/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err141];
}
else {
vErrors.push(err141);
}
errors++;
}
if(!pattern10.test(data50)){
const err142 = {instancePath:instancePath+"/indexingDirectory",schemaPath:"#/properties/indexingDirectory/pattern",keyword:"pattern",params:{pattern: "^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)"},message:"must match pattern \""+"^(?:/|[A-Za-z]:[\\\\/]|\\\\\\\\)"+"\""};
if(vErrors === null){
vErrors = [err142];
}
else {
vErrors.push(err142);
}
errors++;
}
}
else {
const err143 = {instancePath:instancePath+"/indexingDirectory",schemaPath:"#/properties/indexingDirectory/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err143];
}
else {
vErrors.push(err143);
}
errors++;
}
}
}
else {
const err144 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err144];
}
else {
vErrors.push(err144);
}
errors++;
}
validate22.errors = vErrors;
return errors === 0;
}


function validate21(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-start-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(!(validate22(data, {instancePath,parentData,parentDataProperty,rootData}))){
vErrors = vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
errors = vErrors.length;
}
validate21.errors = vErrors;
return errors === 0;
}

export const validateIndexingStopV1Params = validate38;
const schema52 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-stop-v1-params.schema.json","title":"IndexingStopV1Params","type":"object","properties":{},"required":[],"additionalProperties":false};

function validate38(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-stop-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
const err0 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate38.errors = vErrors;
return errors === 0;
}

export const validateIndexingStopV1Result = validate39;
const schema53 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-stop-v1-result.schema.json","title":"IndexingStopV1Result","$ref":"./indexing-status-v1-result.schema.json"};

function validate39(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-stop-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(!(validate22(data, {instancePath,parentData,parentDataProperty,rootData}))){
vErrors = vErrors === null ? validate22.errors : vErrors.concat(validate22.errors);
errors = vErrors.length;
}
validate39.errors = vErrors;
return errors === 0;
}

export const validateSearchQueryV1Params = validate41;
const schema54 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/search-query-v1-params.schema.json","title":"SearchQueryV1Params","type":"object","properties":{"text":{"type":"string","maxLength":4096,"default":""},"limit":{"type":"integer","minimum":1,"maximum":100,"default":20},"metadata_filters":{"type":"array","items":{"$ref":"./search-metadata-filter.schema.json"}},"filters":{"type":"object","properties":{"sender":{"type":"string"},"sourceId":{"type":"string","format":"uuid"},"mailboxId":{"type":"string"},"dateFrom":{"type":"integer"},"dateTo":{"type":"integer"},"fileType":{"type":"string"},"kind":{"enum":["email","file","teams_message"],"type":"string"}},"required":[],"additionalProperties":false}},"required":[],"additionalProperties":false};
const schema55 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/search-metadata-filter.schema.json","title":"SearchMetadataFilter","type":"object","properties":{"field":{"type":"string","minLength":1},"operator":{"type":"string","minLength":1},"value":{}},"required":["field","operator","value"],"additionalProperties":false};

function validate41(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/search-query-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
if(!((((key0 === "text") || (key0 === "limit")) || (key0 === "metadata_filters")) || (key0 === "filters"))){
const err0 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
if(data.text !== undefined){
let data0 = data.text;
if(typeof data0 === "string"){
if(func2(data0) > 4096){
const err1 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
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
const err2 = {instancePath:instancePath+"/text",schemaPath:"#/properties/text/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.limit !== undefined){
let data1 = data.limit;
if(!(((typeof data1 == "number") && (!(data1 % 1) && !isNaN(data1))) && (isFinite(data1)))){
const err3 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if((typeof data1 == "number") && (isFinite(data1))){
if(data1 > 100 || isNaN(data1)){
const err4 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/maximum",keyword:"maximum",params:{comparison: "<=", limit: 100},message:"must be <= 100"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1 < 1 || isNaN(data1)){
const err5 = {instancePath:instancePath+"/limit",schemaPath:"#/properties/limit/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data.metadata_filters !== undefined){
let data2 = data.metadata_filters;
if(Array.isArray(data2)){
const len0 = data2.length;
for(let i0=0; i0<len0; i0++){
let data3 = data2[i0];
if(data3 && typeof data3 == "object" && !Array.isArray(data3)){
if(data3.field === undefined){
const err6 = {instancePath:instancePath+"/metadata_filters/" + i0,schemaPath:"./search-metadata-filter.schema.json/required",keyword:"required",params:{missingProperty: "field"},message:"must have required property '"+"field"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data3.operator === undefined){
const err7 = {instancePath:instancePath+"/metadata_filters/" + i0,schemaPath:"./search-metadata-filter.schema.json/required",keyword:"required",params:{missingProperty: "operator"},message:"must have required property '"+"operator"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data3.value === undefined){
const err8 = {instancePath:instancePath+"/metadata_filters/" + i0,schemaPath:"./search-metadata-filter.schema.json/required",keyword:"required",params:{missingProperty: "value"},message:"must have required property '"+"value"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
for(const key1 in data3){
if(!(((key1 === "field") || (key1 === "operator")) || (key1 === "value"))){
const err9 = {instancePath:instancePath+"/metadata_filters/" + i0,schemaPath:"./search-metadata-filter.schema.json/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data3.field !== undefined){
let data4 = data3.field;
if(typeof data4 === "string"){
if(func2(data4) < 1){
const err10 = {instancePath:instancePath+"/metadata_filters/" + i0+"/field",schemaPath:"./search-metadata-filter.schema.json/properties/field/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err11 = {instancePath:instancePath+"/metadata_filters/" + i0+"/field",schemaPath:"./search-metadata-filter.schema.json/properties/field/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data3.operator !== undefined){
let data5 = data3.operator;
if(typeof data5 === "string"){
if(func2(data5) < 1){
const err12 = {instancePath:instancePath+"/metadata_filters/" + i0+"/operator",schemaPath:"./search-metadata-filter.schema.json/properties/operator/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err13 = {instancePath:instancePath+"/metadata_filters/" + i0+"/operator",schemaPath:"./search-metadata-filter.schema.json/properties/operator/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err14 = {instancePath:instancePath+"/metadata_filters/" + i0,schemaPath:"./search-metadata-filter.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err15 = {instancePath:instancePath+"/metadata_filters",schemaPath:"#/properties/metadata_filters/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data.filters !== undefined){
let data6 = data.filters;
if(data6 && typeof data6 == "object" && !Array.isArray(data6)){
for(const key2 in data6){
if(!(((((((key2 === "sender") || (key2 === "sourceId")) || (key2 === "mailboxId")) || (key2 === "dateFrom")) || (key2 === "dateTo")) || (key2 === "fileType")) || (key2 === "kind"))){
const err16 = {instancePath:instancePath+"/filters",schemaPath:"#/properties/filters/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data6.sender !== undefined){
if(typeof data6.sender !== "string"){
const err17 = {instancePath:instancePath+"/filters/sender",schemaPath:"#/properties/filters/properties/sender/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data6.sourceId !== undefined){
let data8 = data6.sourceId;
if(typeof data8 === "string"){
if(!(formats0.test(data8))){
const err18 = {instancePath:instancePath+"/filters/sourceId",schemaPath:"#/properties/filters/properties/sourceId/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err19 = {instancePath:instancePath+"/filters/sourceId",schemaPath:"#/properties/filters/properties/sourceId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data6.mailboxId !== undefined){
if(typeof data6.mailboxId !== "string"){
const err20 = {instancePath:instancePath+"/filters/mailboxId",schemaPath:"#/properties/filters/properties/mailboxId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data6.dateFrom !== undefined){
let data10 = data6.dateFrom;
if(!(((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10))) && (isFinite(data10)))){
const err21 = {instancePath:instancePath+"/filters/dateFrom",schemaPath:"#/properties/filters/properties/dateFrom/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
}
if(data6.dateTo !== undefined){
let data11 = data6.dateTo;
if(!(((typeof data11 == "number") && (!(data11 % 1) && !isNaN(data11))) && (isFinite(data11)))){
const err22 = {instancePath:instancePath+"/filters/dateTo",schemaPath:"#/properties/filters/properties/dateTo/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data6.fileType !== undefined){
if(typeof data6.fileType !== "string"){
const err23 = {instancePath:instancePath+"/filters/fileType",schemaPath:"#/properties/filters/properties/fileType/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data6.kind !== undefined){
let data13 = data6.kind;
if(typeof data13 !== "string"){
const err24 = {instancePath:instancePath+"/filters/kind",schemaPath:"#/properties/filters/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(!(((data13 === "email") || (data13 === "file")) || (data13 === "teams_message"))){
const err25 = {instancePath:instancePath+"/filters/kind",schemaPath:"#/properties/filters/properties/kind/enum",keyword:"enum",params:{allowedValues: schema54.properties.filters.properties.kind.enum},message:"must be equal to one of the allowed values"};
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
const err26 = {instancePath:instancePath+"/filters",schemaPath:"#/properties/filters/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
else {
const err27 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
validate41.errors = vErrors;
return errors === 0;
}

export const validateSearchQueryV1Result = validate42;
const schema56 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/search-query-v1-result.schema.json","title":"SearchQueryV1Result","type":"object","properties":{"hits":{"type":"array","items":{"type":"object","properties":{"documentId":{"type":"string"},"uri":{"description":"A URI identifying the document, ideally an externally retrievable URL.","type":"string","format":"uri","minLength":1},"external_ids":{"$ref":"../source/external-ids.schema.json"},"chunkId":{"type":["string","null"]},"score":{"type":"number"},"kind":{"type":"string"},"title":{"type":["string","null"]},"sender":{"type":["string","null"]},"mailboxId":{"type":["string","null"]},"date":{"type":["integer","null"]},"mimeType":{"type":["string","null"]},"conversationKey":{"type":["string","null"]},"topLevelParent":{"$ref":"../source/top-level-parent.schema.json"}},"required":["documentId","chunkId","score","kind","title","sender","mailboxId","date","mimeType","conversationKey"],"additionalProperties":false}},"elapsedMs":{"type":"integer","minimum":0},"blocksRead":{"type":"integer","minimum":0},"candidatesScored":{"type":"integer","minimum":0}},"required":["hits","elapsedMs","blocksRead","candidatesScored"],"additionalProperties":false};
const formats62 = (value) => /^(?:[a-z][a-z0-9+\-.]*:)(?:\/?\/)?[^\s]*$/i.test(value);
const schema58 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/source/top-level-parent.schema.json","title":"TopLevelParent","description":"The outermost containing document, never a folder. External IDs belong to that parent, not to the attachment.","type":"object","properties":{"documentId":{"type":"string","format":"uuid","description":"Catalog UUID, when indexed; can be passed to sources.get_document.v1."},"external_ids":{"$ref":"./external-ids.schema.json"}},"required":["external_ids"],"additionalProperties":false};

function validate43(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/source/top-level-parent.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.external_ids === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "external_ids"},message:"must have required property '"+"external_ids"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "documentId") || (key0 === "external_ids"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.documentId !== undefined){
let data0 = data.documentId;
if(typeof data0 === "string"){
if(!(formats0.test(data0))){
const err2 = {instancePath:instancePath+"/documentId",schemaPath:"#/properties/documentId/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err3 = {instancePath:instancePath+"/documentId",schemaPath:"#/properties/documentId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.external_ids !== undefined){
let data1 = data.external_ids;
if(Array.isArray(data1)){
const len0 = data1.length;
for(let i0=0; i0<len0; i0++){
let data2 = data1[i0];
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(data2.key === undefined){
const err4 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"./external-ids.schema.json/items/required",keyword:"required",params:{missingProperty: "key"},message:"must have required property '"+"key"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data2.value === undefined){
const err5 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"./external-ids.schema.json/items/required",keyword:"required",params:{missingProperty: "value"},message:"must have required property '"+"value"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
for(const key1 in data2){
if(!((key1 === "key") || (key1 === "value"))){
const err6 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"./external-ids.schema.json/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data2.key !== undefined){
let data3 = data2.key;
if(typeof data3 === "string"){
if(func2(data3) < 1){
const err7 = {instancePath:instancePath+"/external_ids/" + i0+"/key",schemaPath:"./external-ids.schema.json/items/properties/key/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err8 = {instancePath:instancePath+"/external_ids/" + i0+"/key",schemaPath:"./external-ids.schema.json/items/properties/key/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data2.value !== undefined){
let data4 = data2.value;
if(typeof data4 === "string"){
if(func2(data4) < 1){
const err9 = {instancePath:instancePath+"/external_ids/" + i0+"/value",schemaPath:"./external-ids.schema.json/items/properties/value/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err10 = {instancePath:instancePath+"/external_ids/" + i0+"/value",schemaPath:"./external-ids.schema.json/items/properties/value/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
}
else {
const err11 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"./external-ids.schema.json/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err12 = {instancePath:instancePath+"/external_ids",schemaPath:"./external-ids.schema.json/type",keyword:"type",params:{type: "array"},message:"must be array"};
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
else {
const err13 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
validate43.errors = vErrors;
return errors === 0;
}


function validate42(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/search-query-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.hits === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "hits"},message:"must have required property '"+"hits"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.elapsedMs === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "elapsedMs"},message:"must have required property '"+"elapsedMs"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.blocksRead === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "blocksRead"},message:"must have required property '"+"blocksRead"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data.candidatesScored === undefined){
const err3 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "candidatesScored"},message:"must have required property '"+"candidatesScored"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
for(const key0 in data){
if(!((((key0 === "hits") || (key0 === "elapsedMs")) || (key0 === "blocksRead")) || (key0 === "candidatesScored"))){
const err4 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.hits !== undefined){
let data0 = data.hits;
if(Array.isArray(data0)){
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.documentId === undefined){
const err5 = {instancePath:instancePath+"/hits/" + i0,schemaPath:"#/properties/hits/items/required",keyword:"required",params:{missingProperty: "documentId"},message:"must have required property '"+"documentId"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.chunkId === undefined){
const err6 = {instancePath:instancePath+"/hits/" + i0,schemaPath:"#/properties/hits/items/required",keyword:"required",params:{missingProperty: "chunkId"},message:"must have required property '"+"chunkId"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.score === undefined){
const err7 = {instancePath:instancePath+"/hits/" + i0,schemaPath:"#/properties/hits/items/required",keyword:"required",params:{missingProperty: "score"},message:"must have required property '"+"score"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.kind === undefined){
const err8 = {instancePath:instancePath+"/hits/" + i0,schemaPath:"#/properties/hits/items/required",keyword:"required",params:{missingProperty: "kind"},message:"must have required property '"+"kind"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data1.title === undefined){
const err9 = {instancePath:instancePath+"/hits/" + i0,schemaPath:"#/properties/hits/items/required",keyword:"required",params:{missingProperty: "title"},message:"must have required property '"+"title"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data1.sender === undefined){
const err10 = {instancePath:instancePath+"/hits/" + i0,schemaPath:"#/properties/hits/items/required",keyword:"required",params:{missingProperty: "sender"},message:"must have required property '"+"sender"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data1.mailboxId === undefined){
const err11 = {instancePath:instancePath+"/hits/" + i0,schemaPath:"#/properties/hits/items/required",keyword:"required",params:{missingProperty: "mailboxId"},message:"must have required property '"+"mailboxId"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data1.date === undefined){
const err12 = {instancePath:instancePath+"/hits/" + i0,schemaPath:"#/properties/hits/items/required",keyword:"required",params:{missingProperty: "date"},message:"must have required property '"+"date"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(data1.mimeType === undefined){
const err13 = {instancePath:instancePath+"/hits/" + i0,schemaPath:"#/properties/hits/items/required",keyword:"required",params:{missingProperty: "mimeType"},message:"must have required property '"+"mimeType"+"'"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
if(data1.conversationKey === undefined){
const err14 = {instancePath:instancePath+"/hits/" + i0,schemaPath:"#/properties/hits/items/required",keyword:"required",params:{missingProperty: "conversationKey"},message:"must have required property '"+"conversationKey"+"'"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
for(const key1 in data1){
if(!(func10.call(schema56.properties.hits.items.properties, key1))){
const err15 = {instancePath:instancePath+"/hits/" + i0,schemaPath:"#/properties/hits/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data1.documentId !== undefined){
if(typeof data1.documentId !== "string"){
const err16 = {instancePath:instancePath+"/hits/" + i0+"/documentId",schemaPath:"#/properties/hits/items/properties/documentId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data1.uri !== undefined){
let data3 = data1.uri;
if(typeof data3 === "string"){
if(func2(data3) < 1){
const err17 = {instancePath:instancePath+"/hits/" + i0+"/uri",schemaPath:"#/properties/hits/items/properties/uri/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if(!(formats62(data3))){
const err18 = {instancePath:instancePath+"/hits/" + i0+"/uri",schemaPath:"#/properties/hits/items/properties/uri/format",keyword:"format",params:{format: "uri"},message:"must match format \""+"uri"+"\""};
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
const err19 = {instancePath:instancePath+"/hits/" + i0+"/uri",schemaPath:"#/properties/hits/items/properties/uri/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data1.external_ids !== undefined){
let data4 = data1.external_ids;
if(Array.isArray(data4)){
const len1 = data4.length;
for(let i1=0; i1<len1; i1++){
let data5 = data4[i1];
if(data5 && typeof data5 == "object" && !Array.isArray(data5)){
if(data5.key === undefined){
const err20 = {instancePath:instancePath+"/hits/" + i0+"/external_ids/" + i1,schemaPath:"../source/external-ids.schema.json/items/required",keyword:"required",params:{missingProperty: "key"},message:"must have required property '"+"key"+"'"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if(data5.value === undefined){
const err21 = {instancePath:instancePath+"/hits/" + i0+"/external_ids/" + i1,schemaPath:"../source/external-ids.schema.json/items/required",keyword:"required",params:{missingProperty: "value"},message:"must have required property '"+"value"+"'"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
for(const key2 in data5){
if(!((key2 === "key") || (key2 === "value"))){
const err22 = {instancePath:instancePath+"/hits/" + i0+"/external_ids/" + i1,schemaPath:"../source/external-ids.schema.json/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key2},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
}
if(data5.key !== undefined){
let data6 = data5.key;
if(typeof data6 === "string"){
if(func2(data6) < 1){
const err23 = {instancePath:instancePath+"/hits/" + i0+"/external_ids/" + i1+"/key",schemaPath:"../source/external-ids.schema.json/items/properties/key/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err24 = {instancePath:instancePath+"/hits/" + i0+"/external_ids/" + i1+"/key",schemaPath:"../source/external-ids.schema.json/items/properties/key/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
}
if(data5.value !== undefined){
let data7 = data5.value;
if(typeof data7 === "string"){
if(func2(data7) < 1){
const err25 = {instancePath:instancePath+"/hits/" + i0+"/external_ids/" + i1+"/value",schemaPath:"../source/external-ids.schema.json/items/properties/value/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err26 = {instancePath:instancePath+"/hits/" + i0+"/external_ids/" + i1+"/value",schemaPath:"../source/external-ids.schema.json/items/properties/value/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
else {
const err27 = {instancePath:instancePath+"/hits/" + i0+"/external_ids/" + i1,schemaPath:"../source/external-ids.schema.json/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err28 = {instancePath:instancePath+"/hits/" + i0+"/external_ids",schemaPath:"../source/external-ids.schema.json/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
}
if(data1.chunkId !== undefined){
let data8 = data1.chunkId;
if((typeof data8 !== "string") && (data8 !== null)){
const err29 = {instancePath:instancePath+"/hits/" + i0+"/chunkId",schemaPath:"#/properties/hits/items/properties/chunkId/type",keyword:"type",params:{type: schema56.properties.hits.items.properties.chunkId.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
}
if(data1.score !== undefined){
let data9 = data1.score;
if(!((typeof data9 == "number") && (isFinite(data9)))){
const err30 = {instancePath:instancePath+"/hits/" + i0+"/score",schemaPath:"#/properties/hits/items/properties/score/type",keyword:"type",params:{type: "number"},message:"must be number"};
if(vErrors === null){
vErrors = [err30];
}
else {
vErrors.push(err30);
}
errors++;
}
}
if(data1.kind !== undefined){
if(typeof data1.kind !== "string"){
const err31 = {instancePath:instancePath+"/hits/" + i0+"/kind",schemaPath:"#/properties/hits/items/properties/kind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err31];
}
else {
vErrors.push(err31);
}
errors++;
}
}
if(data1.title !== undefined){
let data11 = data1.title;
if((typeof data11 !== "string") && (data11 !== null)){
const err32 = {instancePath:instancePath+"/hits/" + i0+"/title",schemaPath:"#/properties/hits/items/properties/title/type",keyword:"type",params:{type: schema56.properties.hits.items.properties.title.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
if(data1.sender !== undefined){
let data12 = data1.sender;
if((typeof data12 !== "string") && (data12 !== null)){
const err33 = {instancePath:instancePath+"/hits/" + i0+"/sender",schemaPath:"#/properties/hits/items/properties/sender/type",keyword:"type",params:{type: schema56.properties.hits.items.properties.sender.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
}
if(data1.mailboxId !== undefined){
let data13 = data1.mailboxId;
if((typeof data13 !== "string") && (data13 !== null)){
const err34 = {instancePath:instancePath+"/hits/" + i0+"/mailboxId",schemaPath:"#/properties/hits/items/properties/mailboxId/type",keyword:"type",params:{type: schema56.properties.hits.items.properties.mailboxId.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
}
if(data1.date !== undefined){
let data14 = data1.date;
if((!(((typeof data14 == "number") && (!(data14 % 1) && !isNaN(data14))) && (isFinite(data14)))) && (data14 !== null)){
const err35 = {instancePath:instancePath+"/hits/" + i0+"/date",schemaPath:"#/properties/hits/items/properties/date/type",keyword:"type",params:{type: schema56.properties.hits.items.properties.date.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err35];
}
else {
vErrors.push(err35);
}
errors++;
}
}
if(data1.mimeType !== undefined){
let data15 = data1.mimeType;
if((typeof data15 !== "string") && (data15 !== null)){
const err36 = {instancePath:instancePath+"/hits/" + i0+"/mimeType",schemaPath:"#/properties/hits/items/properties/mimeType/type",keyword:"type",params:{type: schema56.properties.hits.items.properties.mimeType.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
}
if(data1.conversationKey !== undefined){
let data16 = data1.conversationKey;
if((typeof data16 !== "string") && (data16 !== null)){
const err37 = {instancePath:instancePath+"/hits/" + i0+"/conversationKey",schemaPath:"#/properties/hits/items/properties/conversationKey/type",keyword:"type",params:{type: schema56.properties.hits.items.properties.conversationKey.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data1.topLevelParent !== undefined){
if(!(validate43(data1.topLevelParent, {instancePath:instancePath+"/hits/" + i0+"/topLevelParent",parentData:data1,parentDataProperty:"topLevelParent",rootData}))){
vErrors = vErrors === null ? validate43.errors : vErrors.concat(validate43.errors);
errors = vErrors.length;
}
}
}
else {
const err38 = {instancePath:instancePath+"/hits/" + i0,schemaPath:"#/properties/hits/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err39 = {instancePath:instancePath+"/hits",schemaPath:"#/properties/hits/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
}
if(data.elapsedMs !== undefined){
let data18 = data.elapsedMs;
if(!(((typeof data18 == "number") && (!(data18 % 1) && !isNaN(data18))) && (isFinite(data18)))){
const err40 = {instancePath:instancePath+"/elapsedMs",schemaPath:"#/properties/elapsedMs/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
if((typeof data18 == "number") && (isFinite(data18))){
if(data18 < 0 || isNaN(data18)){
const err41 = {instancePath:instancePath+"/elapsedMs",schemaPath:"#/properties/elapsedMs/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.blocksRead !== undefined){
let data19 = data.blocksRead;
if(!(((typeof data19 == "number") && (!(data19 % 1) && !isNaN(data19))) && (isFinite(data19)))){
const err42 = {instancePath:instancePath+"/blocksRead",schemaPath:"#/properties/blocksRead/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
if((typeof data19 == "number") && (isFinite(data19))){
if(data19 < 0 || isNaN(data19)){
const err43 = {instancePath:instancePath+"/blocksRead",schemaPath:"#/properties/blocksRead/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.candidatesScored !== undefined){
let data20 = data.candidatesScored;
if(!(((typeof data20 == "number") && (!(data20 % 1) && !isNaN(data20))) && (isFinite(data20)))){
const err44 = {instancePath:instancePath+"/candidatesScored",schemaPath:"#/properties/candidatesScored/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
if((typeof data20 == "number") && (isFinite(data20))){
if(data20 < 0 || isNaN(data20)){
const err45 = {instancePath:instancePath+"/candidatesScored",schemaPath:"#/properties/candidatesScored/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
}
}
else {
const err46 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err46];
}
else {
vErrors.push(err46);
}
errors++;
}
validate42.errors = vErrors;
return errors === 0;
}

export const validateSearchMetadataFieldsV1Params = validate45;
const schema60 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/search-metadata-fields-v1-params.schema.json","title":"SearchMetadataFieldsV1Params","type":"object","additionalProperties":false};

function validate45(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/search-metadata-fields-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
const err0 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate45.errors = vErrors;
return errors === 0;
}

export const validateSearchMetadataFieldsV1Result = validate46;
const schema61 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/search-metadata-fields-v1-result.schema.json","title":"SearchMetadataFieldsV1Result","type":"object","properties":{"fields":{"type":"array","items":{"type":"object","properties":{"field":{"type":"string","minLength":1},"operators":{"type":"array","items":{"type":"string","minLength":1},"minItems":1},"type":{"type":"string","minLength":1},"description":{"type":"string"},"applicable_kinds":{"type":"array","items":{"type":"string","minLength":1},"minItems":1}},"required":["field","operators","type","description","applicable_kinds"],"additionalProperties":false}}},"required":["fields"],"additionalProperties":false};

function validate46(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/search-metadata-fields-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.fields === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "fields"},message:"must have required property '"+"fields"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "fields")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.fields !== undefined){
let data0 = data.fields;
if(Array.isArray(data0)){
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.field === undefined){
const err2 = {instancePath:instancePath+"/fields/" + i0,schemaPath:"#/properties/fields/items/required",keyword:"required",params:{missingProperty: "field"},message:"must have required property '"+"field"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data1.operators === undefined){
const err3 = {instancePath:instancePath+"/fields/" + i0,schemaPath:"#/properties/fields/items/required",keyword:"required",params:{missingProperty: "operators"},message:"must have required property '"+"operators"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data1.type === undefined){
const err4 = {instancePath:instancePath+"/fields/" + i0,schemaPath:"#/properties/fields/items/required",keyword:"required",params:{missingProperty: "type"},message:"must have required property '"+"type"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.description === undefined){
const err5 = {instancePath:instancePath+"/fields/" + i0,schemaPath:"#/properties/fields/items/required",keyword:"required",params:{missingProperty: "description"},message:"must have required property '"+"description"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.applicable_kinds === undefined){
const err6 = {instancePath:instancePath+"/fields/" + i0,schemaPath:"#/properties/fields/items/required",keyword:"required",params:{missingProperty: "applicable_kinds"},message:"must have required property '"+"applicable_kinds"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
for(const key1 in data1){
if(!(((((key1 === "field") || (key1 === "operators")) || (key1 === "type")) || (key1 === "description")) || (key1 === "applicable_kinds"))){
const err7 = {instancePath:instancePath+"/fields/" + i0,schemaPath:"#/properties/fields/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data1.field !== undefined){
let data2 = data1.field;
if(typeof data2 === "string"){
if(func2(data2) < 1){
const err8 = {instancePath:instancePath+"/fields/" + i0+"/field",schemaPath:"#/properties/fields/items/properties/field/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err9 = {instancePath:instancePath+"/fields/" + i0+"/field",schemaPath:"#/properties/fields/items/properties/field/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data1.operators !== undefined){
let data3 = data1.operators;
if(Array.isArray(data3)){
if(data3.length < 1){
const err10 = {instancePath:instancePath+"/fields/" + i0+"/operators",schemaPath:"#/properties/fields/items/properties/operators/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
const len1 = data3.length;
for(let i1=0; i1<len1; i1++){
let data4 = data3[i1];
if(typeof data4 === "string"){
if(func2(data4) < 1){
const err11 = {instancePath:instancePath+"/fields/" + i0+"/operators/" + i1,schemaPath:"#/properties/fields/items/properties/operators/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err12 = {instancePath:instancePath+"/fields/" + i0+"/operators/" + i1,schemaPath:"#/properties/fields/items/properties/operators/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
else {
const err13 = {instancePath:instancePath+"/fields/" + i0+"/operators",schemaPath:"#/properties/fields/items/properties/operators/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data1.type !== undefined){
let data5 = data1.type;
if(typeof data5 === "string"){
if(func2(data5) < 1){
const err14 = {instancePath:instancePath+"/fields/" + i0+"/type",schemaPath:"#/properties/fields/items/properties/type/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err15 = {instancePath:instancePath+"/fields/" + i0+"/type",schemaPath:"#/properties/fields/items/properties/type/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data1.description !== undefined){
if(typeof data1.description !== "string"){
const err16 = {instancePath:instancePath+"/fields/" + i0+"/description",schemaPath:"#/properties/fields/items/properties/description/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data1.applicable_kinds !== undefined){
let data7 = data1.applicable_kinds;
if(Array.isArray(data7)){
if(data7.length < 1){
const err17 = {instancePath:instancePath+"/fields/" + i0+"/applicable_kinds",schemaPath:"#/properties/fields/items/properties/applicable_kinds/minItems",keyword:"minItems",params:{limit: 1},message:"must NOT have fewer than 1 items"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
const len2 = data7.length;
for(let i2=0; i2<len2; i2++){
let data8 = data7[i2];
if(typeof data8 === "string"){
if(func2(data8) < 1){
const err18 = {instancePath:instancePath+"/fields/" + i0+"/applicable_kinds/" + i2,schemaPath:"#/properties/fields/items/properties/applicable_kinds/items/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err19 = {instancePath:instancePath+"/fields/" + i0+"/applicable_kinds/" + i2,schemaPath:"#/properties/fields/items/properties/applicable_kinds/items/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err20 = {instancePath:instancePath+"/fields/" + i0+"/applicable_kinds",schemaPath:"#/properties/fields/items/properties/applicable_kinds/type",keyword:"type",params:{type: "array"},message:"must be array"};
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
const err21 = {instancePath:instancePath+"/fields/" + i0,schemaPath:"#/properties/fields/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err22 = {instancePath:instancePath+"/fields",schemaPath:"#/properties/fields/type",keyword:"type",params:{type: "array"},message:"must be array"};
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
const err23 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
validate46.errors = vErrors;
return errors === 0;
}

export const validateIndexingResetV1Result = validate47;
const schema62 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-reset-v1-result.schema.json","title":"IndexingResetV1Result","description":"Returned only after processing has stopped, database handles have closed, and every managed indexing file has been removed. Does not merely acknowledge scheduling a reset.","type":"object","properties":{"completed":{"const":true},"completedAt":{"type":"string","format":"date-time"},"state":{"const":"stopped"}},"required":["completed","completedAt","state"],"additionalProperties":true};

function validate47(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!(formats6.validate(data1))){
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
validate47.errors = vErrors;
return errors === 0;
}

export const validateIndexingResetV1Params = validate48;
const schema63 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-reset-v1-params.schema.json","title":"IndexingResetV1Params","description":"Fully reset all indexing storage managed by this sidecar for the current OS user. No mailbox, generation, or filesystem-path selector is supported. This command deletes index data; it is not a generation rebuild.","type":"object","properties":{},"additionalProperties":true};

function validate48(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate48.errors = vErrors;
return errors === 0;
}

export const validateIndexingStatusV1Result = validate22;

export const validateIndexingStatusV1Params = validate49;
const schema64 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/indexing-status-v1-params.schema.json","title":"IndexingStatusV1Params","type":"object","properties":{"includeSourceBreakdowns":{"type":"boolean","default":true},"includeFileTypeBreakdowns":{"type":"boolean","default":true}},"required":[],"additionalProperties":true};

function validate49(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate49.errors = vErrors;
return errors === 0;
}

export const validateJsonRpcEnvelope = validate50;
const schema65 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/json-rpc-envelope.schema.json","title":"JsonRpcEnvelope","oneOf":[{"$ref":"#/definitions/Request"},{"$ref":"#/definitions/Notification"},{"$ref":"#/definitions/SuccessResponse"},{"$ref":"#/definitions/ErrorResponse"}],"definitions":{"Request":{"type":"object","required":["jsonrpc","method","id"],"properties":{"jsonrpc":{"const":"2.0"},"method":{"type":"string","minLength":1},"params":{"oneOf":[{"type":"object"},{"type":"array"}]},"id":{"$ref":"../common.schema.json#/definitions/RequestId"},"x-erato-deadline-at":{"type":"string","format":"date-time"}},"additionalProperties":true},"Notification":{"type":"object","required":["jsonrpc","method"],"not":{"required":["id"],"properties":{"id":true}},"properties":{"jsonrpc":{"const":"2.0"},"method":{"type":"string","minLength":1},"params":{"oneOf":[{"type":"object"},{"type":"array"}]}},"additionalProperties":true},"SuccessResponse":{"type":"object","required":["jsonrpc","result","id"],"not":{"required":["error"],"properties":{"error":true}},"properties":{"jsonrpc":{"const":"2.0"},"result":true,"id":{"$ref":"../common.schema.json#/definitions/RequestId"}},"additionalProperties":true},"ErrorResponse":{"type":"object","required":["jsonrpc","error","id"],"not":{"required":["result"],"properties":{"result":true}},"properties":{"jsonrpc":{"const":"2.0"},"error":{"type":"object","required":["code","message"],"properties":{"code":{"type":"integer"},"message":{"type":"string"},"data":true},"additionalProperties":true},"id":{"oneOf":[{"$ref":"../common.schema.json#/definitions/RequestId"},{"type":"null"}]}},"additionalProperties":true}}};
const schema69 = {"type":"object","required":["jsonrpc","method"],"not":{"required":["id"],"properties":{"id":true}},"properties":{"jsonrpc":{"const":"2.0"},"method":{"type":"string","minLength":1},"params":{"oneOf":[{"type":"object"},{"type":"array"}]}},"additionalProperties":true};
const schema66 = {"type":"object","required":["jsonrpc","method","id"],"properties":{"jsonrpc":{"const":"2.0"},"method":{"type":"string","minLength":1},"params":{"oneOf":[{"type":"object"},{"type":"array"}]},"id":{"$ref":"../common.schema.json#/definitions/RequestId"},"x-erato-deadline-at":{"type":"string","format":"date-time"}},"additionalProperties":true};
const schema68 = {"oneOf":[{"type":"string","minLength":1,"maxLength":128},{"type":"integer"}]};

function validate51(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!(formats6.validate(data4))){
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
validate51.errors = vErrors;
return errors === 0;
}

const schema70 = {"type":"object","required":["jsonrpc","result","id"],"not":{"required":["error"],"properties":{"error":true}},"properties":{"jsonrpc":{"const":"2.0"},"result":true,"id":{"$ref":"../common.schema.json#/definitions/RequestId"}},"additionalProperties":true};

function validate54(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate54.errors = vErrors;
return errors === 0;
}

const schema72 = {"type":"object","required":["jsonrpc","error","id"],"not":{"required":["result"],"properties":{"result":true}},"properties":{"jsonrpc":{"const":"2.0"},"error":{"type":"object","required":["code","message"],"properties":{"code":{"type":"integer"},"message":{"type":"string"},"data":true},"additionalProperties":true},"id":{"oneOf":[{"$ref":"../common.schema.json#/definitions/RequestId"},{"type":"null"}]}},"additionalProperties":true};

function validate56(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate56.errors = vErrors;
return errors === 0;
}


function validate50(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/json-rpc-envelope.schema.json" */;
let vErrors = null;
let errors = 0;
const _errs0 = errors;
let valid0 = false;
let passing0 = null;
const _errs1 = errors;
if(!(validate51(data, {instancePath,parentData,parentDataProperty,rootData}))){
vErrors = vErrors === null ? validate51.errors : vErrors.concat(validate51.errors);
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
if(!(validate54(data, {instancePath,parentData,parentDataProperty,rootData}))){
vErrors = vErrors === null ? validate54.errors : vErrors.concat(validate54.errors);
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
if(!(validate56(data, {instancePath,parentData,parentDataProperty,rootData}))){
vErrors = vErrors === null ? validate56.errors : vErrors.concat(validate56.errors);
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
validate50.errors = vErrors;
return errors === 0;
}

export const validateDiscoverParams = validate58;
const schema74 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discover-params.schema.json","title":"DiscoverParams","type":"object","required":["protocolVersions","clientInfo","host","os"],"properties":{"protocolVersions":{"type":"array","minItems":1,"uniqueItems":true,"items":{"$ref":"../common.schema.json#/definitions/ProtocolVersion"}},"clientInfo":{"$ref":"../common.schema.json#/definitions/ProductInfo"},"host":{"type":"object","required":["application","runtime"],"properties":{"application":{"type":"string","minLength":1,"maxLength":128},"applicationVersion":{"type":"string","maxLength":128},"runtime":{"type":"string","minLength":1,"maxLength":128},"runtimeVersion":{"type":"string","maxLength":128}},"additionalProperties":true},"os":{"type":"object","required":["name"],"properties":{"name":{"type":"string","minLength":1,"maxLength":128},"version":{"type":"string","maxLength":128},"architecture":{"type":"string","maxLength":64}},"additionalProperties":true}},"additionalProperties":true};
const schema75 = {"type":"string","pattern":"^[1-9][0-9]*\\.[0-9]+$"};
const schema76 = {"type":"object","required":["name","version"],"properties":{"name":{"type":"string","minLength":1,"maxLength":128},"version":{"type":"string","minLength":1,"maxLength":128}},"additionalProperties":true};
const pattern11 = new RegExp("^[1-9][0-9]*\\.[0-9]+$", "u");
const func0 = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function validate58(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern11.test(data1)){
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
validate58.errors = vErrors;
return errors === 0;
}

export const validateDiscoverResult = validate59;
const schema77 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discover-result.schema.json","title":"DiscoverResult","type":"object","required":["protocolVersion","serverInfo","instanceId","document"],"properties":{"protocolVersion":{"$ref":"../common.schema.json#/definitions/ProtocolVersion"},"serverInfo":{"$ref":"../common.schema.json#/definitions/ProductInfo"},"instanceId":{"type":"string","minLength":1,"maxLength":256},"document":{"$ref":"./discovery-document.schema.json"}},"additionalProperties":true};
const schema80 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discovery-document.schema.json","title":"DiscoveryDocument","type":"object","required":["openrpc","info","methods","x-erato-catalogue"],"properties":{"openrpc":{"type":"string","pattern":"^1\\.4\\.[0-9]+$"},"info":{"type":"object","required":["title","version"],"properties":{"title":{"type":"string","minLength":1},"version":{"type":"string","minLength":1}},"additionalProperties":true},"methods":{"type":"array","items":{"type":"object","required":["name","params","result"],"properties":{"name":{"type":"string","minLength":1},"params":{"type":"array"},"result":{"type":"object"},"x-erato-capability":{"$ref":"../capabilities/capability.schema.json"}},"additionalProperties":true}},"x-erato-catalogue":{"$ref":"../common.schema.json#/definitions/CatalogueIdentity"}},"additionalProperties":true};
const schema81 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/capabilities/capability.schema.json","title":"CapabilityDescriptor","type":"object","required":["id","major","method","availability"],"properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$"},"major":{"type":"integer","minimum":1},"method":{"type":"string","pattern":"^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+\\.v[1-9][0-9]*$"},"availability":{"oneOf":[{"type":"object","required":["state"],"properties":{"state":{"const":"enabled"}},"additionalProperties":true},{"type":"object","required":["state","reasonCode"],"properties":{"state":{"const":"disabled"},"reasonCode":{"type":"string","minLength":1,"maxLength":128}},"additionalProperties":true},{"type":"object","required":["state"],"properties":{"state":{"type":"string","not":{"enum":["enabled","disabled"]}}},"additionalProperties":true}]}},"additionalProperties":true};
const pattern13 = new RegExp("^1\\.4\\.[0-9]+$", "u");
const pattern14 = new RegExp("^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$", "u");
const pattern15 = new RegExp("^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+\\.v[1-9][0-9]*$", "u");
const schema82 = {"type":"object","required":["revision","digest"],"properties":{"revision":{"$ref":"#/definitions/Revision"},"digest":{"$ref":"#/definitions/Digest"}},"additionalProperties":true};
const schema83 = {"type":"string","minLength":1,"maxLength":128};
const schema84 = {"type":"string","pattern":"^sha256:[a-f0-9]{64}$"};
const pattern16 = new RegExp("^sha256:[a-f0-9]{64}$", "u");

function validate61(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern16.test(data1)){
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
validate61.errors = vErrors;
return errors === 0;
}


function validate60(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern13.test(data0)){
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
if(!pattern14.test(data10)){
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
if(!pattern15.test(data12)){
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
if(!(validate61(data["x-erato-catalogue"], {instancePath:instancePath+"/x-erato-catalogue",parentData:data,parentDataProperty:"x-erato-catalogue",rootData}))){
vErrors = vErrors === null ? validate61.errors : vErrors.concat(validate61.errors);
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
validate60.errors = vErrors;
return errors === 0;
}


function validate59(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern11.test(data0)){
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
if(!(validate60(data.document, {instancePath:instancePath+"/document",parentData:data,parentDataProperty:"document",rootData}))){
vErrors = vErrors === null ? validate60.errors : vErrors.concat(validate60.errors);
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
validate59.errors = vErrors;
return errors === 0;
}

export const validateCancelParams = validate64;
const schema85 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/cancel-params.schema.json","title":"CancelParams","type":"object","required":["requestId","reason"],"properties":{"requestId":{"$ref":"../common.schema.json#/definitions/RequestId"},"reason":{"type":"string","minLength":1,"maxLength":64}},"additionalProperties":true};

function validate64(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate64.errors = vErrors;
return errors === 0;
}

export const validateCancelResult = validate65;
const schema87 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/cancel-result.schema.json","title":"CancelResult","type":"object","required":["accepted"],"properties":{"accepted":{"type":"boolean"}},"additionalProperties":true};

function validate65(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate65.errors = vErrors;
return errors === 0;
}

export const validateDiscoveryDocument = validate60;

export const validateDiagnosticsEchoV1Params = validate66;
const schema88 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/diagnostics-echo-v1-params.schema.json","title":"DiagnosticsEchoV1Params","type":"object","required":["message"],"properties":{"message":{"type":"string","maxLength":4096},"delayMs":{"description":"Artificial pause before the sidecar answers, in milliseconds, so long-call mechanics — progress polling and cancellation — can be exercised without a real long-running capability. Sidecars report the pause as a `delay` trace step and MAY cap it lower.","type":"integer","minimum":0,"maximum":60000}},"additionalProperties":true};

function validate66(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate66.errors = vErrors;
return errors === 0;
}

export const validateDiagnosticsEchoV1Result = validate67;
const schema89 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/diagnostics-echo-v1-result.schema.json","title":"DiagnosticsEchoV1Result","type":"object","required":["message","sidecarInstanceId"],"properties":{"message":{"type":"string","maxLength":4096},"sidecarInstanceId":{"type":"string","minLength":1,"maxLength":256}},"additionalProperties":true};

function validate67(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate67.errors = vErrors;
return errors === 0;
}

export const validateSidecarOpenDataDirectoryV1Params = validate68;
const schema90 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-open-data-directory-v1-params.schema.json","title":"SidecarOpenDataDirectoryV1Params","type":"object","properties":{},"additionalProperties":true};

function validate68(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-open-data-directory-v1-params.schema.json" */;
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
validate68.errors = vErrors;
return errors === 0;
}

export const validateSidecarOpenDataDirectoryV1Result = validate69;
const schema91 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-open-data-directory-v1-result.schema.json","title":"SidecarOpenDataDirectoryV1Result","type":"object","required":["opened"],"properties":{"opened":{"type":"boolean"}},"additionalProperties":true};

function validate69(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-open-data-directory-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.opened === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "opened"},message:"must have required property '"+"opened"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.opened !== undefined){
if(typeof data.opened !== "boolean"){
const err1 = {instancePath:instancePath+"/opened",schemaPath:"#/properties/opened/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
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
validate69.errors = vErrors;
return errors === 0;
}

export const validateSidecarRestartV1Params = validate70;
const schema92 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-restart-v1-params.schema.json","title":"SidecarRestartV1Params","type":"object","properties":{},"additionalProperties":true};

function validate70(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate70.errors = vErrors;
return errors === 0;
}

export const validateSidecarRestartV1Result = validate71;
const schema93 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-restart-v1-result.schema.json","title":"SidecarRestartV1Result","type":"object","required":["accepted"],"properties":{"accepted":{"type":"boolean"}},"additionalProperties":true};

function validate71(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate71.errors = vErrors;
return errors === 0;
}

export const validateSidecarConfigureV1Params = validate72;
const schema94 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-configure-v1-params.schema.json","title":"SidecarConfigureV1Params","type":"object","required":["user_configuration","organization_configuration"],"properties":{"user_configuration":{"$ref":"../configuration/sidecar-configuration.schema.json"},"organization_configuration":{"$ref":"../configuration/sidecar-configuration.schema.json"}},"additionalProperties":true};

function validate72(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(data0.indexing_mailboxes !== undefined){
let data1 = data0.indexing_mailboxes;
if((!(Array.isArray(data1))) && (data1 !== null)){
const err2 = {instancePath:instancePath+"/user_configuration/indexing_mailboxes",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/type",keyword:"type",params:{type: schema24.properties.indexing_mailboxes.type},message:"must be array,null"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(Array.isArray(data1)){
const len0 = data1.length;
for(let i0=0; i0<len0; i0++){
let data2 = data1[i0];
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(data2.mailbox_id === undefined){
const err3 = {instancePath:instancePath+"/user_configuration/indexing_mailboxes/" + i0,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/required",keyword:"required",params:{missingProperty: "mailbox_id"},message:"must have required property '"+"mailbox_id"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data2.enabled === undefined){
const err4 = {instancePath:instancePath+"/user_configuration/indexing_mailboxes/" + i0,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/required",keyword:"required",params:{missingProperty: "enabled"},message:"must have required property '"+"enabled"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data2.priority === undefined){
const err5 = {instancePath:instancePath+"/user_configuration/indexing_mailboxes/" + i0,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/required",keyword:"required",params:{missingProperty: "priority"},message:"must have required property '"+"priority"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data2.mailbox_id !== undefined){
let data3 = data2.mailbox_id;
if(typeof data3 === "string"){
if(!(formats0.test(data3))){
const err6 = {instancePath:instancePath+"/user_configuration/indexing_mailboxes/" + i0+"/mailbox_id",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/mailbox_id/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err7 = {instancePath:instancePath+"/user_configuration/indexing_mailboxes/" + i0+"/mailbox_id",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/mailbox_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data2.enabled !== undefined){
if(typeof data2.enabled !== "boolean"){
const err8 = {instancePath:instancePath+"/user_configuration/indexing_mailboxes/" + i0+"/enabled",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/enabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data2.priority !== undefined){
let data5 = data2.priority;
if(!(((typeof data5 == "number") && (!(data5 % 1) && !isNaN(data5))) && (isFinite(data5)))){
const err9 = {instancePath:instancePath+"/user_configuration/indexing_mailboxes/" + i0+"/priority",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/priority/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if((typeof data5 == "number") && (isFinite(data5))){
if(data5 > 9007199254740991 || isNaN(data5)){
const err10 = {instancePath:instancePath+"/user_configuration/indexing_mailboxes/" + i0+"/priority",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/priority/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data5 < 0 || isNaN(data5)){
const err11 = {instancePath:instancePath+"/user_configuration/indexing_mailboxes/" + i0+"/priority",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/priority/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
const err12 = {instancePath:instancePath+"/user_configuration/indexing_mailboxes/" + i0,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
}
if(data0.show_tray_icon !== undefined){
let data6 = data0.show_tray_icon;
if((typeof data6 !== "boolean") && (data6 !== null)){
const err13 = {instancePath:instancePath+"/user_configuration/show_tray_icon",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/show_tray_icon/type",keyword:"type",params:{type: schema24.properties.show_tray_icon.type},message:"must be boolean,null"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data0.indexing_parallelism !== undefined){
let data7 = data0.indexing_parallelism;
if((!(((typeof data7 == "number") && (!(data7 % 1) && !isNaN(data7))) && (isFinite(data7)))) && (data7 !== null)){
const err14 = {instancePath:instancePath+"/user_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/type",keyword:"type",params:{type: schema24.properties.indexing_parallelism.type},message:"must be integer,null"};
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
const err15 = {instancePath:instancePath+"/user_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data7 < 1 || isNaN(data7)){
const err16 = {instancePath:instancePath+"/user_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data0.indexing_documents_per_minute !== undefined){
let data8 = data0.indexing_documents_per_minute;
if((!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))) && (data8 !== null)){
const err17 = {instancePath:instancePath+"/user_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/type",keyword:"type",params:{type: schema24.properties.indexing_documents_per_minute.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 > 9007199254740991 || isNaN(data8)){
const err18 = {instancePath:instancePath+"/user_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
if(data8 < 1 || isNaN(data8)){
const err19 = {instancePath:instancePath+"/user_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
}
else {
const err20 = {instancePath:instancePath+"/user_configuration",schemaPath:"../configuration/sidecar-configuration.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data.organization_configuration !== undefined){
let data9 = data.organization_configuration;
if(data9 && typeof data9 == "object" && !Array.isArray(data9)){
if(data9.indexing_mailboxes !== undefined){
let data10 = data9.indexing_mailboxes;
if((!(Array.isArray(data10))) && (data10 !== null)){
const err21 = {instancePath:instancePath+"/organization_configuration/indexing_mailboxes",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/type",keyword:"type",params:{type: schema24.properties.indexing_mailboxes.type},message:"must be array,null"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(Array.isArray(data10)){
const len1 = data10.length;
for(let i1=0; i1<len1; i1++){
let data11 = data10[i1];
if(data11 && typeof data11 == "object" && !Array.isArray(data11)){
if(data11.mailbox_id === undefined){
const err22 = {instancePath:instancePath+"/organization_configuration/indexing_mailboxes/" + i1,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/required",keyword:"required",params:{missingProperty: "mailbox_id"},message:"must have required property '"+"mailbox_id"+"'"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if(data11.enabled === undefined){
const err23 = {instancePath:instancePath+"/organization_configuration/indexing_mailboxes/" + i1,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/required",keyword:"required",params:{missingProperty: "enabled"},message:"must have required property '"+"enabled"+"'"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(data11.priority === undefined){
const err24 = {instancePath:instancePath+"/organization_configuration/indexing_mailboxes/" + i1,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/required",keyword:"required",params:{missingProperty: "priority"},message:"must have required property '"+"priority"+"'"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if(data11.mailbox_id !== undefined){
let data12 = data11.mailbox_id;
if(typeof data12 === "string"){
if(!(formats0.test(data12))){
const err25 = {instancePath:instancePath+"/organization_configuration/indexing_mailboxes/" + i1+"/mailbox_id",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/mailbox_id/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err26 = {instancePath:instancePath+"/organization_configuration/indexing_mailboxes/" + i1+"/mailbox_id",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/mailbox_id/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
if(data11.enabled !== undefined){
if(typeof data11.enabled !== "boolean"){
const err27 = {instancePath:instancePath+"/organization_configuration/indexing_mailboxes/" + i1+"/enabled",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/enabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err27];
}
else {
vErrors.push(err27);
}
errors++;
}
}
if(data11.priority !== undefined){
let data14 = data11.priority;
if(!(((typeof data14 == "number") && (!(data14 % 1) && !isNaN(data14))) && (isFinite(data14)))){
const err28 = {instancePath:instancePath+"/organization_configuration/indexing_mailboxes/" + i1+"/priority",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/priority/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
if((typeof data14 == "number") && (isFinite(data14))){
if(data14 > 9007199254740991 || isNaN(data14)){
const err29 = {instancePath:instancePath+"/organization_configuration/indexing_mailboxes/" + i1+"/priority",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/priority/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err29];
}
else {
vErrors.push(err29);
}
errors++;
}
if(data14 < 0 || isNaN(data14)){
const err30 = {instancePath:instancePath+"/organization_configuration/indexing_mailboxes/" + i1+"/priority",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/properties/priority/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
}
else {
const err31 = {instancePath:instancePath+"/organization_configuration/indexing_mailboxes/" + i1,schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_mailboxes/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
}
if(data9.show_tray_icon !== undefined){
let data15 = data9.show_tray_icon;
if((typeof data15 !== "boolean") && (data15 !== null)){
const err32 = {instancePath:instancePath+"/organization_configuration/show_tray_icon",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/show_tray_icon/type",keyword:"type",params:{type: schema24.properties.show_tray_icon.type},message:"must be boolean,null"};
if(vErrors === null){
vErrors = [err32];
}
else {
vErrors.push(err32);
}
errors++;
}
}
if(data9.indexing_parallelism !== undefined){
let data16 = data9.indexing_parallelism;
if((!(((typeof data16 == "number") && (!(data16 % 1) && !isNaN(data16))) && (isFinite(data16)))) && (data16 !== null)){
const err33 = {instancePath:instancePath+"/organization_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/type",keyword:"type",params:{type: schema24.properties.indexing_parallelism.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err33];
}
else {
vErrors.push(err33);
}
errors++;
}
if((typeof data16 == "number") && (isFinite(data16))){
if(data16 > 9007199254740991 || isNaN(data16)){
const err34 = {instancePath:instancePath+"/organization_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err34];
}
else {
vErrors.push(err34);
}
errors++;
}
if(data16 < 1 || isNaN(data16)){
const err35 = {instancePath:instancePath+"/organization_configuration/indexing_parallelism",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_parallelism/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
if(data9.indexing_documents_per_minute !== undefined){
let data17 = data9.indexing_documents_per_minute;
if((!(((typeof data17 == "number") && (!(data17 % 1) && !isNaN(data17))) && (isFinite(data17)))) && (data17 !== null)){
const err36 = {instancePath:instancePath+"/organization_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/type",keyword:"type",params:{type: schema24.properties.indexing_documents_per_minute.type},message:"must be integer,null"};
if(vErrors === null){
vErrors = [err36];
}
else {
vErrors.push(err36);
}
errors++;
}
if((typeof data17 == "number") && (isFinite(data17))){
if(data17 > 9007199254740991 || isNaN(data17)){
const err37 = {instancePath:instancePath+"/organization_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/maximum",keyword:"maximum",params:{comparison: "<=", limit: 9007199254740991},message:"must be <= 9007199254740991"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
if(data17 < 1 || isNaN(data17)){
const err38 = {instancePath:instancePath+"/organization_configuration/indexing_documents_per_minute",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/indexing_documents_per_minute/minimum",keyword:"minimum",params:{comparison: ">=", limit: 1},message:"must be >= 1"};
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
}
else {
const err39 = {instancePath:instancePath+"/organization_configuration",schemaPath:"../configuration/sidecar-configuration.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
validate72.errors = vErrors;
return errors === 0;
}

export const validateSidecarConfigureV1Result = validate73;
const schema97 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-configure-v1-result.schema.json","title":"SidecarConfigureV1Result","type":"object","additionalProperties":true};

function validate73(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate73.errors = vErrors;
return errors === 0;
}

export const validateOutlookListMailboxesV1Params = validate74;
const schema98 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-mailboxes-v1-params.schema.json","title":"OutlookListMailboxesV1Params","type":"object","properties":{},"additionalProperties":true};

function validate74(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate74.errors = vErrors;
return errors === 0;
}

export const validateOutlookListMailboxesV1Result = validate75;
const schema99 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-mailboxes-v1-result.schema.json","title":"OutlookListMailboxesV1Result","type":"object","required":["mailboxes","warnings"],"properties":{"mailboxes":{"type":"array","items":{"$ref":"../outlook/mailbox.schema.json"},"maxItems":1024},"warnings":{"type":"array","items":{"$ref":"../outlook/listing-warning.schema.json"},"maxItems":1024}},"additionalProperties":true};
const schema100 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/mailbox.schema.json","title":"OutlookMailbox","description":"A mailbox or message store available through the local Outlook installation.","type":"object","required":["id","displayName","source"],"properties":{"id":{"description":"Short opaque mailbox identifier. It is unique for the current sidecar runtime and logically stable across restarts while the Outlook profile and store identity remain unchanged.","type":"string","pattern":"^[0-9a-f]{32}$"},"displayName":{"type":"string","minLength":1,"maxLength":1024},"emailAddress":{"type":"string","minLength":1,"maxLength":1024},"profileName":{"description":"Name of the Outlook profile containing this mailbox. Omitted when the platform or standalone store has no profile concept.","type":"string","minLength":1,"maxLength":1024},"source":{"description":"Implementation-defined local Outlook storage source. Known values include pst, ost, macOsProfile, and windowsOutlook.","type":"string","minLength":1,"maxLength":128}},"additionalProperties":true};
const schema101 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/listing-warning.schema.json","title":"OutlookListingWarning","description":"A local Outlook source that could not be inspected without hiding successful results.","type":"object","required":["message"],"properties":{"path":{"type":"string","minLength":1,"maxLength":32768},"message":{"type":"string","minLength":1,"maxLength":4096}},"additionalProperties":true};
const pattern17 = new RegExp("^[0-9a-f]{32}$", "u");

function validate75(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern17.test(data2)){
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
validate75.errors = vErrors;
return errors === 0;
}

export const validateOutlookListEmailsV1Params = validate76;
const schema102 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-emails-v1-params.schema.json","title":"OutlookListEmailsV1Params","type":"object","required":["mailboxId"],"properties":{"mailboxId":{"description":"Short opaque identifier returned by outlook.list_mailboxes.v1.","type":"string","pattern":"^[0-9a-f]{32}$"}},"additionalProperties":true};

function validate76(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern17.test(data0)){
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
validate76.errors = vErrors;
return errors === 0;
}

export const validateOutlookListEmailsV1Result = validate77;
const schema103 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-emails-v1-result.schema.json","title":"OutlookListEmailsV1Result","description":"Up to 50 of the newest locally indexed emails in the selected mailbox.","type":"object","required":["mailbox","emails"],"properties":{"mailbox":{"$ref":"../outlook/mailbox.schema.json"},"emails":{"type":"array","items":{"$ref":"../outlook/email-summary.schema.json"},"maxItems":50}},"additionalProperties":true};
const schema105 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/email-summary.schema.json","title":"OutlookEmailSummary","description":"Metadata for one locally indexed Outlook email.","type":"object","required":["id"],"properties":{"id":{"description":"Source-specific stable message identifier.","type":"string","minLength":1,"maxLength":32768},"subject":{"type":"string","maxLength":32768},"senderName":{"type":"string","maxLength":4096},"senderEmailAddress":{"type":"string","maxLength":4096},"receivedAtUnixSeconds":{"description":"UTC Unix timestamp in whole seconds.","type":"integer","minimum":-62135596800,"maximum":253402300799},"internetMessageId":{"type":"string","maxLength":32768}},"additionalProperties":true};

function validate77(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern17.test(data1)){
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
validate77.errors = vErrors;
return errors === 0;
}

export const validateOutlookGetConversationV1Params = validate78;
const schema106 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-get-conversation-v1-params.schema.json","title":"OutlookGetConversationV1Params","type":"object","required":["mailboxId","anchor"],"properties":{"mailboxId":{"description":"Short opaque identifier returned by outlook.list_mailboxes.v1.","type":"string","pattern":"^[0-9a-f]{32}$"},"anchor":{"description":"The message the conversation is resolved from.","type":"object","required":["internetMessageId"],"properties":{"internetMessageId":{"description":"RFC 5322 Message-ID of the anchor message, including angle brackets, as reported by outlook.list_emails.v1. Not the Office.js conversationId.","type":"string","minLength":1,"maxLength":32768}},"additionalProperties":true},"maxMessages":{"description":"Cap on the number of returned messages. When the conversation has more, the result is reported as partial.","type":"integer","minimum":1,"maximum":1000}},"additionalProperties":true};

function validate78(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern17.test(data0)){
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
validate78.errors = vErrors;
return errors === 0;
}

export const validateOutlookGetConversationV1Result = validate79;
const schema107 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-get-conversation-v1-result.schema.json","title":"OutlookGetConversationV1Result","description":"The messages of the anchored conversation, oldest first, with bodies and attachment bytes carried inline.","type":"object","required":["state","messages"],"properties":{"state":{"description":"Completeness of the conversation. ok means every message and byte reference was produced; partial means some were omitted (see warnings), for example because maxMessages was reached or an attachment could not be read.","type":"string","minLength":1,"maxLength":32},"mailbox":{"$ref":"../outlook/mailbox.schema.json"},"messages":{"type":"array","items":{"$ref":"../outlook/conversation-message.schema.json"}},"warnings":{"type":"array","items":{"$ref":"../outlook/conversation-warning.schema.json"}}},"additionalProperties":true};
const schema117 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/conversation-warning.schema.json","title":"OutlookConversationWarning","description":"A part of a conversation that could not be represented fully, without hiding the rest.","type":"object","required":["code"],"properties":{"code":{"description":"Stable machine-readable warning code. Known values include truncated, attachment_unavailable, and embedded_attachments_omitted.","type":"string","minLength":1,"maxLength":128},"message":{"type":"string","minLength":1,"maxLength":4096},"internetMessageId":{"description":"The message the warning is about, when it is message-scoped.","type":"string","maxLength":32768}},"additionalProperties":true};
const schema109 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/conversation-message.schema.json","title":"OutlookConversationMessage","description":"One message of an Outlook conversation, with its body and attachment bytes carried inline.","type":"object","required":["attachments"],"properties":{"internetMessageId":{"type":"string","maxLength":32768},"subject":{"type":"string","maxLength":32768},"from":{"$ref":"../outlook/message-recipient.schema.json"},"to":{"type":"array","items":{"$ref":"../outlook/message-recipient.schema.json"}},"cc":{"type":"array","items":{"$ref":"../outlook/message-recipient.schema.json"}},"sentAtUnixSeconds":{"description":"UTC Unix timestamp in whole seconds.","type":"integer","minimum":-62135596800,"maximum":253402300799},"receivedAtUnixSeconds":{"description":"UTC Unix timestamp in whole seconds.","type":"integer","minimum":-62135596800,"maximum":253402300799},"isDraft":{"description":"True when the message is an unsent draft.","type":"boolean"},"conversationIndex":{"description":"Lowercase hex PidTagConversationIndex; its embedded GUID groups the thread.","type":"string","maxLength":8192},"body":{"$ref":"../outlook/message-body.schema.json"},"attachments":{"type":"array","items":{"$ref":"../outlook/attachment-reference.schema.json"}},"external_ids":{"$ref":"../source/external-ids.schema.json"}},"additionalProperties":true};
const schema110 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/message-recipient.schema.json","title":"OutlookMessageRecipient","description":"One recipient of an Outlook message.","type":"object","properties":{"name":{"description":"Display name, when present.","type":"string","maxLength":4096},"emailAddress":{"description":"SMTP address. Omitted when only a non-routable Exchange address is stored locally.","type":"string","maxLength":4096}},"additionalProperties":true};
const schema113 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/message-body.schema.json","title":"OutlookMessageBody","description":"A message body carried inline in the JSON-RPC result. The sidecar decodes the stored bytes to text using the message code page before sending.","type":"object","required":["contentType","content"],"properties":{"contentType":{"description":"Media type of the body, for example text/html or text/plain.","type":"string","maxLength":256},"content":{"description":"The decoded body text.","type":"string"}},"additionalProperties":true};
const schema114 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/attachment-reference.schema.json","title":"OutlookAttachmentReference","description":"Metadata and inline bytes for one attachment. When the bytes are available they are base64-encoded in contentBytes; otherwise unavailableReason explains why.","type":"object","properties":{"name":{"description":"File name, when present.","type":"string","maxLength":4096},"contentType":{"description":"Media type of the bytes. Embedded messages are reported as message/rfc822.","type":"string","maxLength":256},"size":{"description":"Exact length of the attachment bytes.","type":"integer","minimum":0},"isInline":{"description":"True when the attachment is referenced from the message body by contentId.","type":"boolean"},"contentId":{"description":"Content-ID for an inline attachment, without angle brackets.","type":"string","maxLength":4096},"sha256":{"description":"Lowercase hex SHA-256 of the attachment bytes, useful for de-duplicating attachments repeated across thread messages.","type":"string","pattern":"^[a-f0-9]{64}$"},"contentBytes":{"description":"Base64-encoded attachment bytes, present when the bytes are available.","type":"string"},"unavailableReason":{"description":"Stable code explaining why bytes are not available, present instead of contentBytes. Known values include unsupported_attachment.","type":"string","minLength":1,"maxLength":128},"external_ids":{"$ref":"../source/external-ids.schema.json"},"topLevelParent":{"$ref":"../source/top-level-parent.schema.json"}},"additionalProperties":true};
const pattern22 = new RegExp("^[a-f0-9]{64}$", "u");

function validate81(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/outlook/attachment-reference.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.name !== undefined){
let data0 = data.name;
if(typeof data0 === "string"){
if(func2(data0) > 4096){
const err0 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath:instancePath+"/name",schemaPath:"#/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.contentType !== undefined){
let data1 = data.contentType;
if(typeof data1 === "string"){
if(func2(data1) > 256){
const err2 = {instancePath:instancePath+"/contentType",schemaPath:"#/properties/contentType/maxLength",keyword:"maxLength",params:{limit: 256},message:"must NOT have more than 256 characters"};
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
const err3 = {instancePath:instancePath+"/contentType",schemaPath:"#/properties/contentType/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.size !== undefined){
let data2 = data.size;
if(!(((typeof data2 == "number") && (!(data2 % 1) && !isNaN(data2))) && (isFinite(data2)))){
const err4 = {instancePath:instancePath+"/size",schemaPath:"#/properties/size/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if((typeof data2 == "number") && (isFinite(data2))){
if(data2 < 0 || isNaN(data2)){
const err5 = {instancePath:instancePath+"/size",schemaPath:"#/properties/size/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data.isInline !== undefined){
if(typeof data.isInline !== "boolean"){
const err6 = {instancePath:instancePath+"/isInline",schemaPath:"#/properties/isInline/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
}
if(data.contentId !== undefined){
let data4 = data.contentId;
if(typeof data4 === "string"){
if(func2(data4) > 4096){
const err7 = {instancePath:instancePath+"/contentId",schemaPath:"#/properties/contentId/maxLength",keyword:"maxLength",params:{limit: 4096},message:"must NOT have more than 4096 characters"};
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
const err8 = {instancePath:instancePath+"/contentId",schemaPath:"#/properties/contentId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
}
if(data.sha256 !== undefined){
let data5 = data.sha256;
if(typeof data5 === "string"){
if(!pattern22.test(data5)){
const err9 = {instancePath:instancePath+"/sha256",schemaPath:"#/properties/sha256/pattern",keyword:"pattern",params:{pattern: "^[a-f0-9]{64}$"},message:"must match pattern \""+"^[a-f0-9]{64}$"+"\""};
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
const err10 = {instancePath:instancePath+"/sha256",schemaPath:"#/properties/sha256/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
}
if(data.contentBytes !== undefined){
if(typeof data.contentBytes !== "string"){
const err11 = {instancePath:instancePath+"/contentBytes",schemaPath:"#/properties/contentBytes/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data.unavailableReason !== undefined){
let data7 = data.unavailableReason;
if(typeof data7 === "string"){
if(func2(data7) > 128){
const err12 = {instancePath:instancePath+"/unavailableReason",schemaPath:"#/properties/unavailableReason/maxLength",keyword:"maxLength",params:{limit: 128},message:"must NOT have more than 128 characters"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
if(func2(data7) < 1){
const err13 = {instancePath:instancePath+"/unavailableReason",schemaPath:"#/properties/unavailableReason/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err14 = {instancePath:instancePath+"/unavailableReason",schemaPath:"#/properties/unavailableReason/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data.external_ids !== undefined){
let data8 = data.external_ids;
if(Array.isArray(data8)){
const len0 = data8.length;
for(let i0=0; i0<len0; i0++){
let data9 = data8[i0];
if(data9 && typeof data9 == "object" && !Array.isArray(data9)){
if(data9.key === undefined){
const err15 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"../source/external-ids.schema.json/items/required",keyword:"required",params:{missingProperty: "key"},message:"must have required property '"+"key"+"'"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
if(data9.value === undefined){
const err16 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"../source/external-ids.schema.json/items/required",keyword:"required",params:{missingProperty: "value"},message:"must have required property '"+"value"+"'"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
for(const key0 in data9){
if(!((key0 === "key") || (key0 === "value"))){
const err17 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"../source/external-ids.schema.json/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data9.key !== undefined){
let data10 = data9.key;
if(typeof data10 === "string"){
if(func2(data10) < 1){
const err18 = {instancePath:instancePath+"/external_ids/" + i0+"/key",schemaPath:"../source/external-ids.schema.json/items/properties/key/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err19 = {instancePath:instancePath+"/external_ids/" + i0+"/key",schemaPath:"../source/external-ids.schema.json/items/properties/key/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data9.value !== undefined){
let data11 = data9.value;
if(typeof data11 === "string"){
if(func2(data11) < 1){
const err20 = {instancePath:instancePath+"/external_ids/" + i0+"/value",schemaPath:"../source/external-ids.schema.json/items/properties/value/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err21 = {instancePath:instancePath+"/external_ids/" + i0+"/value",schemaPath:"../source/external-ids.schema.json/items/properties/value/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err22 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"../source/external-ids.schema.json/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err23 = {instancePath:instancePath+"/external_ids",schemaPath:"../source/external-ids.schema.json/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
}
if(data.topLevelParent !== undefined){
if(!(validate43(data.topLevelParent, {instancePath:instancePath+"/topLevelParent",parentData:data,parentDataProperty:"topLevelParent",rootData}))){
vErrors = vErrors === null ? validate43.errors : vErrors.concat(validate43.errors);
errors = vErrors.length;
}
}
}
else {
const err24 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
validate81.errors = vErrors;
return errors === 0;
}


function validate80(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!(validate81(data20[i2], {instancePath:instancePath+"/attachments/" + i2,parentData:data20,parentDataProperty:i2,rootData}))){
vErrors = vErrors === null ? validate81.errors : vErrors.concat(validate81.errors);
errors = vErrors.length;
}
}
}
else {
const err37 = {instancePath:instancePath+"/attachments",schemaPath:"#/properties/attachments/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err37];
}
else {
vErrors.push(err37);
}
errors++;
}
}
if(data.external_ids !== undefined){
let data22 = data.external_ids;
if(Array.isArray(data22)){
const len3 = data22.length;
for(let i3=0; i3<len3; i3++){
let data23 = data22[i3];
if(data23 && typeof data23 == "object" && !Array.isArray(data23)){
if(data23.key === undefined){
const err38 = {instancePath:instancePath+"/external_ids/" + i3,schemaPath:"../source/external-ids.schema.json/items/required",keyword:"required",params:{missingProperty: "key"},message:"must have required property '"+"key"+"'"};
if(vErrors === null){
vErrors = [err38];
}
else {
vErrors.push(err38);
}
errors++;
}
if(data23.value === undefined){
const err39 = {instancePath:instancePath+"/external_ids/" + i3,schemaPath:"../source/external-ids.schema.json/items/required",keyword:"required",params:{missingProperty: "value"},message:"must have required property '"+"value"+"'"};
if(vErrors === null){
vErrors = [err39];
}
else {
vErrors.push(err39);
}
errors++;
}
for(const key0 in data23){
if(!((key0 === "key") || (key0 === "value"))){
const err40 = {instancePath:instancePath+"/external_ids/" + i3,schemaPath:"../source/external-ids.schema.json/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err40];
}
else {
vErrors.push(err40);
}
errors++;
}
}
if(data23.key !== undefined){
let data24 = data23.key;
if(typeof data24 === "string"){
if(func2(data24) < 1){
const err41 = {instancePath:instancePath+"/external_ids/" + i3+"/key",schemaPath:"../source/external-ids.schema.json/items/properties/key/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err41];
}
else {
vErrors.push(err41);
}
errors++;
}
}
else {
const err42 = {instancePath:instancePath+"/external_ids/" + i3+"/key",schemaPath:"../source/external-ids.schema.json/items/properties/key/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err42];
}
else {
vErrors.push(err42);
}
errors++;
}
}
if(data23.value !== undefined){
let data25 = data23.value;
if(typeof data25 === "string"){
if(func2(data25) < 1){
const err43 = {instancePath:instancePath+"/external_ids/" + i3+"/value",schemaPath:"../source/external-ids.schema.json/items/properties/value/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
if(vErrors === null){
vErrors = [err43];
}
else {
vErrors.push(err43);
}
errors++;
}
}
else {
const err44 = {instancePath:instancePath+"/external_ids/" + i3+"/value",schemaPath:"../source/external-ids.schema.json/items/properties/value/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err44];
}
else {
vErrors.push(err44);
}
errors++;
}
}
}
else {
const err45 = {instancePath:instancePath+"/external_ids/" + i3,schemaPath:"../source/external-ids.schema.json/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err45];
}
else {
vErrors.push(err45);
}
errors++;
}
}
}
else {
const err46 = {instancePath:instancePath+"/external_ids",schemaPath:"../source/external-ids.schema.json/type",keyword:"type",params:{type: "array"},message:"must be array"};
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
const err47 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err47];
}
else {
vErrors.push(err47);
}
errors++;
}
validate80.errors = vErrors;
return errors === 0;
}


function validate79(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern17.test(data2)){
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
if(!(validate80(data7[i0], {instancePath:instancePath+"/messages/" + i0,parentData:data7,parentDataProperty:i0,rootData}))){
vErrors = vErrors === null ? validate80.errors : vErrors.concat(validate80.errors);
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
validate79.errors = vErrors;
return errors === 0;
}

export const validateSidecarProgressV1Params = validate85;
const schema118 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-progress-v1-params.schema.json","title":"SidecarProgressV1Params","description":"Names the pending request whose on-device progress the client wants to observe. The request is identified by the JSON-RPC request ID the client generated for it; visibility is scoped to the Origin that issued that request.","type":"object","required":["requestId"],"properties":{"requestId":{"$ref":"../common.schema.json#/definitions/RequestId"}},"additionalProperties":true};

function validate85(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate85.errors = vErrors;
return errors === 0;
}

export const validateSidecarProgressV1Result = validate86;
const schema120 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-progress-v1-result.schema.json","title":"SidecarProgressV1Result","description":"A point-in-time view of one request's on-device progress. `trace` carries the same append-only event log a result may embed, so a client that applies steps by `sequence` (last one wins) renders a polled log and a complete log identically.","type":"object","required":["state"],"properties":{"state":{"description":"Where the named request is in its lifecycle. Known values are running, finished, and unknown. Receivers treat unrecognized values as running.","type":"string","minLength":1,"maxLength":64},"trace":{"description":"The sidecar's step log for the named request so far. Metadata only — never message content. Absent when the request is unknown or recorded no steps.","$ref":"../outlook/local-trace.schema.json"}},"additionalProperties":true};
const schema121 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/local-trace.schema.json","title":"SidecarLocalTrace","description":"The sidecar's internal on-device steps for one request, as an append-only event log. Protocol 1.0 delivers the whole log with the result; a future delivery mode may append to it incrementally, and a client that applies steps by `sequence` (last one wins) renders both identically. Contains no message content, so it can be shown even when the user declines to share the result.","type":"object","required":["steps"],"properties":{"steps":{"type":"array","items":{"$ref":"../outlook/local-trace-step.schema.json"},"maxItems":32},"totalDurationMs":{"type":"integer","minimum":0}},"additionalProperties":true};
const schema122 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/local-trace-step.schema.json","title":"SidecarLocalTraceStep","description":"One internal on-device processing step, shaped as an event: a stable `sequence` identity carrying a status that may evolve. Metadata only: never message content, snippets, or file names.","type":"object","required":["sequence","id","status"],"properties":{"sequence":{"description":"Stable identity of this step within the request, and its ordering key. A later step with the same sequence supersedes an earlier one, so the same payload works whether the log arrives complete or is appended to over time.","type":"integer","minimum":0},"id":{"description":"Step identifier. Known values include expandQuery, buildIndex, match, and summarize. Receivers ignore unknown values and render them by their raw id.","type":"string","minLength":1,"maxLength":128},"status":{"description":"Step outcome. Known values include running, ok, skipped, degraded, and error. Receivers treat unknown values as running.","type":"string","minLength":1,"maxLength":64},"parentSequence":{"description":"Sequence of the step this one runs inside, when the sidecar nests work (for example a tool call made during a local model turn). Absent for top-level steps.","type":"integer","minimum":0},"startedAtOffsetMs":{"description":"Milliseconds between the start of the request and the start of this step, so a client can order and place steps identically in both delivery modes.","type":"integer","minimum":0},"durationMs":{"type":"integer","minimum":0},"model":{"description":"Identifier of the local model this step used, when it used one.","type":"string","minLength":1,"maxLength":256},"cacheHit":{"description":"Whether this step was served from a local cache (for example the in-memory mailbox index).","type":"boolean"},"detail":{"description":"Short non-sensitive note — the sidecar's counterpart of a progress message: why a step was skipped or degraded, or what it is doing.","type":"string","maxLength":512},"counts":{"description":"Item counts keyed by an open string. Known keys include keywordsIn, keywordsOut, messagesScanned, matched, and hitsReturned.","type":"object","maxProperties":16,"additionalProperties":{"type":"integer","minimum":0}}},"additionalProperties":true};

function validate87(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate87.errors = vErrors;
return errors === 0;
}


function validate86(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!(validate87(data.trace, {instancePath:instancePath+"/trace",parentData:data,parentDataProperty:"trace",rootData}))){
vErrors = vErrors === null ? validate87.errors : vErrors.concat(validate87.errors);
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
validate86.errors = vErrors;
return errors === 0;
}

export const validateOutlookSearchEmailsV1Params = validate89;
const schema123 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-search-emails-v1-params.schema.json","title":"OutlookSearchEmailsV1Params","type":"object","required":["mailboxId","query"],"properties":{"mailboxId":{"description":"Short opaque identifier returned by outlook.list_mailboxes.v1.","type":"string","pattern":"^[0-9a-f]{32}$"},"query":{"description":"Natural-language or keyword query. The sidecar may expand it into additional local search terms.","type":"string","minLength":1,"maxLength":1024},"limit":{"description":"Maximum number of hits to return. Defaults to 10.","type":"integer","minimum":1,"maximum":50},"includeAttachments":{"description":"Also match against attachment file names and locally extractable attachment text. Defaults to true.","type":"boolean"},"summarize":{"description":"Produce a locally generated plain-text summary of the hits when a local model is configured. Defaults to true.","type":"boolean"}},"additionalProperties":true};

function validate89(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern17.test(data0)){
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
validate89.errors = vErrors;
return errors === 0;
}

export const validateOutlookSearchEmailsV1Result = validate90;
const schema124 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-search-emails-v1-result.schema.json","title":"OutlookSearchEmailsV1Result","description":"Locally matched emails for a query, with an optional locally generated summary. Search and summarization both run entirely on the device.","type":"object","required":["mailbox","hits"],"properties":{"mailbox":{"$ref":"../outlook/mailbox.schema.json"},"hits":{"type":"array","items":{"$ref":"../outlook/search-hit.schema.json"},"maxItems":50},"totalMatched":{"description":"Number of matching messages before the limit was applied.","type":"integer","minimum":0},"summary":{"description":"Plain-text summary of the hits generated by a local model. Absent when summarization was not requested or no local model is available.","type":"string","maxLength":32768},"summaryModel":{"description":"Identifier of the local model that generated the summary, for user-facing transparency.","type":"string","minLength":1,"maxLength":256},"expandedKeywords":{"description":"Search terms actually used after local query expansion.","type":"array","items":{"type":"string","minLength":1,"maxLength":256},"maxItems":32},"warnings":{"description":"Local sources or messages that could not be inspected without hiding successful results.","type":"array","items":{"$ref":"../outlook/listing-warning.schema.json"}},"trace":{"description":"Metadata about the sidecar's internal on-device steps (durations, models, item counts). Never contains message content.","$ref":"../outlook/local-trace.schema.json"}},"additionalProperties":true};
const schema126 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/search-hit.schema.json","title":"OutlookSearchHit","description":"One locally matched email for an outlook.search_emails.v1 query.","type":"object","required":["email"],"properties":{"email":{"$ref":"../outlook/email-summary.schema.json"},"snippet":{"description":"Short plain-text excerpt around the strongest match. Never a full message body.","type":"string","maxLength":2048},"matchedIn":{"description":"Fields the query matched. Known values include subject, body, sender, attachmentName, and attachmentContent. Receivers ignore unknown values.","type":"array","items":{"type":"string","minLength":1,"maxLength":128},"maxItems":16},"matchedAttachmentNames":{"description":"File names of attachments whose name or extracted text matched the query.","type":"array","items":{"type":"string","minLength":1,"maxLength":1024},"maxItems":64}},"additionalProperties":true};

function validate91(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate91.errors = vErrors;
return errors === 0;
}


function validate90(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern17.test(data1)){
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
if(!(validate91(data6[i0], {instancePath:instancePath+"/hits/" + i0,parentData:data6,parentDataProperty:i0,rootData}))){
vErrors = vErrors === null ? validate91.errors : vErrors.concat(validate91.errors);
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
if(!(validate87(data.trace, {instancePath:instancePath+"/trace",parentData:data,parentDataProperty:"trace",rootData}))){
vErrors = vErrors === null ? validate87.errors : vErrors.concat(validate87.errors);
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
validate90.errors = vErrors;
return errors === 0;
}

export const validateSourcesListV1Params = validate94;
const schema129 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-list-v1-params.schema.json","title":"SourcesListV1Params","type":"object","additionalProperties":false};

function validate94(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-list-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
for(const key0 in data){
const err0 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
}
else {
const err1 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
validate94.errors = vErrors;
return errors === 0;
}

export const validateSourcesListV1Result = validate95;
const schema130 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-list-v1-result.schema.json","title":"SourcesListV1Result","type":"object","properties":{"sources":{"type":"array","items":{"$ref":"../source/source-descriptor.schema.json"}}},"required":["sources"],"additionalProperties":false};
const schema131 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/source/source-descriptor.schema.json","title":"SourceDescriptor","type":"object","properties":{"sourceId":{"type":"string","format":"uuid"},"sourceKind":{"type":"string","minLength":1},"sourceKey":{"type":"string","minLength":1},"locator":{"type":"object"},"enabled":{"type":"boolean"},"discoveryCursor":{"type":["object","null"]},"completedScanId":{"type":["string","null"],"format":"uuid"},"lastSuccessAt":{"type":["string","null"],"format":"date-time"},"lastErrorCode":{"type":["string","null"]}},"required":["sourceId","sourceKind","sourceKey","locator","enabled","discoveryCursor","completedScanId","lastSuccessAt","lastErrorCode"],"additionalProperties":false};

function validate95(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-list-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.sources === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sources"},message:"must have required property '"+"sources"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "sources")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.sources !== undefined){
let data0 = data.sources;
if(Array.isArray(data0)){
const len0 = data0.length;
for(let i0=0; i0<len0; i0++){
let data1 = data0[i0];
if(data1 && typeof data1 == "object" && !Array.isArray(data1)){
if(data1.sourceId === undefined){
const err2 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"../source/source-descriptor.schema.json/required",keyword:"required",params:{missingProperty: "sourceId"},message:"must have required property '"+"sourceId"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
if(data1.sourceKind === undefined){
const err3 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"../source/source-descriptor.schema.json/required",keyword:"required",params:{missingProperty: "sourceKind"},message:"must have required property '"+"sourceKind"+"'"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
if(data1.sourceKey === undefined){
const err4 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"../source/source-descriptor.schema.json/required",keyword:"required",params:{missingProperty: "sourceKey"},message:"must have required property '"+"sourceKey"+"'"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(data1.locator === undefined){
const err5 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"../source/source-descriptor.schema.json/required",keyword:"required",params:{missingProperty: "locator"},message:"must have required property '"+"locator"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data1.enabled === undefined){
const err6 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"../source/source-descriptor.schema.json/required",keyword:"required",params:{missingProperty: "enabled"},message:"must have required property '"+"enabled"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data1.discoveryCursor === undefined){
const err7 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"../source/source-descriptor.schema.json/required",keyword:"required",params:{missingProperty: "discoveryCursor"},message:"must have required property '"+"discoveryCursor"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data1.completedScanId === undefined){
const err8 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"../source/source-descriptor.schema.json/required",keyword:"required",params:{missingProperty: "completedScanId"},message:"must have required property '"+"completedScanId"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data1.lastSuccessAt === undefined){
const err9 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"../source/source-descriptor.schema.json/required",keyword:"required",params:{missingProperty: "lastSuccessAt"},message:"must have required property '"+"lastSuccessAt"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data1.lastErrorCode === undefined){
const err10 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"../source/source-descriptor.schema.json/required",keyword:"required",params:{missingProperty: "lastErrorCode"},message:"must have required property '"+"lastErrorCode"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
for(const key1 in data1){
if(!(func10.call(schema131.properties, key1))){
const err11 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"../source/source-descriptor.schema.json/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
}
if(data1.sourceId !== undefined){
let data2 = data1.sourceId;
if(typeof data2 === "string"){
if(!(formats0.test(data2))){
const err12 = {instancePath:instancePath+"/sources/" + i0+"/sourceId",schemaPath:"../source/source-descriptor.schema.json/properties/sourceId/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err13 = {instancePath:instancePath+"/sources/" + i0+"/sourceId",schemaPath:"../source/source-descriptor.schema.json/properties/sourceId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data1.sourceKind !== undefined){
let data3 = data1.sourceKind;
if(typeof data3 === "string"){
if(func2(data3) < 1){
const err14 = {instancePath:instancePath+"/sources/" + i0+"/sourceKind",schemaPath:"../source/source-descriptor.schema.json/properties/sourceKind/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err15 = {instancePath:instancePath+"/sources/" + i0+"/sourceKind",schemaPath:"../source/source-descriptor.schema.json/properties/sourceKind/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data1.sourceKey !== undefined){
let data4 = data1.sourceKey;
if(typeof data4 === "string"){
if(func2(data4) < 1){
const err16 = {instancePath:instancePath+"/sources/" + i0+"/sourceKey",schemaPath:"../source/source-descriptor.schema.json/properties/sourceKey/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err17 = {instancePath:instancePath+"/sources/" + i0+"/sourceKey",schemaPath:"../source/source-descriptor.schema.json/properties/sourceKey/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data1.locator !== undefined){
let data5 = data1.locator;
if(!(data5 && typeof data5 == "object" && !Array.isArray(data5))){
const err18 = {instancePath:instancePath+"/sources/" + i0+"/locator",schemaPath:"../source/source-descriptor.schema.json/properties/locator/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data1.enabled !== undefined){
if(typeof data1.enabled !== "boolean"){
const err19 = {instancePath:instancePath+"/sources/" + i0+"/enabled",schemaPath:"../source/source-descriptor.schema.json/properties/enabled/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data1.discoveryCursor !== undefined){
let data7 = data1.discoveryCursor;
if((!(data7 && typeof data7 == "object" && !Array.isArray(data7))) && (data7 !== null)){
const err20 = {instancePath:instancePath+"/sources/" + i0+"/discoveryCursor",schemaPath:"../source/source-descriptor.schema.json/properties/discoveryCursor/type",keyword:"type",params:{type: schema131.properties.discoveryCursor.type},message:"must be object,null"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
}
if(data1.completedScanId !== undefined){
let data8 = data1.completedScanId;
if((typeof data8 !== "string") && (data8 !== null)){
const err21 = {instancePath:instancePath+"/sources/" + i0+"/completedScanId",schemaPath:"../source/source-descriptor.schema.json/properties/completedScanId/type",keyword:"type",params:{type: schema131.properties.completedScanId.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err21];
}
else {
vErrors.push(err21);
}
errors++;
}
if(typeof data8 === "string"){
if(!(formats0.test(data8))){
const err22 = {instancePath:instancePath+"/sources/" + i0+"/completedScanId",schemaPath:"../source/source-descriptor.schema.json/properties/completedScanId/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
if(data1.lastSuccessAt !== undefined){
let data9 = data1.lastSuccessAt;
if((typeof data9 !== "string") && (data9 !== null)){
const err23 = {instancePath:instancePath+"/sources/" + i0+"/lastSuccessAt",schemaPath:"../source/source-descriptor.schema.json/properties/lastSuccessAt/type",keyword:"type",params:{type: schema131.properties.lastSuccessAt.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err23];
}
else {
vErrors.push(err23);
}
errors++;
}
if(typeof data9 === "string"){
if(!(formats6.validate(data9))){
const err24 = {instancePath:instancePath+"/sources/" + i0+"/lastSuccessAt",schemaPath:"../source/source-descriptor.schema.json/properties/lastSuccessAt/format",keyword:"format",params:{format: "date-time"},message:"must match format \""+"date-time"+"\""};
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
if(data1.lastErrorCode !== undefined){
let data10 = data1.lastErrorCode;
if((typeof data10 !== "string") && (data10 !== null)){
const err25 = {instancePath:instancePath+"/sources/" + i0+"/lastErrorCode",schemaPath:"../source/source-descriptor.schema.json/properties/lastErrorCode/type",keyword:"type",params:{type: schema131.properties.lastErrorCode.type},message:"must be string,null"};
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
const err26 = {instancePath:instancePath+"/sources/" + i0,schemaPath:"../source/source-descriptor.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
else {
const err27 = {instancePath:instancePath+"/sources",schemaPath:"#/properties/sources/type",keyword:"type",params:{type: "array"},message:"must be array"};
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
const err28 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
validate95.errors = vErrors;
return errors === 0;
}

export const validateSourcesGetFolderHierarchyV1Params = validate96;
const schema132 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-get-folder-hierarchy-v1-params.schema.json","title":"SourcesGetFolderHierarchyV1Params","type":"object","properties":{"sourceId":{"type":"string","format":"uuid"}},"required":["sourceId"],"additionalProperties":false};

function validate96(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-get-folder-hierarchy-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.sourceId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sourceId"},message:"must have required property '"+"sourceId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!(key0 === "sourceId")){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.sourceId !== undefined){
let data0 = data.sourceId;
if(typeof data0 === "string"){
if(!(formats0.test(data0))){
const err2 = {instancePath:instancePath+"/sourceId",schemaPath:"#/properties/sourceId/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err3 = {instancePath:instancePath+"/sourceId",schemaPath:"#/properties/sourceId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
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
validate96.errors = vErrors;
return errors === 0;
}

export const validateSourcesGetFolderHierarchyV1Result = validate97;
const schema133 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-get-folder-hierarchy-v1-result.schema.json","title":"SourcesGetFolderHierarchyV1Result","type":"object","properties":{"sourceId":{"type":"string","format":"uuid"},"nodes":{"type":"array","items":{"$ref":"../source/folder-hierarchy-node.schema.json"}}},"required":["sourceId","nodes"],"additionalProperties":false};
const schema134 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/source/folder-hierarchy-node.schema.json","title":"SourceFolderHierarchyNode","type":"object","properties":{"nodeId":{"type":"string","minLength":1},"parentNodeId":{"type":["string","null"]},"name":{"type":"string"},"pathName":{"type":"string"},"artificialRoot":{"type":"boolean"},"directLeafChildren":{"type":"integer","minimum":0},"totalLeafChildren":{"type":"integer","minimum":0},"directChildNodes":{"type":"integer","minimum":0}},"required":["nodeId","parentNodeId","name","pathName","artificialRoot","directLeafChildren","totalLeafChildren","directChildNodes"],"additionalProperties":false};

function validate97(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-get-folder-hierarchy-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.sourceId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "sourceId"},message:"must have required property '"+"sourceId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.nodes === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "nodes"},message:"must have required property '"+"nodes"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "sourceId") || (key0 === "nodes"))){
const err2 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
}
if(data.sourceId !== undefined){
let data0 = data.sourceId;
if(typeof data0 === "string"){
if(!(formats0.test(data0))){
const err3 = {instancePath:instancePath+"/sourceId",schemaPath:"#/properties/sourceId/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err4 = {instancePath:instancePath+"/sourceId",schemaPath:"#/properties/sourceId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
}
if(data.nodes !== undefined){
let data1 = data.nodes;
if(Array.isArray(data1)){
const len0 = data1.length;
for(let i0=0; i0<len0; i0++){
let data2 = data1[i0];
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(data2.nodeId === undefined){
const err5 = {instancePath:instancePath+"/nodes/" + i0,schemaPath:"../source/folder-hierarchy-node.schema.json/required",keyword:"required",params:{missingProperty: "nodeId"},message:"must have required property '"+"nodeId"+"'"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
if(data2.parentNodeId === undefined){
const err6 = {instancePath:instancePath+"/nodes/" + i0,schemaPath:"../source/folder-hierarchy-node.schema.json/required",keyword:"required",params:{missingProperty: "parentNodeId"},message:"must have required property '"+"parentNodeId"+"'"};
if(vErrors === null){
vErrors = [err6];
}
else {
vErrors.push(err6);
}
errors++;
}
if(data2.name === undefined){
const err7 = {instancePath:instancePath+"/nodes/" + i0,schemaPath:"../source/folder-hierarchy-node.schema.json/required",keyword:"required",params:{missingProperty: "name"},message:"must have required property '"+"name"+"'"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
if(data2.pathName === undefined){
const err8 = {instancePath:instancePath+"/nodes/" + i0,schemaPath:"../source/folder-hierarchy-node.schema.json/required",keyword:"required",params:{missingProperty: "pathName"},message:"must have required property '"+"pathName"+"'"};
if(vErrors === null){
vErrors = [err8];
}
else {
vErrors.push(err8);
}
errors++;
}
if(data2.artificialRoot === undefined){
const err9 = {instancePath:instancePath+"/nodes/" + i0,schemaPath:"../source/folder-hierarchy-node.schema.json/required",keyword:"required",params:{missingProperty: "artificialRoot"},message:"must have required property '"+"artificialRoot"+"'"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
if(data2.directLeafChildren === undefined){
const err10 = {instancePath:instancePath+"/nodes/" + i0,schemaPath:"../source/folder-hierarchy-node.schema.json/required",keyword:"required",params:{missingProperty: "directLeafChildren"},message:"must have required property '"+"directLeafChildren"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data2.totalLeafChildren === undefined){
const err11 = {instancePath:instancePath+"/nodes/" + i0,schemaPath:"../source/folder-hierarchy-node.schema.json/required",keyword:"required",params:{missingProperty: "totalLeafChildren"},message:"must have required property '"+"totalLeafChildren"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
if(data2.directChildNodes === undefined){
const err12 = {instancePath:instancePath+"/nodes/" + i0,schemaPath:"../source/folder-hierarchy-node.schema.json/required",keyword:"required",params:{missingProperty: "directChildNodes"},message:"must have required property '"+"directChildNodes"+"'"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
for(const key1 in data2){
if(!((((((((key1 === "nodeId") || (key1 === "parentNodeId")) || (key1 === "name")) || (key1 === "pathName")) || (key1 === "artificialRoot")) || (key1 === "directLeafChildren")) || (key1 === "totalLeafChildren")) || (key1 === "directChildNodes"))){
const err13 = {instancePath:instancePath+"/nodes/" + i0,schemaPath:"../source/folder-hierarchy-node.schema.json/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err13];
}
else {
vErrors.push(err13);
}
errors++;
}
}
if(data2.nodeId !== undefined){
let data3 = data2.nodeId;
if(typeof data3 === "string"){
if(func2(data3) < 1){
const err14 = {instancePath:instancePath+"/nodes/" + i0+"/nodeId",schemaPath:"../source/folder-hierarchy-node.schema.json/properties/nodeId/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err15 = {instancePath:instancePath+"/nodes/" + i0+"/nodeId",schemaPath:"../source/folder-hierarchy-node.schema.json/properties/nodeId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err15];
}
else {
vErrors.push(err15);
}
errors++;
}
}
if(data2.parentNodeId !== undefined){
let data4 = data2.parentNodeId;
if((typeof data4 !== "string") && (data4 !== null)){
const err16 = {instancePath:instancePath+"/nodes/" + i0+"/parentNodeId",schemaPath:"../source/folder-hierarchy-node.schema.json/properties/parentNodeId/type",keyword:"type",params:{type: schema134.properties.parentNodeId.type},message:"must be string,null"};
if(vErrors === null){
vErrors = [err16];
}
else {
vErrors.push(err16);
}
errors++;
}
}
if(data2.name !== undefined){
if(typeof data2.name !== "string"){
const err17 = {instancePath:instancePath+"/nodes/" + i0+"/name",schemaPath:"../source/folder-hierarchy-node.schema.json/properties/name/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err17];
}
else {
vErrors.push(err17);
}
errors++;
}
}
if(data2.pathName !== undefined){
if(typeof data2.pathName !== "string"){
const err18 = {instancePath:instancePath+"/nodes/" + i0+"/pathName",schemaPath:"../source/folder-hierarchy-node.schema.json/properties/pathName/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data2.artificialRoot !== undefined){
if(typeof data2.artificialRoot !== "boolean"){
const err19 = {instancePath:instancePath+"/nodes/" + i0+"/artificialRoot",schemaPath:"../source/folder-hierarchy-node.schema.json/properties/artificialRoot/type",keyword:"type",params:{type: "boolean"},message:"must be boolean"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
}
if(data2.directLeafChildren !== undefined){
let data8 = data2.directLeafChildren;
if(!(((typeof data8 == "number") && (!(data8 % 1) && !isNaN(data8))) && (isFinite(data8)))){
const err20 = {instancePath:instancePath+"/nodes/" + i0+"/directLeafChildren",schemaPath:"../source/folder-hierarchy-node.schema.json/properties/directLeafChildren/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err20];
}
else {
vErrors.push(err20);
}
errors++;
}
if((typeof data8 == "number") && (isFinite(data8))){
if(data8 < 0 || isNaN(data8)){
const err21 = {instancePath:instancePath+"/nodes/" + i0+"/directLeafChildren",schemaPath:"../source/folder-hierarchy-node.schema.json/properties/directLeafChildren/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data2.totalLeafChildren !== undefined){
let data9 = data2.totalLeafChildren;
if(!(((typeof data9 == "number") && (!(data9 % 1) && !isNaN(data9))) && (isFinite(data9)))){
const err22 = {instancePath:instancePath+"/nodes/" + i0+"/totalLeafChildren",schemaPath:"../source/folder-hierarchy-node.schema.json/properties/totalLeafChildren/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err22];
}
else {
vErrors.push(err22);
}
errors++;
}
if((typeof data9 == "number") && (isFinite(data9))){
if(data9 < 0 || isNaN(data9)){
const err23 = {instancePath:instancePath+"/nodes/" + i0+"/totalLeafChildren",schemaPath:"../source/folder-hierarchy-node.schema.json/properties/totalLeafChildren/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
if(data2.directChildNodes !== undefined){
let data10 = data2.directChildNodes;
if(!(((typeof data10 == "number") && (!(data10 % 1) && !isNaN(data10))) && (isFinite(data10)))){
const err24 = {instancePath:instancePath+"/nodes/" + i0+"/directChildNodes",schemaPath:"../source/folder-hierarchy-node.schema.json/properties/directChildNodes/type",keyword:"type",params:{type: "integer"},message:"must be integer"};
if(vErrors === null){
vErrors = [err24];
}
else {
vErrors.push(err24);
}
errors++;
}
if((typeof data10 == "number") && (isFinite(data10))){
if(data10 < 0 || isNaN(data10)){
const err25 = {instancePath:instancePath+"/nodes/" + i0+"/directChildNodes",schemaPath:"../source/folder-hierarchy-node.schema.json/properties/directChildNodes/minimum",keyword:"minimum",params:{comparison: ">=", limit: 0},message:"must be >= 0"};
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
}
else {
const err26 = {instancePath:instancePath+"/nodes/" + i0,schemaPath:"../source/folder-hierarchy-node.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err26];
}
else {
vErrors.push(err26);
}
errors++;
}
}
}
else {
const err27 = {instancePath:instancePath+"/nodes",schemaPath:"#/properties/nodes/type",keyword:"type",params:{type: "array"},message:"must be array"};
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
const err28 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err28];
}
else {
vErrors.push(err28);
}
errors++;
}
validate97.errors = vErrors;
return errors === 0;
}

export const validateSourcesGetDocumentV1Params = validate98;
const schema135 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-get-document-v1-params.schema.json","title":"SourcesGetDocumentV1Params","type":"object","properties":{"documentId":{"type":"string","format":"uuid"},"subject_scope":{"type":"string","enum":["subject","subject_with_thread"],"default":"subject"}},"required":["documentId"],"additionalProperties":false};

function validate98(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-get-document-v1-params.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.documentId === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "documentId"},message:"must have required property '"+"documentId"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
for(const key0 in data){
if(!((key0 === "documentId") || (key0 === "subject_scope"))){
const err1 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
}
if(data.documentId !== undefined){
let data0 = data.documentId;
if(typeof data0 === "string"){
if(!(formats0.test(data0))){
const err2 = {instancePath:instancePath+"/documentId",schemaPath:"#/properties/documentId/format",keyword:"format",params:{format: "uuid"},message:"must match format \""+"uuid"+"\""};
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
const err3 = {instancePath:instancePath+"/documentId",schemaPath:"#/properties/documentId/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.subject_scope !== undefined){
let data1 = data.subject_scope;
if(typeof data1 !== "string"){
const err4 = {instancePath:instancePath+"/subject_scope",schemaPath:"#/properties/subject_scope/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err4];
}
else {
vErrors.push(err4);
}
errors++;
}
if(!((data1 === "subject") || (data1 === "subject_with_thread"))){
const err5 = {instancePath:instancePath+"/subject_scope",schemaPath:"#/properties/subject_scope/enum",keyword:"enum",params:{allowedValues: schema135.properties.subject_scope.enum},message:"must be equal to one of the allowed values"};
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
validate98.errors = vErrors;
return errors === 0;
}

export const validateSourcesGetDocumentV1Result = validate99;
const schema136 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-get-document-v1-result.schema.json","title":"SourcesGetDocumentV1Result","type":"object","properties":{"filename":{"type":"string","minLength":1},"mimeType":{"type":"string","minLength":1},"contentBase64":{"type":"string","pattern":"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"},"external_ids":{"$ref":"../source/external-ids.schema.json"},"topLevelParent":{"$ref":"../source/top-level-parent.schema.json"}},"required":["filename","mimeType","contentBase64"],"additionalProperties":false};
const pattern25 = new RegExp("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$", "u");

function validate99(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/methods/sources-get-document-v1-result.schema.json" */;
let vErrors = null;
let errors = 0;
if(data && typeof data == "object" && !Array.isArray(data)){
if(data.filename === undefined){
const err0 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "filename"},message:"must have required property '"+"filename"+"'"};
if(vErrors === null){
vErrors = [err0];
}
else {
vErrors.push(err0);
}
errors++;
}
if(data.mimeType === undefined){
const err1 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "mimeType"},message:"must have required property '"+"mimeType"+"'"};
if(vErrors === null){
vErrors = [err1];
}
else {
vErrors.push(err1);
}
errors++;
}
if(data.contentBase64 === undefined){
const err2 = {instancePath,schemaPath:"#/required",keyword:"required",params:{missingProperty: "contentBase64"},message:"must have required property '"+"contentBase64"+"'"};
if(vErrors === null){
vErrors = [err2];
}
else {
vErrors.push(err2);
}
errors++;
}
for(const key0 in data){
if(!(((((key0 === "filename") || (key0 === "mimeType")) || (key0 === "contentBase64")) || (key0 === "external_ids")) || (key0 === "topLevelParent"))){
const err3 = {instancePath,schemaPath:"#/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key0},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.filename !== undefined){
let data0 = data.filename;
if(typeof data0 === "string"){
if(func2(data0) < 1){
const err4 = {instancePath:instancePath+"/filename",schemaPath:"#/properties/filename/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err5 = {instancePath:instancePath+"/filename",schemaPath:"#/properties/filename/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err5];
}
else {
vErrors.push(err5);
}
errors++;
}
}
if(data.mimeType !== undefined){
let data1 = data.mimeType;
if(typeof data1 === "string"){
if(func2(data1) < 1){
const err6 = {instancePath:instancePath+"/mimeType",schemaPath:"#/properties/mimeType/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err7 = {instancePath:instancePath+"/mimeType",schemaPath:"#/properties/mimeType/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err7];
}
else {
vErrors.push(err7);
}
errors++;
}
}
if(data.contentBase64 !== undefined){
let data2 = data.contentBase64;
if(typeof data2 === "string"){
if(!pattern25.test(data2)){
const err8 = {instancePath:instancePath+"/contentBase64",schemaPath:"#/properties/contentBase64/pattern",keyword:"pattern",params:{pattern: "^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"},message:"must match pattern \""+"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"+"\""};
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
const err9 = {instancePath:instancePath+"/contentBase64",schemaPath:"#/properties/contentBase64/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err9];
}
else {
vErrors.push(err9);
}
errors++;
}
}
if(data.external_ids !== undefined){
let data3 = data.external_ids;
if(Array.isArray(data3)){
const len0 = data3.length;
for(let i0=0; i0<len0; i0++){
let data4 = data3[i0];
if(data4 && typeof data4 == "object" && !Array.isArray(data4)){
if(data4.key === undefined){
const err10 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"../source/external-ids.schema.json/items/required",keyword:"required",params:{missingProperty: "key"},message:"must have required property '"+"key"+"'"};
if(vErrors === null){
vErrors = [err10];
}
else {
vErrors.push(err10);
}
errors++;
}
if(data4.value === undefined){
const err11 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"../source/external-ids.schema.json/items/required",keyword:"required",params:{missingProperty: "value"},message:"must have required property '"+"value"+"'"};
if(vErrors === null){
vErrors = [err11];
}
else {
vErrors.push(err11);
}
errors++;
}
for(const key1 in data4){
if(!((key1 === "key") || (key1 === "value"))){
const err12 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"../source/external-ids.schema.json/items/additionalProperties",keyword:"additionalProperties",params:{additionalProperty: key1},message:"must NOT have additional properties"};
if(vErrors === null){
vErrors = [err12];
}
else {
vErrors.push(err12);
}
errors++;
}
}
if(data4.key !== undefined){
let data5 = data4.key;
if(typeof data5 === "string"){
if(func2(data5) < 1){
const err13 = {instancePath:instancePath+"/external_ids/" + i0+"/key",schemaPath:"../source/external-ids.schema.json/items/properties/key/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err14 = {instancePath:instancePath+"/external_ids/" + i0+"/key",schemaPath:"../source/external-ids.schema.json/items/properties/key/type",keyword:"type",params:{type: "string"},message:"must be string"};
if(vErrors === null){
vErrors = [err14];
}
else {
vErrors.push(err14);
}
errors++;
}
}
if(data4.value !== undefined){
let data6 = data4.value;
if(typeof data6 === "string"){
if(func2(data6) < 1){
const err15 = {instancePath:instancePath+"/external_ids/" + i0+"/value",schemaPath:"../source/external-ids.schema.json/items/properties/value/minLength",keyword:"minLength",params:{limit: 1},message:"must NOT have fewer than 1 characters"};
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
const err16 = {instancePath:instancePath+"/external_ids/" + i0+"/value",schemaPath:"../source/external-ids.schema.json/items/properties/value/type",keyword:"type",params:{type: "string"},message:"must be string"};
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
const err17 = {instancePath:instancePath+"/external_ids/" + i0,schemaPath:"../source/external-ids.schema.json/items/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
const err18 = {instancePath:instancePath+"/external_ids",schemaPath:"../source/external-ids.schema.json/type",keyword:"type",params:{type: "array"},message:"must be array"};
if(vErrors === null){
vErrors = [err18];
}
else {
vErrors.push(err18);
}
errors++;
}
}
if(data.topLevelParent !== undefined){
if(!(validate43(data.topLevelParent, {instancePath:instancePath+"/topLevelParent",parentData:data,parentDataProperty:"topLevelParent",rootData}))){
vErrors = vErrors === null ? validate43.errors : vErrors.concat(validate43.errors);
errors = vErrors.length;
}
}
}
else {
const err19 = {instancePath,schemaPath:"#/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err19];
}
else {
vErrors.push(err19);
}
errors++;
}
validate99.errors = vErrors;
return errors === 0;
}

