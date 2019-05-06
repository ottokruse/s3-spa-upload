#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from 'fs';
import { basename, extname, join } from 'path';
import { contentType } from 'mime-types';
import { S3 } from 'aws-sdk';

const S3CLIENT = new S3();

interface Mapping {
    [type: string]: string;
}

const CACHE_FOREVER = 'public,max-age=31536000,immutable';
const CACHE_ONE_DAY = 'public,max-age=86400';
const NO_CACHE = 'no-cache';
const DEFAULT_CACHE_CONTROL_MAPPING: Mapping = {
    css: CACHE_FOREVER,
    js: CACHE_FOREVER,
    png: CACHE_ONE_DAY,
    ico: CACHE_ONE_DAY,
    txt: CACHE_ONE_DAY,
}

function getCacheControl(filepath: string) {
    const filename = basename(filepath);
    if (filename === 'index.html') {
        return NO_CACHE;
    }
    return DEFAULT_CACHE_CONTROL_MAPPING[extname(filename)];
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

async function uploadToS3(bucket: string, key: string, filePath: string) {
    const params = {
        Bucket: bucket,
        Key: key,
        Body: readFileSync(filePath),
        CacheControl: getCacheControl(filePath),
        ContentType: contentType(extname(filePath)) || undefined,
    };
    await S3CLIENT.putObject(params).promise();
    console.log(`Uploaded s3://${bucket}/${key} from ${filePath}`);
    return key;
}

async function removeOldFiles(bucket: string, uploaded: string[]) {
    const resp = await S3CLIENT.listObjectsV2({ Bucket: bucket }).promise();
    const existingFiles = resp.Contents!.map(obj => obj.Key!);
    const filesToDelete = existingFiles.filter(key => !uploaded.includes(key));
    await Promise.all(filesToDelete.map(async (key) => {
        await S3CLIENT.deleteObject({ Bucket: bucket, Key: key }).promise()
        console.log(`Deleted old file: ${key}`);
    }));
    console.log(`Deleted ${filesToDelete.length} old files`);
}

async function main() {
    const dir = process.argv[2];
    if (!dir) {
        console.error('The name of the directory to upload should be provided as first argument');
        process.exit(1);
    }
    const bucket = process.argv[3];
    if (!bucket) {
        console.error('The S3 bucket name should be provided as second argument');
        process.exit(1);
    }
    const regexp = new RegExp(`^${dir}/?`);
    const uploaded = await walkDirectory(dir, (filePath) => uploadToS3(bucket, filePath.replace(regexp, ''), filePath));
    if (process.argv[4] === '--clean') {
        await removeOldFiles(bucket, uploaded);
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
