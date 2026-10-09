
import 'dotenv/config';
import { collectScrapeCreators } from './scrapecreators-client.js';

async function main() {
  const platform = process.argv[2] || 'instagram';
  const query = process.argv.slice(3).join(' ') ||
    'oversized graphic tee';

  console.log(`Testing ${platform}: ${query}`);

  const videos = await collectScrapeCreators(
    platform,
    query,
    0,
    5
  );

  console.log('Video count:', videos.length);

  for (const video of videos.slice(0, 5)) {
    console.log({
      id: video.id,
      platform: video.platform,
      url: video.url,
      hasThumbnail: Boolean(video.thumbnail),
      hasVideoUrl: Boolean(video.videoUrl),
      caption: video.caption?.slice(0, 100)
    });
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
