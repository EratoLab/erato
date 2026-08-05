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
const schema27 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/capabilities/capability.schema.json","title":"CapabilityDescriptor","type":"object","required":["id","major","method","availability"],"properties":{"id":{"type":"string","pattern":"^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$"},"major":{"type":"integer","minimum":1},"method":{"type":"string","pattern":"^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+\\.v[1-9][0-9]*$"},"availability":{"oneOf":[{"type":"object","required":["state"],"properties":{"state":{"const":"enabled"}},"additionalProperties":true},{"type":"object","required":["state","reasonCode"],"properties":{"state":{"const":"disabled"},"reasonCode":{"type":"string","minLength":1,"maxLength":128}},"additionalProperties":true},{"type":"object","required":["state"],"properties":{"state":{"type":"string","not":{"enum":["enabled","disabled"]}}},"additionalProperties":true}]}},"additionalProperties":true};
const pattern2 = new RegExp("^1\\.4\\.[0-9]+$", "u");
const pattern3 = new RegExp("^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$", "u");
const pattern4 = new RegExp("^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+\\.v[1-9][0-9]*$", "u");
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
if(!pattern4.test(data12)){
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
const schema34 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/diagnostics-echo-v1-params.schema.json","title":"DiagnosticsEchoV1Params","type":"object","required":["message"],"properties":{"message":{"type":"string","maxLength":4096},"delayMs":{"description":"Artificial pause before the sidecar answers, in milliseconds, so long-call mechanics — progress polling and cancellation — can be exercised without a real long-running capability. Sidecars report the pause as a `delay` trace step and MAY cap it lower.","type":"integer","minimum":0,"maximum":60000}},"additionalProperties":true};

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

export const validateSidecarConfigureV1Params = validate30;
const schema38 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-configure-v1-params.schema.json","title":"SidecarConfigureV1Params","type":"object","required":["user_configuration","organization_configuration"],"properties":{"user_configuration":{"$ref":"../configuration/sidecar-configuration.schema.json"},"organization_configuration":{"$ref":"../configuration/sidecar-configuration.schema.json"}},"additionalProperties":true};
const schema39 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/configuration/sidecar-configuration.schema.json","title":"SidecarConfiguration","description":"An extensible configuration layer. Unknown properties must be accepted and preserved.","type":"object","properties":{"show_tray_icon":{"description":"Whether the sidecar should show its system tray icon. Null leaves the decision to the other configuration layer or the sidecar default.","type":["boolean","null"]}},"additionalProperties":true};

function validate30(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
const err2 = {instancePath:instancePath+"/user_configuration/show_tray_icon",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/show_tray_icon/type",keyword:"type",params:{type: schema39.properties.show_tray_icon.type},message:"must be boolean,null"};
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
const err3 = {instancePath:instancePath+"/user_configuration",schemaPath:"../configuration/sidecar-configuration.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
if(vErrors === null){
vErrors = [err3];
}
else {
vErrors.push(err3);
}
errors++;
}
}
if(data.organization_configuration !== undefined){
let data2 = data.organization_configuration;
if(data2 && typeof data2 == "object" && !Array.isArray(data2)){
if(data2.show_tray_icon !== undefined){
let data3 = data2.show_tray_icon;
if((typeof data3 !== "boolean") && (data3 !== null)){
const err4 = {instancePath:instancePath+"/organization_configuration/show_tray_icon",schemaPath:"../configuration/sidecar-configuration.schema.json/properties/show_tray_icon/type",keyword:"type",params:{type: schema39.properties.show_tray_icon.type},message:"must be boolean,null"};
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
else {
const err5 = {instancePath:instancePath+"/organization_configuration",schemaPath:"../configuration/sidecar-configuration.schema.json/type",keyword:"type",params:{type: "object"},message:"must be object"};
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
validate30.errors = vErrors;
return errors === 0;
}

export const validateSidecarConfigureV1Result = validate31;
const schema41 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-configure-v1-result.schema.json","title":"SidecarConfigureV1Result","type":"object","additionalProperties":true};

function validate31(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate31.errors = vErrors;
return errors === 0;
}

export const validateOutlookListMailboxesV1Params = validate32;
const schema42 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-mailboxes-v1-params.schema.json","title":"OutlookListMailboxesV1Params","type":"object","properties":{},"additionalProperties":true};

function validate32(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate32.errors = vErrors;
return errors === 0;
}

export const validateOutlookListMailboxesV1Result = validate33;
const schema43 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-mailboxes-v1-result.schema.json","title":"OutlookListMailboxesV1Result","type":"object","required":["mailboxes","warnings"],"properties":{"mailboxes":{"type":"array","items":{"$ref":"../outlook/mailbox.schema.json"},"maxItems":1024},"warnings":{"type":"array","items":{"$ref":"../outlook/listing-warning.schema.json"},"maxItems":1024}},"additionalProperties":true};
const schema44 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/mailbox.schema.json","title":"OutlookMailbox","description":"A mailbox or message store available through the local Outlook installation.","type":"object","required":["id","displayName","source"],"properties":{"id":{"description":"Short opaque mailbox identifier. It is unique for the current sidecar runtime and logically stable across restarts while the Outlook profile and store identity remain unchanged.","type":"string","pattern":"^[0-9a-f]{32}$"},"displayName":{"type":"string","minLength":1,"maxLength":1024},"emailAddress":{"type":"string","minLength":1,"maxLength":1024},"profileName":{"description":"Name of the Outlook profile containing this mailbox. Omitted when the platform or standalone store has no profile concept.","type":"string","minLength":1,"maxLength":1024},"source":{"description":"Implementation-defined local Outlook storage source. Known values include pst, ost, macOsProfile, and windowsOutlook.","type":"string","minLength":1,"maxLength":128}},"additionalProperties":true};
const schema45 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/listing-warning.schema.json","title":"OutlookListingWarning","description":"A local Outlook source that could not be inspected without hiding successful results.","type":"object","required":["message"],"properties":{"path":{"type":"string","minLength":1,"maxLength":32768},"message":{"type":"string","minLength":1,"maxLength":4096}},"additionalProperties":true};
const pattern6 = new RegExp("^[0-9a-f]{32}$", "u");

function validate33(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern6.test(data2)){
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
validate33.errors = vErrors;
return errors === 0;
}

export const validateOutlookListEmailsV1Params = validate34;
const schema46 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-emails-v1-params.schema.json","title":"OutlookListEmailsV1Params","type":"object","required":["mailboxId"],"properties":{"mailboxId":{"description":"Short opaque identifier returned by outlook.list_mailboxes.v1.","type":"string","pattern":"^[0-9a-f]{32}$"}},"additionalProperties":true};

function validate34(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern6.test(data0)){
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
validate34.errors = vErrors;
return errors === 0;
}

export const validateOutlookListEmailsV1Result = validate35;
const schema47 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-list-emails-v1-result.schema.json","title":"OutlookListEmailsV1Result","description":"Up to 50 of the newest locally indexed emails in the selected mailbox.","type":"object","required":["mailbox","emails"],"properties":{"mailbox":{"$ref":"../outlook/mailbox.schema.json"},"emails":{"type":"array","items":{"$ref":"../outlook/email-summary.schema.json"},"maxItems":50}},"additionalProperties":true};
const schema49 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/email-summary.schema.json","title":"OutlookEmailSummary","description":"Metadata for one locally indexed Outlook email.","type":"object","required":["id"],"properties":{"id":{"description":"Source-specific stable message identifier.","type":"string","minLength":1,"maxLength":32768},"subject":{"type":"string","maxLength":32768},"senderName":{"type":"string","maxLength":4096},"senderEmailAddress":{"type":"string","maxLength":4096},"receivedAtUnixSeconds":{"description":"UTC Unix timestamp in whole seconds.","type":"integer","minimum":-62135596800,"maximum":253402300799},"internetMessageId":{"type":"string","maxLength":32768}},"additionalProperties":true};

function validate35(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern6.test(data1)){
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
validate35.errors = vErrors;
return errors === 0;
}

export const validateOutlookGetConversationV1Params = validate36;
const schema50 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-get-conversation-v1-params.schema.json","title":"OutlookGetConversationV1Params","type":"object","required":["mailboxId","anchor"],"properties":{"mailboxId":{"description":"Short opaque identifier returned by outlook.list_mailboxes.v1.","type":"string","pattern":"^[0-9a-f]{32}$"},"anchor":{"description":"The message the conversation is resolved from.","type":"object","required":["internetMessageId"],"properties":{"internetMessageId":{"description":"RFC 5322 Message-ID of the anchor message, including angle brackets, as reported by outlook.list_emails.v1. Not the Office.js conversationId.","type":"string","minLength":1,"maxLength":32768}},"additionalProperties":true},"maxMessages":{"description":"Cap on the number of returned messages. When the conversation has more, the result is reported as partial.","type":"integer","minimum":1,"maximum":1000}},"additionalProperties":true};

function validate36(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern6.test(data0)){
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
validate36.errors = vErrors;
return errors === 0;
}

export const validateOutlookGetConversationV1Result = validate37;
const schema51 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/outlook-get-conversation-v1-result.schema.json","title":"OutlookGetConversationV1Result","description":"The messages of the anchored conversation, oldest first, with bodies and attachment bytes carried inline.","type":"object","required":["state","messages"],"properties":{"state":{"description":"Completeness of the conversation. ok means every message and byte reference was produced; partial means some were omitted (see warnings), for example because maxMessages was reached or an attachment could not be read.","type":"string","minLength":1,"maxLength":32},"mailbox":{"$ref":"../outlook/mailbox.schema.json"},"messages":{"type":"array","items":{"$ref":"../outlook/conversation-message.schema.json"}},"warnings":{"type":"array","items":{"$ref":"../outlook/conversation-warning.schema.json"}}},"additionalProperties":true};
const schema59 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/conversation-warning.schema.json","title":"OutlookConversationWarning","description":"A part of a conversation that could not be represented fully, without hiding the rest.","type":"object","required":["code"],"properties":{"code":{"description":"Stable machine-readable warning code. Known values include truncated, attachment_unavailable, and embedded_attachments_omitted.","type":"string","minLength":1,"maxLength":128},"message":{"type":"string","minLength":1,"maxLength":4096},"internetMessageId":{"description":"The message the warning is about, when it is message-scoped.","type":"string","maxLength":32768}},"additionalProperties":true};
const schema53 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/conversation-message.schema.json","title":"OutlookConversationMessage","description":"One message of an Outlook conversation, with its body and attachment bytes carried inline.","type":"object","required":["attachments"],"properties":{"internetMessageId":{"type":"string","maxLength":32768},"subject":{"type":"string","maxLength":32768},"from":{"$ref":"../outlook/message-recipient.schema.json"},"to":{"type":"array","items":{"$ref":"../outlook/message-recipient.schema.json"}},"cc":{"type":"array","items":{"$ref":"../outlook/message-recipient.schema.json"}},"sentAtUnixSeconds":{"description":"UTC Unix timestamp in whole seconds.","type":"integer","minimum":-62135596800,"maximum":253402300799},"receivedAtUnixSeconds":{"description":"UTC Unix timestamp in whole seconds.","type":"integer","minimum":-62135596800,"maximum":253402300799},"isDraft":{"description":"True when the message is an unsent draft.","type":"boolean"},"conversationIndex":{"description":"Lowercase hex PidTagConversationIndex; its embedded GUID groups the thread.","type":"string","maxLength":8192},"body":{"$ref":"../outlook/message-body.schema.json"},"attachments":{"type":"array","items":{"$ref":"../outlook/attachment-reference.schema.json"}}},"additionalProperties":true};
const schema54 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/message-recipient.schema.json","title":"OutlookMessageRecipient","description":"One recipient of an Outlook message.","type":"object","properties":{"name":{"description":"Display name, when present.","type":"string","maxLength":4096},"emailAddress":{"description":"SMTP address. Omitted when only a non-routable Exchange address is stored locally.","type":"string","maxLength":4096}},"additionalProperties":true};
const schema57 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/message-body.schema.json","title":"OutlookMessageBody","description":"A message body carried inline in the JSON-RPC result. The sidecar decodes the stored bytes to text using the message code page before sending.","type":"object","required":["contentType","content"],"properties":{"contentType":{"description":"Media type of the body, for example text/html or text/plain.","type":"string","maxLength":256},"content":{"description":"The decoded body text.","type":"string"}},"additionalProperties":true};
const schema58 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/attachment-reference.schema.json","title":"OutlookAttachmentReference","description":"Metadata and inline bytes for one attachment. When the bytes are available they are base64-encoded in contentBytes; otherwise unavailableReason explains why.","type":"object","properties":{"name":{"description":"File name, when present.","type":"string","maxLength":4096},"contentType":{"description":"Media type of the bytes. Embedded messages are reported as message/rfc822.","type":"string","maxLength":256},"size":{"description":"Exact length of the attachment bytes.","type":"integer","minimum":0},"isInline":{"description":"True when the attachment is referenced from the message body by contentId.","type":"boolean"},"contentId":{"description":"Content-ID for an inline attachment, without angle brackets.","type":"string","maxLength":4096},"sha256":{"description":"Lowercase hex SHA-256 of the attachment bytes, useful for de-duplicating attachments repeated across thread messages.","type":"string","pattern":"^[a-f0-9]{64}$"},"contentBytes":{"description":"Base64-encoded attachment bytes, present when the bytes are available.","type":"string"},"unavailableReason":{"description":"Stable code explaining why bytes are not available, present instead of contentBytes. Known values include unsupported_attachment.","type":"string","minLength":1,"maxLength":128}},"additionalProperties":true};
const pattern11 = new RegExp("^[a-f0-9]{64}$", "u");

function validate38(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern11.test(data27)){
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
validate38.errors = vErrors;
return errors === 0;
}


function validate37(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!pattern6.test(data2)){
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
if(!(validate38(data7[i0], {instancePath:instancePath+"/messages/" + i0,parentData:data7,parentDataProperty:i0,rootData}))){
vErrors = vErrors === null ? validate38.errors : vErrors.concat(validate38.errors);
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
validate37.errors = vErrors;
return errors === 0;
}

export const validateSidecarProgressV1Params = validate40;
const schema60 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-progress-v1-params.schema.json","title":"SidecarProgressV1Params","description":"Names the pending request whose on-device progress the client wants to observe. The request is identified by the JSON-RPC request ID the client generated for it; visibility is scoped to the Origin that issued that request.","type":"object","required":["requestId"],"properties":{"requestId":{"$ref":"../common.schema.json#/definitions/RequestId"}},"additionalProperties":true};

function validate40(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate40.errors = vErrors;
return errors === 0;
}

export const validateSidecarProgressV1Result = validate41;
const schema62 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/methods/sidecar-progress-v1-result.schema.json","title":"SidecarProgressV1Result","description":"A point-in-time view of one request's on-device progress. `trace` carries the same append-only event log a result may embed, so a client that applies steps by `sequence` (last one wins) renders a polled log and a complete log identically.","type":"object","required":["state"],"properties":{"state":{"description":"Where the named request is in its lifecycle. Known values are running, finished, and unknown. Receivers treat unrecognized values as running.","type":"string","minLength":1,"maxLength":64},"trace":{"description":"The sidecar's step log for the named request so far. Metadata only — never message content. Absent when the request is unknown or recorded no steps.","$ref":"../outlook/local-trace.schema.json"}},"additionalProperties":true};
const schema63 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/local-trace.schema.json","title":"SidecarLocalTrace","description":"The sidecar's internal on-device steps for one request, as an append-only event log. Protocol 1.0 delivers the whole log with the result; a future delivery mode may append to it incrementally, and a client that applies steps by `sequence` (last one wins) renders both identically. Contains no message content, so it can be shown even when the user declines to share the result.","type":"object","required":["steps"],"properties":{"steps":{"type":"array","items":{"$ref":"../outlook/local-trace-step.schema.json"},"maxItems":32},"totalDurationMs":{"type":"integer","minimum":0}},"additionalProperties":true};
const schema64 = {"$schema":"http://json-schema.org/draft-07/schema#","$id":"https://schemas.erato.ai/desktop-sidecar/v1/outlook/local-trace-step.schema.json","title":"SidecarLocalTraceStep","description":"One internal on-device processing step, shaped as an event: a stable `sequence` identity carrying a status that may evolve. Metadata only: never message content, snippets, or file names.","type":"object","required":["sequence","id","status"],"properties":{"sequence":{"description":"Stable identity of this step within the request, and its ordering key. A later step with the same sequence supersedes an earlier one, so the same payload works whether the log arrives complete or is appended to over time.","type":"integer","minimum":0},"id":{"description":"Step identifier. Known values include expandQuery, buildIndex, match, and summarize. Receivers ignore unknown values and render them by their raw id.","type":"string","minLength":1,"maxLength":128},"status":{"description":"Step outcome. Known values include running, ok, skipped, degraded, and error. Receivers treat unknown values as running.","type":"string","minLength":1,"maxLength":64},"parentSequence":{"description":"Sequence of the step this one runs inside, when the sidecar nests work (for example a tool call made during a local model turn). Absent for top-level steps.","type":"integer","minimum":0},"startedAtOffsetMs":{"description":"Milliseconds between the start of the request and the start of this step, so a client can order and place steps identically in both delivery modes.","type":"integer","minimum":0},"durationMs":{"type":"integer","minimum":0},"model":{"description":"Identifier of the local model this step used, when it used one.","type":"string","minLength":1,"maxLength":256},"cacheHit":{"description":"Whether this step was served from a local cache (for example the in-memory mailbox index).","type":"boolean"},"detail":{"description":"Short non-sensitive note — the sidecar's counterpart of a progress message: why a step was skipped or degraded, or what it is doing.","type":"string","maxLength":512},"counts":{"description":"Item counts keyed by an open string. Known keys include keywordsIn, keywordsOut, messagesScanned, matched, and hitsReturned.","type":"object","maxProperties":16,"additionalProperties":{"type":"integer","minimum":0}}},"additionalProperties":true};

function validate42(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
validate42.errors = vErrors;
return errors === 0;
}


function validate41(data, {instancePath="", parentData, parentDataProperty, rootData=data}={}){
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
if(!(validate42(data.trace, {instancePath:instancePath+"/trace",parentData:data,parentDataProperty:"trace",rootData}))){
vErrors = vErrors === null ? validate42.errors : vErrors.concat(validate42.errors);
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
validate41.errors = vErrors;
return errors === 0;
}

