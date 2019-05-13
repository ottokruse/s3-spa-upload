# S3 SPA Upload

Upload a Single Page Application (React, Angular, Vue, ...) to S3 with the right content-type and cache-control meta-data

![Build Status](https://codebuild.eu-west-1.amazonaws.com/badges?uuid=eyJlbmNyeXB0ZWREYXRhIjoiQit5K1dqTW4zc2xYbnhOK3pFNU01dEtmM3gzODk4dmZaMDkvVVUzcHJjMWZHMmpCT05yaVEzT3I3WDZ1L25lcTI4QXFhUnlRbngrZTBsNmpwbWdCOEJJPSIsIml2UGFyYW1ldGVyU3BlYyI6ImZoY2c2aVA0ZHBKV1FxS24iLCJtYXRlcmlhbFNldFNlcmlhbCI6MX0%3D&branch=master)

## Installation

To install globally (recommended):

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
import s3SpaUpload from 's3-spa-upload';

s3SpaUpload('dir', 'bucket').catch(console.error);

// Or supply options:
const options = {
    delete: true,
    prefix: 'mobile',
    cacheControlMapping: {
        'index.html': 'no-cache',
        '*.js': 'public,max-age=31536000,immutable',
    },
    awsCredentials: {
        accessKeyId: '...'
        secretAccessKey: '...'
        sessionToken: '...'
    }
}
s3SpaUpload('dir', 'bucket', options).catch(console.error);
```

## Default Cache-Control settings

File/ext | Cache setting | Description
---------|---------------|----------
`index.html`|`no-cache`|
`css`|`public,max-age=31536000,immutable`|As long as possible
`js`|`public,max-age=31536000,immutable`|As long as possible
`png`|`public,max-age=86400`|One day
`ico`|`public,max-age=86400`|One day
`txt`|`public,max-age=86400`|One day

## Content-Type settings

Based on file extensions using https://www.npmjs.com/package/mime-types
