import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {categoryFor,cleanText,safeMediaUrl} from './feeds.mjs';
const lower=value=>typeof value==='string'?value.toLowerCase():'';
const fail=message=>Object.assign(new Error(message),{status:422});

export function profileSpec(type,input) {
  let value=input.trim().replace(/^@/,''),url;
  const hosts=type==='instagram'?['www.instagram.com','instagram.com']:['x.com','www.x.com','twitter.com','www.twitter.com'];
  if(/^https?:/i.test(value)) {
    try{url=new URL(value);}catch{throw fail('لینک عمومی معتبر نیست.');}
    if(url.protocol!=='https:'||!hosts.includes(url.hostname)||url.username||url.password||url.port)throw fail('لینک مستقیم HTTPS همین شبکه لازم است.');
    value=url.pathname.replace(/^\/|\/$/g,'');
  }
  if(type==='instagram') {
    if(/^(p|reel)\/[a-zA-Z0-9_-]{3,100}$/.test(value))return {name:'پست عمومی اینستاگرام',url:`https://www.instagram.com/${value}/`,platform:'instagram-public'};
    if(!/^[a-zA-Z0-9_](?:[a-zA-Z0-9_.]{0,28}[a-zA-Z0-9_])?$/.test(value)||/^(accounts|explore|direct|stories|reels|p|reel|about|developer)$/i.test(value))throw fail('نام پیج عمومی یا لینک مستقیم پست اینستاگرام را وارد کنید.');
    return{name:`Instagram · ${value}`,url:`https://www.instagram.com/${value.toLowerCase()}/`,platform:'instagram-public'};
  }
  const match=/^([a-zA-Z0-9_]{1,15})(?:\/status\/(\d{1,25}))?$/.exec(value);
  if(!match||/^(home|login|logout|settings|i|search|explore|intent|share)$/i.test(match[1]))throw fail('نام حساب عمومی X یا لینک مستقیم پست را وارد کنید.');
  return{name:`X · ${match[1]}`,url:`https://x.com/${match[1].toLowerCase()}${match[2]?'/status/'+match[2]:''}`,platform:'x-public'};
}
function jsonNodes($) {
  const nodes=[];
  function walk(node,depth=0) {
    if(!node||typeof node!=='object'||depth>35||nodes.length>=8000)return;
    if(Array.isArray(node)){for(const item of node.slice(0,200))walk(item,depth+1);return;}
    nodes.push(node);for(const value of Object.values(node))if(value&&typeof value==='object')walk(value,depth+1);
  }
  $('script[type="application/json"],script[type="application/ld+json"],script#__NEXT_DATA__').each((_,script)=>{try{walk(JSON.parse($(script).html()||''));}catch{}});
  return nodes;
}
function record(source,{text,url,date,media=[],icon,label,language},now) {
  const body=cleanText(text),href=safeMediaUrl(url);if(!body||!href)return null;
  const published=new Date(date||''),known=Number.isFinite(published.getTime()),unique=[];
  for(const item of media){const url=safeMediaUrl(item.url);if(url&&['image','video'].includes(item.type)&&!unique.some(item=>item.url===url))unique.push({...item,url,poster:safeMediaUrl(item.poster)||undefined,source:'public-profile'});}
  return {id:createHash('sha256').update(href).digest('hex').slice(0,24),url:href,title:body.slice(0,180),summary:body.slice(0,2400),fullText:body.slice(0,60000),
    sourceId:source.id,sourceName:source.name||cleanText(label),sourceIconUrl:safeMediaUrl(icon),platform:source.platform.replace(/-public$/,''),textScope:'public-profile-page',
    publishedAt:known?published.toISOString():now.toISOString(),publishedAtKnown:known,category:categoryFor(body),language:language||(/[\u0600-\u06ff]/.test(body)?'fa':'en'),media:unique.slice(0,12),imageUrl:unique.find(item=>item.type==='image')?.url||null,saved:false};
}
export function parsePublicProfile(html,source,now=new Date()) {
  const $=load(html),nodes=jsonNodes($),parts=new URL(source.url).pathname.split('/').filter(Boolean),instagram=source.platform==='instagram-public';
  const handle=instagram&&['p','reel'].includes(parts[0])?null:parts[0].toLowerCase(),post=instagram?(handle?null:parts[1]):parts[2],items=[];
  const put=value=>{const item=record(source,value,now);if(item&&!items.some(existing=>existing.url===item.url)&&items.length<40)items.push(item);};
  if(instagram) {
    if(nodes.some(node=>(!handle||lower(node.username)===handle)&&node.is_private===true))throw Object.assign(fail('این پیج خصوصی است؛ فقط محتوای عمومیِ بدون ورود خوانده می‌شود.'),{code:'PRIVATE_PROFILE'});
    const ownerIds=new Set(nodes.filter(node=>lower(node.username)===handle&&node.id).map(node=>String(node.id)));
    for(const node of nodes) {
      const code=node.shortcode||node.code,owner=node.owner||node.user||{},username=lower(owner.username);
      if(typeof code!=='string'||!/^[a-zA-Z0-9_-]{3,100}$/.test(code)||owner.is_private===true)continue;
      if(post?code!==post:username!==handle&&!ownerIds.has(String(owner.id)))continue;
      if(source.expectedAuthor&&username!==source.expectedAuthor)continue;
      const text=node.caption?.text||node.edge_media_to_caption?.edges?.[0]?.node?.text;
      if(typeof text!=='string')continue;
      const image=node.display_url||node.image_versions2?.candidates?.[0]?.url;
      const video=node.video_url||node.video_versions?.[0]?.url;
      const epoch=node.taken_at_timestamp||node.taken_at;
      put({text,url:`https://www.instagram.com/p/${code}/`,date:typeof epoch==='number'?epoch*1000:null,icon:owner.profile_pic_url,label:username,
        media:[...(image?[{type:'image',url:image}]:[]),...(video?[{type:'video',url:video,poster:image}]:[])]});
    }
    for(const node of nodes) {
      const types=Array.isArray(node['@type'])?node['@type']:[node['@type']];
      if(!types.some(type=>typeof type==='string'&&/^(Article|SocialMediaPosting|BlogPosting)$/.test(type.replace(/^https?:\/\/schema.org\//,'')))||node.isAccessibleForFree===false)continue;
      const href=safeMediaUrl(node.url||node.mainEntityOfPage?.['@id']);if(!href)continue;
      const url=new URL(href),match=/^\/(p|reel)\/([a-zA-Z0-9_-]{3,100})\/?$/.exec(url.pathname);
      if(!['www.instagram.com','instagram.com'].includes(url.hostname)||!match||(post&&match[2]!==post))continue;
      const author=Array.isArray(node.author)?node.author[0]:node.author||{};
      let username=lower(author.alternateName).replace(/^@/,'');
      if(!username&&typeof author.url==='string'){try{const profile=new URL(author.url);if(['www.instagram.com','instagram.com'].includes(profile.hostname))username=profile.pathname.split('/').filter(Boolean)[0]?.toLowerCase()||'';}catch{}}
      if((handle&&username!==handle)||(source.expectedAuthor&&username!==source.expectedAuthor))continue;
      const text=node.articleBody||node.text||node.caption||node.description;if(typeof text!=='string')continue;
      const image=Array.isArray(node.image)?node.image:[node.image];
      put({text,url:`https://www.instagram.com/p/${match[2]}/`,date:node.datePublished,media:image.map(value=>({type:'image',url:typeof value==='string'?value:value?.url||value?.contentUrl}))});
    }
    // Only post metadata with an exact canonical match may be used. A profile's logo/bio is never a news item.
    if(post&&!items.length) {
      const canonical=$('link[rel="canonical"]').attr('href')||$('meta[property="og:url"]').attr('content');
      let matches=false;try{const url=new URL(canonical);matches=['www.instagram.com','instagram.com'].includes(url.hostname)&&/^\/(p|reel)\//.test(url.pathname)&&url.pathname.split('/')[2]===post;}catch{}
      const type=$('meta[property="og:type"]').attr('content')||'';
      const title=($('meta[property="og:title"]').attr('content')||'').toLowerCase();
      const authorMatches=!source.expectedAuthor||title.startsWith(source.expectedAuthor+' on instagram:')||title.includes('(@'+source.expectedAuthor+')');
      if(matches&&authorMatches&&/^instapp:(photo|video)$/.test(type)) {
        const text=$('meta[property="og:description"]').attr('content');
        const image=$('meta[property="og:image"]').attr('content');
        put({text,url:`https://www.instagram.com/p/${post}/`,date:$('meta[property="article:published_time"]').attr('content'),media:image?[{type:'image',url:image}]:[]});
      }
    }
  } else {
    for(const node of nodes) {
      const legacy=node.legacy||node,user=node.user||node.author||node.core?.user_results?.result||{},profile=user.legacy||user;
      const username=profile.screen_name||user.core?.screen_name,id=legacy.id_str||node.rest_id||(typeof legacy.id==='string'?legacy.id:null);
      if(typeof username!=='string'||username.toLowerCase()!==handle||profile.protected===true||typeof id!=='string'||!/^\d{1,25}$/.test(id)||(post&&id!==post))continue;
      const text=legacy.full_text||legacy.text;if(typeof text!=='string')continue;
      const media=[];
      for(const item of (Array.isArray(legacy.extended_entities?.media)?legacy.extended_entities.media:Array.isArray(legacy.entities?.media)?legacy.entities.media:[]).slice(0,12)) {
        if(item.type==='photo')media.push({type:'image',url:item.media_url_https});
        if(['video','animated_gif'].includes(item.type)) {
          const video=(item.video_info?.variants||[]).filter(variant=>variant.content_type==='video/mp4').sort((a,b)=>(b.bitrate||0)-(a.bitrate||0))[0];
          if(video)media.push({type:'video',url:video.url,poster:item.media_url_https});
        }
      }
      put({text,url:`https://x.com/${handle}/status/${id}`,date:legacy.created_at||legacy.createdAt,media,icon:profile.profile_image_url_https,label:profile.name,language:legacy.lang});
    }
  }
  if(!items.length)throw fail('پست عمومی قابل خواندن بدون ورود پیدا نشد. سایت ممکن است ورود، تأیید مرورگر یا محدودیت دسترسی داشته باشد؛ عمومی‌بودن پیج تضمین دریافت نیست. در صورت وجود، لینک مستقیم پست را هم امتحان کنید. اتصال ثبت نشد.');
  return items;
}
export async function collectPublicProfile(source,fetcher) {
  const instagram=source.platform==='instagram-public',parts=new URL(source.url).pathname.split('/').filter(Boolean);
  const url=instagram?source.url:parts[2]?`https://platform.twitter.com/embed/Tweet.html?id=${parts[2]}&lang=en`:`https://syndication.twitter.com/srv/timeline-profile/screen-name/${parts[0]}`;
  const hosts=instagram?['www.instagram.com','instagram.com']:['syndication.twitter.com','platform.twitter.com'];
  const html=await fetcher(url,{allowedHosts:hosts,maxBytes:3_000_000,timeoutMs:12000});
  try{return parsePublicProfile(html,source);}catch(error){
    if(!instagram||['p','reel'].includes(parts[0])||error.code==='PRIVATE_PROFILE')throw error;
    const $=load(html),links=new Set(),articles=[];
    $('a[href]').each((_,a)=>{try{const url=new URL($(a).attr('href'),source.url);if(['www.instagram.com','instagram.com'].includes(url.hostname)&&/^\/(p|reel)\/[a-zA-Z0-9_-]{3,100}\/?$/.test(url.pathname)&&links.size<5)links.add(`https://www.instagram.com${url.pathname}`);}catch{}});
    for(const url of links){try{const page=await fetcher(url,{allowedHosts:['www.instagram.com','instagram.com'],maxBytes:3_000_000,timeoutMs:8000});const items=parsePublicProfile(page,{...source,url,expectedAuthor:parts[0].toLowerCase()});for(const item of items)if(!articles.some(a=>a.url===item.url))articles.push(item);}catch{}}
    if(!articles.length)throw error;return articles;
  }
}
