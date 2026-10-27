export function googleTranslationLink(text:string,target='fa') {
 const url=new URL('https://translate.google.com/');url.search=new URLSearchParams({sl:'auto',tl:target,text:text.slice(0,3000),op:'translate'}).toString();return url.href;
}
