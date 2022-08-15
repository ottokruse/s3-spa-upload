#!/usr/bin/env node

import { readFileSync } from "fs";
import s3SpaUpload, { CacheControlMapping } from "./index";
import yargs from "yargs";

async function main() {
  const args = await yargs
    .command(
      "$0 <directory> <bucketname> [options]",
      "Upload a dist/build directory containing a SPA (React, Angular, Vue, ...) to AWS S3"
    )
    .string("directory")
    .string("bucketname")
    .boolean("d")
    .alias("d", "delete")
    .describe("d", "Delete old files from the S3 bucket")
    .describe(
      "cache-control-mapping",
      "Path to custom JSON file that maps glob patterns to cache-control headers"
    )
    .string("cache-control-mapping")
    .alias("p", "prefix")
    .describe(
      "p",
      "Path prefix to prepend to every S3 object key of uploaded files"
    )
    .string("prefix")
    .string("profile")
    .describe("profile", "AWS profile to use")
    .help()
    .wrap(88).argv;

  let cacheControlMapping: CacheControlMapping | undefined;
  if (args["cache-control-mapping"]) {
    cacheControlMapping = JSON.parse(
      readFileSync(args["cache-control-mapping"]).toString()
    );
  }
  await s3SpaUpload(args.directory!, args.bucketname!, {
    delete: args.delete,
    cacheControlMapping,
    prefix: args.prefix,
    awsProfile: args.profile,
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
