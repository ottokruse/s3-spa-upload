# S3 SPA Upload

Upload a Single Page Application (React, Angular, Vue, ...) to S3 with the right content-type and cache-control meta-data.

This module uploads the local SPA's build directory to S3, overwriting what's currently on S3.

Note: There's no intelligence (yet) to only upload changed files. There's also no intelligence (yet) to split big files in chunks and do multipart upload.

![Build Status](https://codebuild.eu-west-1.amazonaws.com/badges?uuid=eyJlbmNyeXB0ZWREYXRhIjoiQit5K1dqTW4zc2xYbnhOK3pFNU01dEtmM3gzODk4dmZaMDkvVVUzcHJjMWZHMmpCT05yaVEzT3I3WDZ1L25lcTI4QXFhUnlRbngrZTBsNmpwbWdCOEJJPSIsIml2UGFyYW1ldGVyU3BlYyI6ImZoY2c2aVA0ZHBKV1FxS24iLCJtYXRlcmlhbFNldFNlcmlhbCI6MX0%3D&branch=master)

This requires the following AWS S3 permissions (see sample CloudFormation policy template below):

- s3:PutObject on objects in your bucket
- s3:ListBucket on your bucket (only needed when using --delete option)
- s3:DeleteObject on objects in your bucket (only needed when using --delete option)

## Installation

To install globally (for CLI usage):

    npm install -g s3-spa-upload

## Command Line Usage

Basic usage:

    s3-spa-upload dist-dir my-s3-bucket-name

### Clean-up old files

To also clean up old files, use the --delete option. This will delete all files in the bucket that are not included in the current upload (limited to the supplied prefix, see below):

    s3-spa-upload dist-dir my-s3-bucket-name --delete

### Custom cache-control mapping

You can provide your desired cache-control mapping in a json file that contains a mapping from glob patterns to cache-control headers:

```javascript
{
    "index.html": "no-cache",
    "*.js": "public,max-age=31536000,immutable"
}
```

Suppose your mapping file is called `cache-control.json`:

    s3-spa-upload dist-dir my-s3-bucket-name --cache-control-mapping cache-control.json

If you don't provide a custom mapping, the default will be used, which should be okay for most SPA's, see below.

### Upload to a prefix

By default the SPA will be uploaded to the root of your S3 bucket. If you don't want this, specify the prefix to use:

    s3-spa-upload dist-dir my-s3-bucket-name --prefix mobile

Note that when used in conjunction with `--delete`, this means only old files matching that same prefix will be deleted.

## Programmatic Usage

```typescript
import s3SpaUpload from "s3-spa-upload";
// const s3SpaUpload = require('s3-spa-upload')

s3SpaUpload("dir", "bucket").catch(console.error);

// Can supply options:
const options = {
  delete: true,
  prefix: "mobile",
  cacheControlMapping: {
    "index.html": "no-cache",
    "*.js": "public,max-age=31536000,immutable",
  },
  concurrency: 100, // max nr of files to upload to S3 in parallel
  awsCredentials: {
    accessKeyId: "...",
    secretAccessKey: "...",
    sessionToken: "...",
  }, // Optional. If not provided explicitly, the AWS SDK will source credentials as usual
};
s3SpaUpload("dir", "bucket", options).catch(console.error);
```

## Default Cache-Control settings

| File/ext     | Cache setting                                         | Description                                                                                  |
| ------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `index.html` | `public,max-age=60,stale-while-revalidate=2592000`    | 1 minute, but allow stale content for 30 days, provided a cache refresh request is made also |
| `css`        | `public,max-age=31536000,immutable`                   | As long as possible                                                                          |
| `js`         | `public,max-age=31536000,immutable`                   | As long as possible                                                                          |
| `png`        | `public,max-age=86400,stale-while-revalidate=2592000` | One day, but allow stale content for 30 days, provided a cache refresh request is made also  |
| `ico`        | `public,max-age=86400,stale-while-revalidate=2592000` | One day, but allow stale content for 30 days, provided a cache refresh request is made also  |
| `txt`        | `public,max-age=86400,stale-while-revalidate=2592000` | One day, but allow stale content for 30 days, provided a cache refresh request is made also  |

## Content-Type settings

Based on file extensions using https://www.npmjs.com/package/mime-types

## AWS Policy Template

This CloudFormation IAM Policy template grants the needed permissions:

```yaml
- Version: "2012-10-17"
    Statement:
      - Effect: Allow # This effect is only needed when using the --delete option
          Action: s3:ListBucket
          Resource: arn:aws:s3:::your-bucket-name
      - Effect: Allow
          Action:
            - s3:DeleteObject # This action is only needed when using the --delete option
            - s3:PutObject
          Resource: arn:aws:s3:::your-bucket-name/*
```
