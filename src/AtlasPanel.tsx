import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { AlertCircle, ArrowUpLeft, Bookmark, CheckCheck, Globe2, LocateFixed, MapPin, X } from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import './atlas.css';

type Mention = { countryCode: string; countryName: string; city?: string; lat: number; lon: number; confidence?: string };
type AtlasArticle = {
  id: string; title: string; summary: string; url: string; sourceName: string; publishedAt: string;
  publishedAtKnown?: boolean; sourceIconUrl?: string | null; saved: boolean; read?: boolean;
  locations?: Mention[];
};
type Country = { code: string; name: string };
type FeatureCollection = Parameters<typeof L.geoJSON>[0];
const faNumber = (value: number) => value.toLocaleString('fa-IR');
const displayNames = new Intl.DisplayNames(['fa'], { type: 'region' });
const countryName = (code: string, fallback: string) => {
  try { return displayNames.of(code) || fallback; } catch { return fallback; }
};
const featureCode = (properties: Record<string, unknown> | null | undefined) => {
  for (const key of ['ISO_A2_EH', 'ISO_A2']) {
    const value = String(properties?.[key] || '').toUpperCase();
    if (/^[A-Z]{2}$/.test(value)) return value;
  }
  return '';
};

export default function AtlasPanel({ articles }: { articles: AtlasArticle[] }) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const countriesLayer = useRef<L.GeoJSON | null>(null);
  const citiesLayer = useRef<L.LayerGroup | null>(null);
  const countryLayers = useRef(new Map<string, L.Layer>());
  const [countries, setCountries] = useState<Country[]>([]);
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState('');
  const [tilesUnavailable, setTilesUnavailable] = useState(false);
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, { saved?: boolean; read?: boolean }>>({});

  const located = useMemo(() => articles.filter(article => article.locations?.some(location => Number.isFinite(location.lat) && Number.isFinite(location.lon))), [articles]);
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const article of located) {
      for (const code of new Set(article.locations?.map(location => location.countryCode).filter(Boolean))) result.set(code, (result.get(code) || 0) + 1);
    }
    return result;
  }, [located]);
  const currentCounts = useRef(counts);
  const currentCountry = useRef(country);
  currentCounts.current = counts;
  currentCountry.current = country;
  const cities = useMemo(() => [...new Set(located.flatMap(article => (article.locations || []).filter(location => (!country || location.countryCode === country) && location.city).map(location => location.city!)))].sort((a, b) => a.localeCompare(b, 'fa')), [located, country]);
  const results = useMemo(() => located.filter(article => article.locations?.some(location => (!country || location.countryCode === country) && (!city || location.city === city))), [located, country, city]);
  const selectedName = countries.find(item => item.code === country)?.name || country;

  useEffect(() => {
    if (!element.current) return;
    const controller = new AbortController();
    let disposed = false;
    let failures = 0;
    const instance = L.map(element.current, { center: [28, 40], zoom: 2, minZoom: 2, maxZoom: 12, scrollWheelZoom: false, worldCopyJump: true });
    map.current = instance;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).on('tileerror', () => { if (!disposed && ++failures >= 3) setTilesUnavailable(true); }).addTo(instance);
    citiesLayer.current = L.layerGroup().addTo(instance);
    fetch('/world-countries.geojson', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('مرزهای کشورها بارگیری نشد.'); return response.json() as Promise<FeatureCollection>; })
      .then(data => {
        if (disposed) return;
        const choices = new Map<string, string>();
        countriesLayer.current = L.geoJSON(data, {
          style: feature => {
            const code = featureCode(feature?.properties);
            return { color: '#768e95', weight: 1, fillColor: currentCounts.current.has(code) ? '#368d7b' : '#d7e4e7', fillOpacity: currentCounts.current.has(code) ? 0.23 : 0.08 };
          },
          onEachFeature(feature, layer) {
            const code = featureCode(feature.properties);
            if (!code) return;
            const name = countryName(code, String(feature.properties?.NAME || code));
            choices.set(code, name);
            countryLayers.current.set(code, layer);
            const tooltip = document.createElement('span');
            tooltip.textContent = name;
            layer.bindTooltip(tooltip, { sticky: true, direction: 'top' });
            layer.on('click', () => { setCountry(code); setCity(''); });
            layer.on('add', () => {
              const path = (layer as L.Path).getElement?.();
              if (!path) return;
              path.setAttribute('data-country', code);
              path.setAttribute('role', 'button');
              path.setAttribute('tabindex', '0');
              path.setAttribute('aria-label', `خبرهای ${name}`);
              path.addEventListener('keydown', event => {
                if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') { event.preventDefault(); setCountry(code); setCity(''); }
              });
            });
          },
        }).addTo(instance);
        setCountries([...choices].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, 'fa')));
        setMapReady(true);
      })
      .catch(error => { if (!disposed && !controller.signal.aborted) setMapError(error.message || 'دریافت مرزهای کشورها ممکن نشد.'); });
    const resize = new ResizeObserver(() => instance.invalidateSize());
    resize.observe(element.current);
    return () => {
      disposed = true; controller.abort(); resize.disconnect(); instance.remove();
      map.current = null; countriesLayer.current = null; citiesLayer.current = null; countryLayers.current.clear();
    };
  }, []);

  useEffect(() => {
    countriesLayer.current?.setStyle(feature => {
      const code = featureCode(feature?.properties);
      const selected = code === country;
      return { color: selected ? '#dc7859' : '#768e95', weight: selected ? 2.4 : 1, fillColor: selected ? '#e68362' : counts.has(code) ? '#368d7b' : '#d7e4e7', fillOpacity: selected ? 0.36 : counts.has(code) ? 0.23 : 0.08 };
    });
    const layer = countryLayers.current.get(country);
    if (layer && 'getBounds' in layer && typeof layer.getBounds === 'function') {
      const bounds = layer.getBounds() as L.LatLngBounds;
      if (bounds.isValid()) map.current?.fitBounds(bounds, { padding: [25, 25], maxZoom: 6, animate: false });
    } else if (!country && mapReady) map.current?.setView([28, 40], 2, { animate: false });
  }, [country, counts, mapReady]);

  useEffect(() => {
    const group = citiesLayer.current;
    if (!group) return;
    group.clearLayers();
    const places = new Map<string, { location: Mention; count: number }>();
    for (const article of results) {
      const seen = new Set<string>();
      for (const location of article.locations || []) {
        if ((country && location.countryCode !== country) || (city && location.city !== city) || !Number.isFinite(location.lat) || !Number.isFinite(location.lon)) continue;
        const key = `${location.countryCode}:${location.city || ''}:${location.lat}:${location.lon}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const existing = places.get(key);
        places.set(key, { location, count: (existing?.count || 0) + 1 });
      }
    }
    for (const { location, count } of places.values()) {
      const marker = L.circleMarker([location.lat, location.lon], { radius: Math.min(14, 5 + Math.sqrt(count)), color: '#fff', weight: 2, fillColor: '#df805e', fillOpacity: 0.9 });
      const description = document.createElement('span');
      description.textContent = `${location.city || location.countryName} · ${faNumber(count)} خبر · ${location.city ? 'مکان ذکرشده در متن' : 'مرکز تقریبی کشور'}`;
      marker.bindTooltip(description);
      marker.on('click', () => { setCountry(location.countryCode); setCity(location.city || ''); });
      marker.addTo(group);
    }
    if (city) {
      const place = [...places.values()].find(value => value.location.city === city);
      if (place) map.current?.setView([place.location.lat, place.location.lon], 7, { animate: false });
    }
  }, [results, country, city, mapReady]);

  async function action(article: AtlasArticle, field: 'read' | 'saved', value: boolean) {
    setBusy(`${article.id}:${field}`); setActionError('');
    try {
      const response = await fetch(`/api/articles/${encodeURIComponent(article.id)}/${field === 'saved' ? 'save' : 'read'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [field]: value }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'ثبت تغییر انجام نشد.');
      setOverrides(previous => ({ ...previous, [article.id]: { ...previous[article.id], [field]: value } }));
    } catch (error) { setActionError((error as Error).message); }
    finally { setBusy(null); }
  }

  return <section className="atlas-panel" aria-label="نقشهٔ خبر">
    <div className="atlas-intro"><div><span className="atlas-kicker"><Globe2 size={16} /> جغرافیای خبر</span><h2>جهان را از دریچهٔ خبر ببینید.</h2><p>روی کشور کلیک کنید یا یک شهر را انتخاب کنید تا خبرهای مرتبط در همین بخش نمایش داده شوند.</p></div><span className="atlas-count">{faNumber(located.length)} خبر دارای مکان ذکرشده</span></div>
    <div className="atlas-controls">
      <label>کشور<select aria-label="کشور روی نقشه" value={country} onChange={event => { setCountry(event.target.value); setCity(''); }}><option value="">همهٔ کشورها</option>{countries.map(item => <option key={item.code} value={item.code}>{item.name} {counts.get(item.code) ? `(${faNumber(counts.get(item.code)!)})` : ''}</option>)}</select></label>
      <label>شهر<select aria-label="شهر روی نقشه" value={city} onChange={event => setCity(event.target.value)}><option value="">همهٔ شهرها</option>{cities.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      {(country || city) && <button className="secondary-button" onClick={() => { setCountry(''); setCity(''); }}><X size={15} />پاک کردن فیلتر</button>}
      <button className="atlas-world-button" onClick={() => map.current?.setView([28, 40], 2)}><LocateFixed size={17} />نمای جهان</button>
    </div>
    <div className="atlas-map-wrap"><div className="atlas-map" ref={element} aria-label="نقشهٔ OpenStreetMap با کشورها و مکان‌های ذکرشده در خبرها" />{!mapReady && !mapError && <div className="atlas-loading">در حال آماده‌سازی مرزهای کشورها…</div>}</div>
    {(mapError || tilesUnavailable) && <div className="atlas-notice" role="status"><AlertCircle size={17} /><p>{mapError || 'کاشی‌های نقشه در دسترس نیستند؛ مرز کشورها و فیلتر خبرها همچنان قابل استفاده‌اند.'}</p></div>}
    <p className="atlas-method"><MapPin size={15} />نقاط، محل نام‌برده‌شده در متن خبر را به‌صورت تقریبی نشان می‌دهند؛ مکان دقیق رویداد یا موقعیت اشخاص نیستند. {faNumber(articles.length - located.length)} خبر بارگذاری‌شده هنوز مکان قابل تشخیص ندارد.</p>
    <div className="atlas-results-heading"><h3>{city ? `خبرهای مرتبط با ${city}` : country ? `خبرهای مرتبط با ${selectedName}` : 'خبرهای دارای مکان'}</h3><span>{faNumber(results.length)} خبر در داده‌های بارگذاری‌شده</span></div>
    {actionError && <p className="atlas-error" role="alert">{actionError}</p>}
    {results.length ? <div className="atlas-results">{results.slice(0, 50).map(article => {
      const flags = { saved: article.saved, read: article.read, ...overrides[article.id] };
      return <article key={article.id} className={`atlas-news-card ${flags.read ? 'atlas-read' : ''}`}>
        <div className="atlas-news-meta"><span>{article.sourceName}</span><span>{(article.locations || []).filter(location => (!country || country === location.countryCode) && (!city || city === location.city)).map(location => location.city || location.countryName).filter((name, index, list) => list.indexOf(name) === index).join('، ')}</span></div>
        <a href={article.url} target="_blank" rel="noreferrer" onClick={() => { if (!flags.read) void action(article, 'read', true); }}><h4 dir="auto">{article.title}</h4></a><p dir="auto">{article.summary}</p>
        <div className="atlas-news-footer"><a href={article.url} target="_blank" rel="noreferrer" onClick={() => { if (!flags.read) void action(article, 'read', true); }}>منبع اصلی<ArrowUpLeft size={14} /></a><div><button aria-label={flags.read ? 'علامت‌گذاری به‌عنوان نخوانده' : 'علامت‌گذاری به‌عنوان خوانده‌شده'} disabled={busy === `${article.id}:read`} onClick={() => void action(article, 'read', !flags.read)} className={flags.read ? 'active' : ''}><CheckCheck size={17} />{flags.read ? 'خوانده‌شده' : 'نخوانده'}</button><button aria-label={flags.saved ? 'برداشتن خبر نقشه از ذخیره‌شده‌ها' : 'ذخیرهٔ خبر نقشه'} disabled={busy === `${article.id}:saved`} onClick={() => void action(article, 'saved', !flags.saved)} className={flags.saved ? 'active' : ''}><Bookmark size={17} fill={flags.saved ? 'currentColor' : 'none'} /></button></div></div>
      </article>;
    })}</div> : <div className="atlas-empty"><MapPin size={28} /><h3>خبری با این مکان پیدا نشد.</h3><p>انتخاب روی نقشه فقط خبرهایی را نمایش می‌دهد که نام این کشور یا شهر در متنشان تشخیص داده شده است.</p></div>}
    {results.length > 50 && <p className="atlas-limit">۵۰ خبر نخست نمایش داده می‌شود؛ برای جست‌وجوی روزهای گذشته از بخش تاریخچه استفاده کنید.</p>}
    <p className="atlas-attribution">نقشه: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> · مرزها: <a href="https://www.naturalearthdata.com/about/terms-of-use/" target="_blank" rel="noreferrer">Natural Earth — Public Domain</a></p>
  </section>;
}
