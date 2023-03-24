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
export const CACHE_ONE_DAY_SWR_ONE_MONTH =
  "public,max-age=86400,stale-while-revalidate=2592000";
export const NO_CACHE = "no-cache";
export const CACHE_ONE_MIN_SWR_ONE_MONTH =
  "public,max-age=60,stale-while-revalidate=2592000";
export const DEFAULT_CACHE_CONTROL_MAPPING: CacheControlMapping = {
  "index.html": CACHE_ONE_MIN_SWR_ONE_MONTH,
  "*.css": CACHE_FOREVER,
  "*.js": CACHE_FOREVER,
  "*.png": CACHE_ONE_DAY_SWR_ONE_MONTH,
  "*.ico": CACHE_ONE_DAY_SWR_ONE_MONTH,
  "*.txt": CACHE_ONE_DAY_SWR_ONE_MONTH,
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
  concurrency: number
) {
  function buildFileList(directoryPath: string, filePaths: string[] = []) {
    for (const entry of readdirSync(directoryPath)) {
      const filePath = join(directoryPath, entry);
      const stat = statSync(filePath);
      if (stat.isFile()) {
        filePaths.push(filePath);
      } else if (stat.isDirectory()) {
        buildFileList(filePath, filePaths);
      }
    }
    return filePaths;
  }

  const filePathsToUpload = buildFileList(directoryPath);
  const uploadedS3Keys: string[] = [];
  const worker = (filePath: string) =>
    s3uploader(filePath).then((key) => uploadedS3Keys.push(key));
  const q = fastq.promise(worker, concurrency);

  console.log(
    `Upload started of ${filePathsToUpload.length} files (with concurrency: ${q.concurrency})`
  );

  let p: Promise<unknown>;
  for (const filePath of filePathsToUpload) {
    p = q.push(filePath).catch((e) => {
      throw e;
    });
    if (q.length() > 0) {
      // backpressure
      await p;
    }
  }
  await q.drained();
  return uploadedS3Keys;
}

let _s3client: S3Client;
async function uploadToS3(
  bucket: string,
  key: string,
  filePath: string,
  prefix: string = "",
  cacheControlMapping: CacheControlMapping = DEFAULT_CACHE_CONTROL_MAPPING,
  awsCredentials?: AwsCredentials
) {
  _s3client ??= new S3Client({
    credentials: awsCredentials,
  });
  const params: ConstructorParameters<typeof PutObjectCommand>[0] = {
    Bucket: bucket,
    Key: `${prefix}${key}`,
    Body: readFileSync(filePath),
    CacheControl: getCacheControl(filePath, cacheControlMapping),
    ContentType: contentType(extname(filePath)) || undefined,
  };
  await _s3client.send(new PutObjectCommand(params)).catch((err: any) => {
    if (err.Code === "PermanentRedirect") {
      const redirectRegion = (err.Endpoint as string).match(
        /.+\.s3[-\.]?(.*)\.amazonaws.com$/
      )?.[1];
      _s3client = new S3Client({
        region: redirectRegion ?? "us-east-1",
        credentials: awsCredentials,
      });
      return _s3client.send(new PutObjectCommand(params));
    }
    throw err;
  });
  console.log(
    `Uploaded s3://${params.Bucket}/${params.Key} | cache-control=${
      params.CacheControl ?? "<empty>"
    } | content-type=${params.ContentType ?? "<empty>"}`
  );
  return params.Key!;
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
  let deleted = 0;
  const q = fastq.promise(
    (key: string) =>
      s3client
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
        .then(() => {
          console.log(`Deleted old file: ${key}`);
          deleted++;
        }),
    concurrency
  );
  for await (const page of paginator) {
    for (const obj of page.Contents ?? []) {
      if (
        obj.Key &&
        obj.Key.startsWith(prefix) &&
        !uploadedKeys.includes(obj.Key)
      ) {
        q.push(obj.Key).catch((e) => {
          throw e;
        });
      }
    }
    await q.drained();
  }
  return deleted;
}

export default async function s3SpaUpload(
  dir: string,
  bucket: string,
  options: Options = {}
) {
  dir = resolve(dir);
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
        bucket,
        filePath.replace(new RegExp(String.raw`^${dir}/?`), ""),
        filePath,
        options.prefix,
        options.cacheControlMapping,
        options.awsCredentials
      ),
    options.concurrency
  );
  let nrDeleted = 0;
  if (options.delete) {
    nrDeleted = await removeOldFiles(
      _s3client,
      bucket,
      uploaded,
      options.prefix,
      options.concurrency
    );
  }
  console.log("\nSUMMARY:");
  console.log(` Uploaded ${uploaded.length} files`);
  if (options.delete) {
    console.log(` Deleted ${nrDeleted} old files`);
  }
}
