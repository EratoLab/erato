"use strict";
export const validateJsonRpcEnvelope = validate10;
const schema11 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/json-rpc-envelope.schema.json","title":"JsonRpcEnvelope","oneOf":[{"$ref":"#/definitions/Request"},{"$ref":"#/definitions/Notification"},{"$ref":"#/definitions/SuccessResponse"},{"$ref":"#/definitions/ErrorResponse"}],"definitions":{"Request":{"type":"object","required":["jsonrpc","method","id"],"properties":{"jsonrpc":{"const":"2.0"},"method":{"type":"string","minLength":1},"params":{"oneOf":[{"type":"object"},{"type":"array"}]},"id":{"$ref":"../common.schema.json#/definitions/RequestId"},"x-erato-deadline-at":{"type":"string","format":"date-time"}},"additionalProperties":true},"Notification":{"type":"object","required":["jsonrpc","method"],"not":{"required":["id"],"properties":{"id":true}},"properties":{"jsonrpc":{"const":"2.0"},"method":{"type":"string","minLength":1},"params":{"oneOf":[{"type":"object"},{"type":"array"}]}},"additionalProperties":true},"SuccessResponse":{"type":"object","required":["jsonrpc","result","id"],"not":{"required":["error"],"properties":{"error":true}},"properties":{"jsonrpc":{"const":"2.0"},"result":true,"id":{"$ref":"../common.schema.json#/definitions/RequestId"}},"additionalProperties":true},"ErrorResponse":{"type":"object","required":["jsonrpc","error","id"],"not":{"required":["result"],"properties":{"result":true}},"properties":{"jsonrpc":{"const":"2.0"},"error":{"type":"object","required":["code","message"],"properties":{"code":{"type":"integer"},"message":{"type":"string"},"data":true},"additionalProperties":true},"id":{"oneOf":[{"$ref":"../common.schema.json#/definitions/RequestId"},{"type":"null"}]}},"additionalProperties":true}}};
const schema15 = {"type":"object","required":["jsonrpc","method"],"not":{"required":["id"],"properties":{"id":true}},"properties":{"jsonrpc":{"const":"2.0"},"method":{"type":"string","minLength":1},"params":{"oneOf":[{"type":"object"},{"type":"array"}]}},"additionalProperties":true};
const schema12 = {"type":"object","required":["jsonrpc","method","id"],"properties":{"jsonrpc":{"const":"2.0"},"method":{"type":"string","minLength":1},"params":{"oneOf":[{"type":"object"},{"type":"array"}]},"id":{"$ref":"../common.schema.json#/definitions/RequestId"},"x-erato-deadline-at":{"type":"string","format":"date-time"}},"additionalProperties":true};
const schema14 = {"oneOf":[{"type":"string","minLength":1,"maxLength":128},{"type":"integer"}]};
const func2 = (value) => Array.from(value).length;
const formats0 = { validate: (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) && !Number.isNaN(Date.parse(value)) };

function validate11(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate11.errors = vErrors;
return errors === 0;
}

const schema16 = {"type":"object","required":["jsonrpc","result","id"],"not":{"required":["error"],"properties":{"error":true}},"properties":{"jsonrpc":{"const":"2.0"},"result":true,"id":{"$ref":"../common.schema.json#/definitions/RequestId"}},"additionalProperties":true};

function validate14(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate14.errors = vErrors;
return errors === 0;
}

const schema18 = {"type":"object","required":["jsonrpc","error","id"],"not":{"required":["result"],"properties":{"result":true}},"properties":{"jsonrpc":{"const":"2.0"},"error":{"type":"object","required":["code","message"],"properties":{"code":{"type":"integer"},"message":{"type":"string"},"data":true},"additionalProperties":true},"id":{"oneOf":[{"$ref":"../common.schema.json#/definitions/RequestId"},{"type":"null"}]}},"additionalProperties":true};

function validate16(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate16.errors = vErrors;
return errors === 0;
}


function validate10(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
/*# sourceURL="https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/json-rpc-envelope.schema.json" */;
let vErrors = null;
let errors = 0;
const _errs0 = errors;
let valid0 = false;
let passing0 = null;
const _errs1 = errors;
if(!(validate11(data, {instancePath,parentData,parentDataProperty,rootData}))){
vErrors = vErrors === null ? validate11.errors : vErrors.concat(validate11.errors);
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
if(!(validate14(data, {instancePath,parentData,parentDataProperty,rootData}))){
vErrors = vErrors === null ? validate14.errors : vErrors.concat(validate14.errors);
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
if(!(validate16(data, {instancePath,parentData,parentDataProperty,rootData}))){
vErrors = vErrors === null ? validate16.errors : vErrors.concat(validate16.errors);
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
validate10.errors = vErrors;
return errors === 0;
}

export const validateDiscoverParams = validate18;
const schema20 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discover-params.schema.json","title":"DiscoverParams","type":"object","required":["protocolVersions","clientInfo","host","os"],"properties":{"protocolVersions":{"type":"array","minItems":1,"uniqueItems":true,"items":{"$ref":"../common.schema.json#/definitions/ProtocolVersion"}},"clientInfo":{"$ref":"../common.schema.json#/definitions/ProductInfo"},"host":{"type":"object","required":["application","runtime"],"properties":{"application":{"type":"string","minLength":1,"maxLength":128},"applicationVersion":{"type":"string","maxLength":128},"runtime":{"type":"string","minLength":1,"maxLength":128},"runtimeVersion":{"type":"string","maxLength":128}},"additionalProperties":true},"os":{"type":"object","required":["name"],"properties":{"name":{"type":"string","minLength":1,"maxLength":128},"version":{"type":"string","maxLength":128},"architecture":{"type":"string","maxLength":64}},"additionalProperties":true}},"additionalProperties":true};
const schema21 = {"type":"string","pattern":"^[1-9][0-9]*\\.[0-9]+$"};
const schema22 = {"type":"object","required":["name","version"],"properties":{"name":{"type":"string","minLength":1,"maxLength":128},"version":{"type":"string","minLength":1,"maxLength":128}},"additionalProperties":true};
const pattern0 = new RegExp("^[1-9][0-9]*\\.[0-9]+$", "u");
const func0 = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function validate18(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern0.test(data1)){
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
validate18.errors = vErrors;
return errors === 0;
}

export const validateDiscoverResult = validate19;
const schema23 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discover-result.schema.json","title":"DiscoverResult","type":"object","required":["protocolVersion","serverInfo","instanceId","document"],"properties":{"protocolVersion":{"$ref":"../common.schema.json#/definitions/ProtocolVersion"},"serverInfo":{"$ref":"../common.schema.json#/definitions/ProductInfo"},"instanceId":{"type":"string","minLength":1,"maxLength":256},"document":{"$ref":"./discovery-document.schema.json"}},"additionalProperties":true};
const schema26 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/discovery-document.schema.json","title":"DiscoveryDocument","type":"object","required":["openrpc","info","methods","x-erato-catalogue"],"properties":{"openrpc":{"type":"string","pattern":"^1\\.4\\.[0-9]+$"},"info":{"type":"object","required":["title","version"],"properties":{"title":{"type":"string","minLength":1},"version":{"type":"string","minLength":1}},"additionalProperties":true},"methods":{"type":"array","items":{"type":"object","required":["name","params","result"],"properties":{"name":{"type":"string","minLength":1},"params":{"type":"array"},"result":{"type":"object"},"x-erato-capability":{"$ref":"../capabilities/capability.schema.json"}},"additionalProperties":true}},"x-erato-catalogue":{"$ref":"../common.schema.json#/definitions/CatalogueIdentity"}},"additionalProperties":true};
const schema27 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/capabilities/capability.schema.json","title":"CapabilityDescriptor","type":"object","required":["id","major","method","availability"],"properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)+$"},"major":{"type":"integer","minimum":1},"method":{"type":"string","pattern":"^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)+\\.v[1-9][0-9]*$"},"availability":{"oneOf":[{"type":"object","required":["state"],"properties":{"state":{"const":"enabled"}},"additionalProperties":true},{"type":"object","required":["state","reasonCode"],"properties":{"state":{"const":"disabled"},"reasonCode":{"type":"string","minLength":1,"maxLength":128}},"additionalProperties":true},{"type":"object","required":["state"],"properties":{"state":{"type":"string","not":{"enum":["enabled","disabled"]}}},"additionalProperties":true}]}},"additionalProperties":true};
const pattern2 = new RegExp("^1\\.4\\.[0-9]+$", "u");
const pattern3 = new RegExp("^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)+$", "u");
const pattern4 = new RegExp("^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)+\\.v[1-9][0-9]*$", "u");
const schema28 = {"type":"object","required":["revision","digest"],"properties":{"revision":{"$ref":"#/definitions/Revision"},"digest":{"$ref":"#/definitions/Digest"}},"additionalProperties":true};
const schema29 = {"type":"string","minLength":1,"maxLength":128};
const schema30 = {"type":"string","pattern":"^sha256:[a-f0-9]{64}$"};
const pattern5 = new RegExp("^sha256:[a-f0-9]{64}$", "u");

function validate21(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern5.test(data1)){
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
validate21.errors = vErrors;
return errors === 0;
}


function validate20(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern2.test(data0)){
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
if(!pattern3.test(data10)){
const err24 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/id",schemaPath:"../capabilities/capability.schema.json/properties/id/pattern",keyword:"pattern",params:{pattern: "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)+$"},message:"must match pattern \""+"^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)+$"+"\""};
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
if(!pattern4.test(data12)){
const err28 = {instancePath:instancePath+"/methods/" + i0+"/x-erato-capability/method",schemaPath:"../capabilities/capability.schema.json/properties/method/pattern",keyword:"pattern",params:{pattern: "^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)+\\.v[1-9][0-9]*$"},message:"must match pattern \""+"^[a-z][a-z0-9]*(\\.[a-z][a-z0-9]*)+\\.v[1-9][0-9]*$"+"\""};
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
if(!(validate21(data["x-erato-catalogue"], {instancePath:instancePath+"/x-erato-catalogue",parentData:data,parentDataProperty:"x-erato-catalogue",rootData}))){
vErrors = vErrors === null ? validate21.errors : vErrors.concat(validate21.errors);
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
validate20.errors = vErrors;
return errors === 0;
}


function validate19(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern0.test(data0)){
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
if(!(validate20(data.document, {instancePath:instancePath+"/document",parentData:data,parentDataProperty:"document",rootData}))){
vErrors = vErrors === null ? validate20.errors : vErrors.concat(validate20.errors);
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
validate19.errors = vErrors;
return errors === 0;
}

export const validateCancelParams = validate24;
const schema31 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/cancel-params.schema.json","title":"CancelParams","type":"object","required":["requestId","reason"],"properties":{"requestId":{"$ref":"../common.schema.json#/definitions/RequestId"},"reason":{"type":"string","minLength":1,"maxLength":64}},"additionalProperties":true};

function validate24(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate24.errors = vErrors;
return errors === 0;
}

export const validateCancelResult = validate25;
const schema33 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/bootstrap/cancel-result.schema.json","title":"CancelResult","type":"object","required":["accepted"],"properties":{"accepted":{"type":"boolean"}},"additionalProperties":true};

function validate25(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate25.errors = vErrors;
return errors === 0;
}

export const validateDiscoveryDocument = validate20;

export const validateDiagnosticsEchoV1Params = validate26;
const schema34 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/diagnostics-echo-v1-params.schema.json","title":"DiagnosticsEchoV1Params","type":"object","required":["message"],"properties":{"message":{"type":"string","maxLength":4096}},"additionalProperties":true};

function validate26(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate26.errors = vErrors;
return errors === 0;
}

export const validateDiagnosticsEchoV1Result = validate27;
const schema35 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/diagnostics-echo-v1-result.schema.json","title":"DiagnosticsEchoV1Result","type":"object","required":["message","sidecarInstanceId"],"properties":{"message":{"type":"string","maxLength":4096},"sidecarInstanceId":{"type":"string","minLength":1,"maxLength":256}},"additionalProperties":true};

function validate27(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate27.errors = vErrors;
return errors === 0;
}

export const validateSidecarRestartV1Params = validate28;
const schema36 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-restart-v1-params.schema.json","title":"SidecarRestartV1Params","type":"object","properties":{},"additionalProperties":true};

function validate28(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate28.errors = vErrors;
return errors === 0;
}

export const validateSidecarRestartV1Result = validate29;
const schema37 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-restart-v1-result.schema.json","title":"SidecarRestartV1Result","type":"object","required":["accepted"],"properties":{"accepted":{"type":"boolean"}},"additionalProperties":true};

function validate29(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate29.errors = vErrors;
return errors === 0;
}

