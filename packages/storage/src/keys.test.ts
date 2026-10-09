import { describe, expect, it } from 'vitest';
import {
  assertPrivateBucketKey,
  assertPublicBucketKey,
  backupKey,
  formSubmissionKey,
  importKey,
  privateMediaKey,
  publicAssetKey,
  releaseKey,
} from './keys.js';

describe('@holonet/storage key conventions', () => {
  it('builds public bucket keys', () => {
    expect(publicAssetKey('ws-1', 'a-1', 'photo.JPG')).toBe('media/public/ws-1/assets/a-1.jpg');
    expect(releaseKey('site-1', 'deploy-1', 'index.html')).toBe(
      'sites/site-1/releases/deploy-1/index.html',
    );
  });

  it('builds private bucket keys', () => {
    expect(privateMediaKey('ws-1', 'report.pdf')).toBe('media/private/ws-1/report.pdf');
    expect(importKey('ws-1', 'job-1', 'page.html')).toBe('imports/ws-1/job-1/page.html');
    expect(backupKey('holonet.dump')).toBe('backups/holonet.dump');
    expect(formSubmissionKey('site-1', 'form-1', 'submission.json')).toBe(
      'forms/site-1/form-1/submission.json',
    );
  });

  it('accepts documented public prefixes', () => {
    expect(() => assertPublicBucketKey('app/index.html')).not.toThrow();
    expect(() => assertPublicBucketKey('sites/site-1/releases/d-1/a.css')).not.toThrow();
    expect(() => assertPublicBucketKey('media/public/ws-1/assets/a-1.jpg')).not.toThrow();
  });

  it('accepts documented private prefixes', () => {
    expect(() => assertPrivateBucketKey('media/private/ws-1/x.png')).not.toThrow();
    expect(() => assertPrivateBucketKey('imports/ws-1/job-1/x.html')).not.toThrow();
    expect(() => assertPrivateBucketKey('backups/db.dump')).not.toThrow();
    expect(() => assertPrivateBucketKey('forms/site-1/form-1/x.json')).not.toThrow();
  });

  it('rejects keys outside the bucket conventions', () => {
    expect(() => assertPublicBucketKey('backups/db.dump')).toThrow(/public bucket key/);
    expect(() => assertPrivateBucketKey('media/public/ws-1/x.png')).toThrow(/private bucket key/);
    expect(() => assertPublicBucketKey('../../../etc/passwd')).toThrow();
  });
});
