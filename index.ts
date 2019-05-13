#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'fs';
import { extname, join } from 'path';
import { contentType } from 'mime-types';
import { S3 } from 'aws-sdk';
import minimatch from 'minimatch';
import yargs from 'yargs';

const S3CLIENT = new S3();

interface CacheControlMapping {
    [glob: string]: string;
}

interface AwsCredentials {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
}
interface Options {
    delete?: boolean;
    cacheControlMapping?: CacheControlMapping;
    awsCredentials?: AwsCredentials;
    prefix?: string;
}


export const CACHE_FOREVER = 'public,max-age=31536000,immutable';
export const CACHE_ONE_DAY = 'public,max-age=86400';
export const NO_CACHE = 'no-cache';

export const DEFAULT_CACHE_CONTROL_MAPPING: CacheControlMapping = {
    'index.html': NO_CACHE,
    '*.css': CACHE_FOREVER,
    '*.js': CACHE_FOREVER,
    '*.png': CACHE_ONE_DAY,
    '*.ico': CACHE_ONE_DAY,
    '*.txt': CACHE_ONE_DAY,
}

function getCacheControl(filepath: string, cacheControlMapping: CacheControlMapping) {
    for (let [glob, cacheControl] of Object.entries(cacheControlMapping)) {
        if (minimatch(filepath, glob, { matchBase: true })) {
            return cacheControl;
        }
    }
}

async function walkDirectory(directoryPath: string, callback: (filePath: string) => any) {
    const uploaded: string[] = [];
    await Promise.all(readdirSync(directoryPath).map(async entry => {
        const filePath = join(directoryPath, entry);
        const stat = statSync(filePath);
        if (stat.isFile()) {
            const key = await callback(filePath);
            uploaded.push(key);
        } else if (stat.isDirectory()) {
            const uploadedRecursively = await walkDirectory(filePath, callback);
            uploaded.push(...uploadedRecursively);
        }
    }));
    return uploaded;
}

async function uploadToS3(bucket: string, key: string, filePath: string, prefix: string, cacheControlMapping: CacheControlMapping) {
    const params = {
        Bucket: bucket,
        Key: `${prefix}${key}`,
        Body: readFileSync(filePath),
        CacheControl: getCacheControl(filePath, cacheControlMapping),
        ContentType: contentType(extname(filePath)) || undefined,
    };
    await S3CLIENT.putObject(params).promise();
    console.log(`Uploaded s3://${params.Bucket}/${params.Key} | cache-control=${params.CacheControl} | content-type=${params.ContentType}`);
    return params.Key;
}

async function removeOldFiles(bucket: string, uploaded: string[], prefix: string) {
    let existingFiles: string[] = [];
    await new Promise((resolve, reject) => S3CLIENT.listObjectsV2({ Bucket: bucket }).eachPage((err, page) => {
        if (err) {
            reject(err);
            return false;
        }
        if (page) {
            existingFiles = existingFiles.concat(page.Contents!.map(obj => obj.Key!));
            return true;
        }
        resolve();
        return false;
    }));
    const filesToDelete = existingFiles
        .filter(key => key.startsWith(prefix))
        .filter(key => !uploaded.includes(key));
    await Promise.all(filesToDelete.map(async (key) => {
        await S3CLIENT.deleteObject({ Bucket: bucket, Key: key }).promise()
        console.log(`Deleted old file: ${key}`);
    }));
    return filesToDelete;
}

export default async function s3SpaUpload(dir: string, bucket: string, options: Options = {}) {
    const regexp = new RegExp(`^${dir}/?`);
    if (!options.cacheControlMapping) {
        options.cacheControlMapping = DEFAULT_CACHE_CONTROL_MAPPING;
    }
    if (options.awsCredentials) {
        S3CLIENT.config.update({ credentials: options.awsCredentials });
    }
    if (!options.prefix) {
        options.prefix = '';
    } else {
        options.prefix = options.prefix.endsWith('/') ? options.prefix : `${options.prefix}/`;
    }
    const uploaded = await walkDirectory(dir, (filePath) => uploadToS3(bucket, filePath.replace(regexp, ''), filePath, options.prefix!, options.cacheControlMapping!));
    console.log(`Uploaded ${uploaded.length} files`);
    if (options.delete) {
        const deleted = await removeOldFiles(bucket, uploaded, options.prefix);
        console.log(`Deleted ${deleted.length} old files`);
    }
}

async function main() {
    const args = yargs
        .command('$0 <directory> <bucketname> [options]', 'Upload a dist/build directory containing a SPA (React, Angular, Vue, ...) to AWS S3')
        .string('directory')
        .string('bucketname')
        .boolean('d')
        .alias('d', 'delete')
        .describe('d', 'Delete old files from the S3 bucket')
        .describe('cache-control-mapping', 'Path to custom JSON file that maps glob patterns to cache-control headers')
        .string('cache-control-mapping')
        .alias('p', 'prefix')
        .describe('p', 'Path prefix to prepend to every S3 object key of uploaded files')
        .string('prefix')
        .help()
        .wrap(88)
        .argv;

    let cacheControlMapping: CacheControlMapping | undefined;
    if (args['cache-control-mapping']) {
        cacheControlMapping = JSON.parse(readFileSync(args['cache-control-mapping']).toString());
    }
    await s3SpaUpload(args.directory!, args.bucketname!, { delete: args.delete, cacheControlMapping, prefix: args.prefix });
}

if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
