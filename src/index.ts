import { readdirSync, readFileSync, statSync } from "fs";
import { extname, join } from "path";
import { contentType } from "mime-types";
import { S3, SharedIniFileCredentials } from "aws-sdk";
import minimatch from "minimatch";

const S3CLIENT = new S3();

export interface CacheControlMapping {
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
  awsProfile?: string;
  prefix?: string;
}

export const CACHE_FOREVER = "public,max-age=31536000,immutable";
export const CACHE_ONE_DAY = "public,max-age=86400";
export const NO_CACHE = "no-cache";
export const DEFAULT_CACHE_CONTROL_MAPPING: CacheControlMapping = {
  "index.html": NO_CACHE,
  "*.css": CACHE_FOREVER,
  "*.js": CACHE_FOREVER,
  "*.png": CACHE_ONE_DAY,
  "*.ico": CACHE_ONE_DAY,
  "*.txt": CACHE_ONE_DAY
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
  callback: (filePath: string) => any
) {
  const processed: string[] = [];
  await Promise.all(
    readdirSync(directoryPath).map(async entry => {
      const filePath = join(directoryPath, entry);
      const stat = statSync(filePath);
      if (stat.isFile()) {
        const key = await callback(filePath);
        processed.push(key);
      } else if (stat.isDirectory()) {
        const uploadedRecursively = await walkDirectory(filePath, callback);
        processed.push(...uploadedRecursively);
      }
    })
  );
  return processed;
}

async function uploadToS3(
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
    ContentType: contentType(extname(filePath)) || undefined
  };
  await S3CLIENT.putObject(params).promise();
  console.log(
    `Uploaded s3://${params.Bucket}/${params.Key} | cache-control=${params.CacheControl} | content-type=${params.ContentType}`
  );
  return params.Key;
}

async function removeOldFiles(
  bucket: string,
  uploaded: string[],
  prefix: string
) {
  let existingFiles: string[] = [];
  await new Promise((resolve, reject) =>
    S3CLIENT.listObjectsV2({ Bucket: bucket }).eachPage((err, page) => {
      if (err) {
        reject(err);
        return false;
      }
      if (page) {
        existingFiles = existingFiles.concat(
          page.Contents!.map(obj => obj.Key!)
        );
        return true;
      }
      resolve();
      return false;
    })
  );
  const filesToDelete = existingFiles
    .filter(key => key.startsWith(prefix))
    .filter(key => !uploaded.includes(key));
  await Promise.all(
    filesToDelete.map(async key => {
      await S3CLIENT.deleteObject({ Bucket: bucket, Key: key }).promise();
      console.log(`Deleted old file: ${key}`);
    })
  );
  return filesToDelete;
}

export default async function s3SpaUpload(
  dir: string,
  bucket: string,
  options: Options = {}
) {
  const regexp = new RegExp(`^${dir}/?`);
  if (!options.cacheControlMapping) {
    options.cacheControlMapping = DEFAULT_CACHE_CONTROL_MAPPING;
  }
  if (options.awsCredentials) {
    S3CLIENT.config.update({ credentials: options.awsCredentials });
  }
  if (options.awsProfile) {
    const credentials = new SharedIniFileCredentials({
      profile: options.awsProfile
    });
    S3CLIENT.config.update({ credentials });
  }
  if (!options.prefix) {
    options.prefix = "";
  } else {
    options.prefix = options.prefix.endsWith("/")
      ? options.prefix
      : `${options.prefix}/`;
  }
  const uploaded = await walkDirectory(dir, filePath =>
    uploadToS3(
      bucket,
      filePath.replace(regexp, ""),
      filePath,
      options.prefix!,
      options.cacheControlMapping!
    )
  );
  console.log(`Uploaded ${uploaded.length} files`);
  if (options.delete) {
    const deleted = await removeOldFiles(bucket, uploaded, options.prefix);
    console.log(`Deleted ${deleted.length} old files`);
  }
}
