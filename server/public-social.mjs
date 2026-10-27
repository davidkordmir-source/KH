import {profileSpec,collectPublicProfile} from './public-profile-pages.mjs';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {categoryFor, cleanText, parseFeed, safeMediaUrl} from './feeds.mjs';

const problem=message=>Object.assign(new Error(message),{status:422});
const CHANNEL=/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/;
export function telegramChannel(input) {
  let name=String(input||'').trim().replace(/^@/,'');
  if (/^https?:/i.test(name)) {
    let url;try{url=new URL(name);}catch{throw problem('نشانی کانال تلگرام معتبر نیست.');}
    if(url.protocol!=='https:'||url.hostname!=='t.me'||url.username||url.password||url.port)throw problem('فقط نشانی عمومی https://t.me/CHANNEL پذیرفته می‌شود.');
    const parts=url.pathname.split('/').filter(Boolean);if(parts[0]==='s')parts.shift();
    if(parts.length>2||(parts[1]&&!/^\d+$/.test(parts[1])))throw problem('لینک مستقیم کانال عمومی را وارد کنید؛ لینک دعوت یا گروه خصوصی پشتیبانی نمی‌شود.');
    name=parts[0]||'';
  }
  if(!CHANNEL.test(name)||/^(joinchat|share|login|proxy|socks|addstickers|addemoji|iv|c)$/i.test(name))throw problem('نام یا لینک کانال عمومی تلگرام را وارد کنید؛ لینک دعوت و کانال خصوصی قابل دریافت نیست.');
  return name.toLowerCase();
}

export function parseTelegramPublic(html,source,now=new Date()) {
  const $=load(html),channel=telegramChannel(source.url),seen=new Set();
  const channelLabel=cleanText($('.tgme_channel_info_header_title').first().text())||source.name;
  const icon=safeMediaUrl($('.tgme_channel_info_header_photo img').first().attr('src'));
  const articles=[];
  $('.tgme_widget_message[data-post]').slice(-40).each((_,element)=>{
    const message=$(element),post=message.attr('data-post')||'';
    const match=/^([a-zA-Z0-9_]+)\/(\d+)$/.exec(post);
    if(!match||match[1].toLowerCase()!==channel||seen.has(post))return;
    const body=message.find('.tgme_widget_message_text').first().clone();
    body.find('br').replaceWith('\n');body.find('script,style').remove();
    const text=cleanText(body.text());if(!text)return;
    const url=`https://t.me/${channel}/${match[2]}`,rawDate=message.find('time[datetime]').first().attr('datetime'),date=new Date(rawDate||'');
    const known=Number.isFinite(date.getTime()),media=[];
    message.find('.tgme_widget_message_photo_wrap').each((_,image)=>{
      const style=$(image).attr('style')||'',value=/background-image\s*:\s*url\(\s*(['"]?)(.*?)\1\s*\)/i.exec(style)?.[2];
      const photo=safeMediaUrl(value);if(photo&&!media.some(item=>item.url===photo))media.push({type:'image',url:photo,source:'telegram-public'});
    });
    message.find('video').each((_,video)=>{
      const element=$(video),videoUrl=safeMediaUrl(element.attr('src')||element.find('source').first().attr('src'));
      if(videoUrl)media.push({type:'video',url:videoUrl,poster:safeMediaUrl(element.attr('poster'))||undefined,source:'telegram-public'});
    });
    const references=[];body.find('a[href]').each((_,a)=>{const link=safeMediaUrl($(a).attr('href'));if(link&&references.length<20)references.push({url:link,label:cleanText($(a).text()).slice(0,180),basis:'publisher-link'});});
    seen.add(post);
    articles.push({id:createHash('sha256').update(url).digest('hex').slice(0,24),url,title:text.slice(0,180),summary:text.slice(0,2400),fullText:text.slice(0,60000),references,
      platform:'telegram',sourceId:source.id,sourceName:source.name||channelLabel,sourceProfileUrl:`https://t.me/${channel}`,sourceIconUrl:icon,
      textScope:'public-channel-preview',publishedAt:known?date.toISOString():now.toISOString(),publishedAtKnown:known,
      category:categoryFor(text),language:/[\u0600-\u06ff]/.test(text)?'fa':/[\u0400-\u04ff]/.test(text)?'ru':/[\u4e00-\u9fff]/.test(text)?'zh':'en',
      media:media.slice(0,12),imageUrl:media.find(item=>item.type==='image')?.url||null,saved:false});
  });
  if(!articles.length)throw problem('پیش‌نمایش عمومی قابل خواندن برای این کانال پیدا نشد. کانال خصوصی، محدودشده، بدون پست متنی یا نیازمند ورود با این روش قابل دریافت نیست؛ دسترسی شبکه به t.me را هم بررسی کنید.');
  return articles;
}

export async function publicSourceSpec(type,input,fetcher) {
  if(typeof input!=='string'||input.length>2048)throw problem('نشانی منبع عمومی معتبر نیست.');
  if(['instagram','x'].includes(type))return profileSpec(type,input);
  if(type==='telegram') {const channel=telegramChannel(input);return {name:`تلگرام · ${channel}`,url:`https://t.me/s/${channel}`,platform:'telegram-public'};}
  if(type==='youtube') {
    let channel=input.trim(),page;
    if(channel.startsWith('@')&&/^@[a-zA-Z0-9_.-]{3,100}$/.test(channel))page=`https://www.youtube.com/${channel}`;
    else if(channel.startsWith('https:')) {
      const url=new URL(channel);
      if(!['www.youtube.com','youtube.com'].includes(url.hostname)||url.username||url.password||url.port)throw problem('لینک کانال YouTube معتبر نیست.');
      if(/^\/channel\/UC[a-zA-Z0-9_-]{22}\/?$/.test(url.pathname))channel=url.pathname.split('/')[2];
      else if(/^\/@[^/]{3,100}\/?$/.test(url.pathname))page=`https://www.youtube.com${url.pathname}`;
      else throw problem('لینک کانال یا نام @handle یوتیوب را وارد کنید؛ لینک تک‌ویدیو کافی نیست.');
    }
    if(page){
      const html=await fetcher(page,{allowedHosts:['www.youtube.com'],maxBytes:3_000_000});const $=load(html);
      channel=$('meta[itemprop="channelId"]').attr('content')||'';
      if(!channel)for(const element of $('link[rel="alternate"][href]').toArray()) {try{const url=new URL($(element).attr('href'),page);if(url.hostname==='www.youtube.com'&&url.pathname==='/feeds/videos.xml')channel=url.searchParams.get('channel_id')||'';}catch{}}
    }
    if(!/^UC[a-zA-Z0-9_-]{22}$/.test(channel))throw problem('شناسهٔ کانال یوتیوب شناسایی نشد؛ شناسهٔ UC… یا لینک /channel/UC… را وارد کنید.');
    return{name:'کانال عمومی YouTube',url:`https://www.youtube.com/feeds/videos.xml?channel_id=${channel}`,platform:'youtube-public'};
  }
  if(type==='mastodon') {
    let url;try{url=new URL(input.trim());}catch{throw problem('لینک عمومی پروفایل Mastodon را وارد کنید.');}
    if(!/^\/@[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,99}(?:\.rss)?$/.test(url.pathname)||url.search||url.hash)throw problem('لینک پروفایل شبیه https://mastodon.social/@username لازم است.');
    url.pathname=url.pathname.replace(/\.rss$/,'')+'.rss';
    return{name:'پروفایل عمومی Mastodon',url:url.href,platform:'mastodon-public'};
  }
  throw problem('این شبکه اتصال بدون کلید ندارد. یکی از شبکه‌های فهرست دریافت عمومی را انتخاب کنید.');
}

export async function collectPublicSource(source,fetcher) {
  if(['instagram-public','x-public'].includes(source.platform))return collectPublicProfile(source,fetcher);
  if(source.platform==='telegram-public')return parseTelegramPublic(await fetcher(source.url,{allowedHosts:['t.me'],maxBytes:3_000_000}),source);
  return parseFeed(await fetcher(source.url,source.platform==='youtube-public'?{allowedHosts:['www.youtube.com'],maxBytes:3_000_000}:{}),{...source,platform:source.platform.replace(/-public$/,'')});
}
