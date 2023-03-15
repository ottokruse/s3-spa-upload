import { readdirSync, readFileSync, statSync } from "fs";
import { extname, join, resolve } from "path";
import { contentType } from "mime-types";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  paginateListObjectsV2,
} from "@aws-sdk/client-s3";
import minimatch from "minimatch";
import fastq from "fastq";
import type { queueAsPromised } from "fastq";

export interface CacheControlMapping {
  [glob: string]: string;
}

interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

interface Options {
  /**
   * Delete existing objects from S3 that are not part of the current upload?
   * (This will be limited to the supplied prefix, if any)
   */
  delete?: boolean;
  cacheControlMapping?: CacheControlMapping;
  awsCredentials?: AwsCredentials;
  /**
   * S3 Bucket prefix to upload to
   */
  prefix?: string;
  /**
   * Max nr of files to upload to S3 in parallel
   * @default 100
   */
  concurrency?: number;
}

export const CACHE_FOREVER = "public,max-age=31536000,immutable";
export const CACHE_ONE_DAY_SWR_FOREVER =
  "public,max-age=86400,stale-while-revalidate=31536000";
export const NO_CACHE = "no-cache";
export const CACHE_ONE_MIN_SWR_FOREVER =
  "public,max-age=60,stale-while-revalidate=31536000";
export const DEFAULT_CACHE_CONTROL_MAPPING: CacheControlMapping = {
  "index.html": CACHE_ONE_MIN_SWR_FOREVER,
  "*.css": CACHE_FOREVER,
  "*.js": CACHE_FOREVER,
  "*.png": CACHE_ONE_DAY_SWR_FOREVER,
  "*.ico": CACHE_ONE_DAY_SWR_FOREVER,
  "*.txt": CACHE_ONE_DAY_SWR_FOREVER,
};

function getCacheControl(
  filepath: string,
  cacheControlMapping: CacheControlMapping
) {
  for (let [glob, cacheControl] of Object.entries(cacheControlMapping)) {
    if (minimatch(filepath, glob, { matchBase: true })) {
      return cacheControl;
    }
  }
}

async function walkDirectory(
  directoryPath: string,
  s3uploader: (filePath: string) => Promise<string>,
  concurrency: number,
  _recursion: {
    root: boolean;
    promises: Promise<any>[];
    processedS3Keys: string[];
    q?: queueAsPromised<string, string> | undefined;
  } = {
    root: true,
    processedS3Keys: [],
    promises: [],
  }
) {
  if (!_recursion.q) {
    _recursion.q = fastq.promise(s3uploader, concurrency);
  }
  for (const entry of readdirSync(directoryPath)) {
    const filePath = join(directoryPath, entry);
    const stat = statSync(filePath);
    if (stat.isFile()) {
      _recursion.promises.push(
        _recursion.q
          .push(filePath)
          .then((key) => _recursion.processedS3Keys.push(key))
      );
    } else if (stat.isDirectory()) {
      await walkDirectory(filePath, s3uploader, concurrency, {
        ..._recursion,
        root: false,
      });
    }
  }
  if (_recursion.root) {
    console.log(
      `Upload started of ${_recursion.promises.length} files (with concurrency: ${_recursion.q.concurrency})`
    );
    await Promise.all(_recursion.promises);
  }
  return _recursion.processedS3Keys;
}

async function uploadToS3(
  s3client: S3Client,
  bucket: string,
  key: string,
  filePath: string,
  prefix: string,
  cacheControlMapping: CacheControlMapping
) {
  const params = {
    Bucket: bucket,
    Key: `${prefix}${key}`,
    Body: readFileSync(filePath),
    CacheControl: getCacheControl(filePath, cacheControlMapping),
    ContentType: contentType(extname(filePath)) || undefined,
  };
  await s3client.send(new PutObjectCommand(params));
  console.log(
    `Uploaded s3://${params.Bucket}/${params.Key} | cache-control=${params.CacheControl} | content-type=${params.ContentType}`
  );
  return params.Key;
}

async function removeOldFiles(
  s3client: S3Client,
  bucket: string,
  uploadedKeys: string[],
  prefix: string,
  concurrency: number
) {
  const paginator = paginateListObjectsV2(
    {
      client: s3client,
    },
    {
      Bucket: bucket,
      Prefix: prefix,
    }
  );
  const q = fastq.promise(
    (key: string) =>
      s3client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
    concurrency
  );
  const promises = [];
  for await (const page of paginator) {
    for (const obj of page.Contents ?? []) {
      if (
        obj.Key &&
        obj.Key.startsWith(prefix) &&
        !uploadedKeys.includes(obj.Key)
      ) {
        promises.push(
          q
            .push(obj.Key)
            .then(() => console.log(`Deleted old file: ${obj.Key}`))
        );
      }
    }
  }
  await Promise.all(promises);
  return promises.length;
}

let _s3client: S3Client;
export default async function s3SpaUpload(
  dir: string,
  bucket: string,
  options: Options = {}
) {
  dir = resolve(dir);
  options.cacheControlMapping ??= DEFAULT_CACHE_CONTROL_MAPPING;
  options.concurrency ??= 100;
  _s3client = new S3Client({
    credentials: options.awsCredentials,
  });
  if (!options.prefix) {
    options.prefix = "";
  } else {
    options.prefix = options.prefix.endsWith("/")
      ? options.prefix
      : `${options.prefix}/`;
  }
  const uploaded = await walkDirectory(
    dir,
    (filePath) =>
      uploadToS3(
        _s3client,
        bucket,
        filePath.replace(new RegExp(String.raw`^${dir}/?`), ""),
        filePath,
        options.prefix!,
        options.cacheControlMapping!
      ),
    options.concurrency
  );
  console.log(`Uploaded ${uploaded.length} files`);
  if (options.delete) {
    const nrDeleted = await removeOldFiles(
      _s3client,
      bucket,
      uploaded,
      options.prefix,
      options.concurrency
    );
    console.log(`Deleted ${nrDeleted} old files`);
  }
}
