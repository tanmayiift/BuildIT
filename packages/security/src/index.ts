import {createCipheriv,createDecipheriv,createHmac,randomBytes} from "node:crypto";
export type Ciphertext={ciphertext:string;nonce:string;tag:string;keyVersion:number};
export type CredentialAadScope={organizationId:string;repositoryId?:string;credentialId:string;purpose:"model-provider"|"tracker"|"artifact"};
export function credentialAad(scope:CredentialAadScope){return JSON.stringify({version:1,organizationId:scope.organizationId,repositoryId:scope.repositoryId??null,credentialId:scope.credentialId,purpose:scope.purpose})}
export function encryptSecret(plaintext:string,key:Buffer,aad:string,keyVersion=1):Ciphertext{if(key.length!==32)throw new Error("key_must_be_32_bytes");const nonce=randomBytes(12);const cipher=createCipheriv("aes-256-gcm",key,nonce);cipher.setAAD(Buffer.from(aad));const ciphertext=Buffer.concat([cipher.update(plaintext,"utf8"),cipher.final()]);return{ciphertext:ciphertext.toString("base64"),nonce:nonce.toString("base64"),tag:cipher.getAuthTag().toString("base64"),keyVersion}}
export function decryptSecret(value:Ciphertext,key:Buffer,aad:string){const decipher=createDecipheriv("aes-256-gcm",key,Buffer.from(value.nonce,"base64"));decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(Buffer.from(value.tag,"base64"));return Buffer.concat([decipher.update(Buffer.from(value.ciphertext,"base64")),decipher.final()]).toString("utf8")}
const patterns=[/\b(?:sk-ant-|sk-proj[-_]|gh[opsu]_)[A-Za-z0-9_-]{8,}\b/g,/\bAKIA[A-Z0-9]{16}\b/g,/-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g];
export function redact(input:string){return patterns.reduce((v,p)=>v.replace(p,"[REDACTED]"),input)}
export function fingerprint(value:string,key:Buffer){return createHmac("sha256",key).update(value).digest("hex")}
export function sanitizeGitHub(input:string){return redact(input).replace(/@/g,"＠").replace(/<img[^>]*>/gi,"").replace(/<script[\s\S]*?<\/script>/gi,"")}
