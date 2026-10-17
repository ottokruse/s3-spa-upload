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
    .string("m")
    .alias("m", "cache-control-mapping")
    .describe(
      "m",
      "Path to custom JSON file that maps glob patterns to cache-control headers"
    )
    .string("p")
    .alias("p", "prefix")
    .describe(
      "p",
      "Path prefix to prepend to every S3 object key of uploaded files"
    )
    .string("t")
    .array("t")
    .alias("t", "tag")
    .describe(
      "t",
      "S3 object tag, repeatable: --tag env=prod --tag version=3.4.5"
    )
    .number("c")
    .alias("c", "concurrency")
    .default("concurrency", 100)
    .check((args) => {
      if (args.c !== undefined && args.c < 1)
        throw new Error(
          `Error: concurrency must be at least 1, but you provided: ${args.c}`
        );
      return true;
    })
    .describe("c", "Nr of concurrent uploads (default: 100)")
    .check((args) => {
      for (const tag of args.tag ?? []) {
        const eq = tag.indexOf("=");
        if (eq < 1 || eq === tag.length - 1)
          throw new Error(
            `Error: tag must be of the form key=value, but you provided: ${tag}`
          );
        const key = tag.slice(0, eq);
        if (key.length > 128)
          throw new Error(
            `Error: tag key must be at most 128 characters: ${key}`
          );
        if (tag.slice(eq + 1).length > 256)
          throw new Error(
            `Error: tag value must be at most 256 characters: ${tag.slice(eq + 1)}`
          );
      }
      const keys = (args.tag ?? []).map((tag) => tag.slice(0, tag.indexOf("=")));
      const duplicate = keys.find((key, i) => keys.indexOf(key) !== i);
      if (duplicate) throw new Error(`Error: duplicate tag key: ${duplicate}`);
      if ((args.tag ?? []).length > 50)
        throw new Error("Error: at most 50 tags per object are allowed by S3");
      return true;
    })
    .help()
    .wrap(88).argv;

  let cacheControlMapping: CacheControlMapping | undefined;
  if (args["cache-control-mapping"]) {
    cacheControlMapping = JSON.parse(
      readFileSync(args["cache-control-mapping"]).toString()
    );
  }
  const tags = Object.fromEntries(
    (args.tag ?? []).map((tag) => {
      const eq = tag.indexOf("=");
      return [tag.slice(0, eq), tag.slice(eq + 1)];
    })
  );
  await s3SpaUpload(args.directory!, args.bucketname!, {
    delete: args.delete,
    cacheControlMapping,
    prefix: args.prefix,
    concurrency: args.concurrency,
    tags,
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
