#!/usr/bin/env node
interface CacheControlMapping {
    [glob: string]: string;
}
interface AwsCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
}
interface Options {
    delete?: boolean;
    cacheControlMapping?: CacheControlMapping;
    awsCredentials?: AwsCredentials;
    prefix?: string;
}
export declare const CACHE_FOREVER = "public,max-age=31536000,immutable";
export declare const CACHE_ONE_DAY = "public,max-age=86400";
export declare const NO_CACHE = "no-cache";
export declare const DEFAULT_CACHE_CONTROL_MAPPING: CacheControlMapping;
export default function s3SpaUpload(dir: string, bucket: string, options?: Options): Promise<void>;
export {};
