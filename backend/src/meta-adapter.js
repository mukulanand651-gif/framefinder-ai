import {normalizeVideo} from './core.js';
const valid = value => {try {const u=new URL(value);return ['https:','http:'].includes(u.protocol)}catch{return false}};
/** Ad creative adapter for coregent/facebook-ads-library-scraper.
 * Only emits records with an explicitly declared video media asset.
 */
export function normalizeMetaAd(record) {
  if (!record || typeof record !== 'object' || record.recordType === 'RUN_SUMMARY') return null;
  const id=String(record.adArchiveId||record.adId||'').trim();
  if (!/^\d+$/.test(id)) return null;
  const media=[...(Array.isArray(record.creative?.media)?record.creative.media:[]),
    ...(Array.isArray(record.creative?.cards)?record.creative.cards.flatMap(c=>Array.isArray(c.media)?c.media:[]):[])];
  const movie=media.find(m=>String(m?.type||'').toLowerCase()==='video' && [m?.url,m?.hdUrl,m?.sdUrl].some(valid));
  if(!movie)return null;
  const videoUrl=[movie.url,movie.hdUrl,movie.sdUrl].find(valid);
  const thumb=[movie.thumbnailUrl,movie.thumbnail,movie.imageUrl].find(valid)||'';
  const url=valid(record.adLibraryUrl)?record.adLibraryUrl:`https://www.facebook.com/ads/library/?id=${id}`;
  const caption=[record.creative?.body,record.creative?.headline,record.creative?.description].filter(Boolean).join(' — ');
  const normalized=normalizeVideo({id,url,videoUrl,thumbnailUrl:thumb,caption,timestamp:record.delivery?.startDate||record.scrapedAt},'meta');
  if(!normalized)return null;
  return {...normalized,advertiser:record.advertiser?.name||null,mediaType:'video',raw:record};
}
