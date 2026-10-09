
import 'dotenv/config';

import { collectSelfHosted } from './src/selfhosted-scraper.js';
import { publicFetch } from './src/product.js';

const query = process.argv.slice(2).join(' ') ||
  'Nike Air Force 1';

console.log('\nTESTING META THUMBNAIL ACCESS');
console.log('Query:', query);

const videos = await collectSelfHosted(
  'meta',
  query,
  0,
  5
);

console.log('Collected candidates:', videos.length);

for (const video of videos.slice(0, 3)) {
  const thumbnail = String(video.thumbnail || '');

  let hostname = 'not-an-http-url';

  try {
    hostname = new URL(thumbnail).hostname;
  } catch {}

  console.log('\nCANDIDATE', {
    id: video.id,
    thumbnailPresent: Boolean(thumbnail),
    thumbnailHost: hostname,
    thumbnailKind: thumbnail.startsWith('data:')
      ? 'data-uri'
      : thumbnail.startsWith('blob:')
        ? 'blob-url'
        : thumbnail.startsWith('http')
          ? 'remote-url'
          : 'other',
    videoUrl: video.url
  });

  if (!thumbnail) {
    console.log('ERROR: Thumbnail missing');
    continue;
  }

  try {
    const response = await publicFetch(thumbnail, {
      maxBytes: 4_000_000,
      timeoutMs: 20000,
      accept: 'image/*'
    });

    console.log('IMAGE FETCH SUCCESS', {
      mime: response.mime,
      bytes: response.body.length
    });
  } catch (error) {
    console.error('IMAGE FETCH FAILED', {
      error: error.message,
      code: error.code || null,
      cause: error.cause?.message || null,
      causeCode: error.cause?.code || null
    });
  }
}

process.exit(0);
