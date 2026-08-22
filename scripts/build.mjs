import { promises as fs } from 'node:fs';
import path from 'node:path';
import esbuild from 'esbuild';
import Handlebars from 'handlebars';
import { minify as minifyHtml } from 'html-minifier-terser';
import sharp from 'sharp';

const defaultLocale = 'en-US';
const root = process.cwd();
const distDir = path.join(root, 'dist');
const pwaIconSizes = [192, 512];
const pngIconSizes = [32, 180, ...pwaIconSizes];

function extractMessagesByLocale(source) {
  const match = source.match(/export\s+const\s+messages\s*=\s*(\{[\s\S]*?\})\s*as\s+const/s);
  if (!match) throw new Error('Unable to parse messages from src/i18n/messages.ts');
  return Function(`return (${match[1]});`)();
}

function extractLocalesFromMessages(source) {
  return Object.keys(extractMessagesByLocale(source));
}

function collectSpecLocales(spec) {
  const locales = new Set();
  const visitName = (name) => {
    if (name && typeof name === 'object' && !Array.isArray(name))
      for (const locale of Object.keys(name)) locales.add(locale);
  };
  for (const section of spec.sections ?? []) {
    visitName(section.name);
    for (const group of section.items ?? []) {
      visitName(group.name);
      for (const item of group.items ?? []) visitName(item.name);
    }
  }
  return locales;
}

function resolveName(name, locale) {
  if (typeof name === 'string') return name;
  return name[locale] ?? name[defaultLocale];
}
function normalizeHumanId(input) {
  const cleaned = input.trim().toUpperCase().replace(/\s+/g, '').replace(/-/g, '');
  const match = cleaned.match(/^([A-Z]+)(\d+)$/);
  if (!match) return cleaned;
  const [, group, numRaw] = match;
  return `${group}${String(Number.parseInt(numRaw, 10))}`;
}

function assetUrlToPublicPath(assetUrl) {
  if (!assetUrl || /^(?:[a-z]+:)?\/\//i.test(assetUrl) || assetUrl.startsWith('data:')) return null;
  const normalized = assetUrl.startsWith('/') ? assetUrl.slice(1) : assetUrl;
  return path.join(root, 'public', normalized);
}

function mimeFromPath(assetPath) {
  const ext = path.extname(assetPath).toLowerCase();
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

async function readBrandingLogoDataUri(spec) {
  if (!spec.branding.logoUrl) return null;
  const logoPath = assetUrlToPublicPath(spec.branding.logoUrl);
  if (!logoPath) return spec.branding.logoUrl;
  const logo = await fs.readFile(logoPath);
  return `data:${mimeFromPath(logoPath)};base64,${logo.toString('base64')}`;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildPwaIconSvg({ size, spec, logoDataUri }) {
  const background = spec.branding.colors.background;
  const logoInset = Math.round(size * 0.14);
  const logoSize = size - logoInset * 2;
  const radius = Math.round(size * 0.2);
  const textSize = Math.round(size * 0.24);
  const initials = spec.branding.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  const mark = logoDataUri
    ? `<image href="${escapeXml(logoDataUri)}" x="${logoInset}" y="${logoInset}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="${escapeXml(spec.branding.colors.primary)}" font-family="system-ui, sans-serif" font-size="${textSize}" font-weight="700">${escapeXml(initials)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${escapeXml(background)}"/>
  ${mark}
</svg>
`;
}

function buildManifest({ spec, locale }) {
  return {
    id: `/${spec.id}/${locale}/`,
    name: spec.branding.title,
    short_name: spec.branding.shortName,
    description: spec.branding.title,
    lang: locale,
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: spec.branding.colors.background,
    theme_color: spec.branding.colors.primary,
    icons: pwaIconSizes.map((size) => ({
      src: `../icons/icon-${size}.png`,
      sizes: `${size}x${size}`,
      type: 'image/png',
      purpose: 'any maskable',
    })),
  };
}

function buildLocalizedPayload(spec, locale) {
  const localizedSections = spec.sections.map((section) => ({
    color: section.color,
    name: resolveName(section.name, locale),
    items: section.items.map((group) => ({
      id: group.id,
      color: group.color,
      name: resolveName(group.name, locale),
      items: group.items.map((item) => ({ id: item.id, name: resolveName(item.name, locale) })),
    })),
  }));
  const numberToIndexes = [];
  const idToNumber = {};
  let serial = 0;
  for (let si = 0; si < localizedSections.length; si += 1)
    for (let gi = 0; gi < localizedSections[si].items.length; gi += 1)
      for (let ii = 0; ii < localizedSections[si].items[gi].items.length; ii += 1) {
        const item = localizedSections[si].items[gi].items[ii];
        numberToIndexes.push([si, gi, ii]);
        idToNumber[normalizeHumanId(`${localizedSections[si].items[gi].id}${item.id}`)] = serial;
        serial += 1;
      }
  return {
    branding: spec.branding,
    sections: localizedSections,
    lookup: { numberToIndexes, idToNumber },
  };
}

async function ensureCleanDist() {
  await fs.rm(distDir, { recursive: true, force: true });
  await fs.mkdir(distDir, { recursive: true });
}

async function copyPublicAssets() {
  const publicDir = path.join(root, 'public');
  try {
    await fs.access(publicDir);
    await fs.cp(publicDir, distDir, { recursive: true });
  } catch {
    // ignore when public directory does not exist
  }
}

async function readSpecs() {
  const dir = path.join(root, 'specs');
  const files = (await fs.readdir(dir)).filter((name) => name.endsWith('.json'));
  const specs = [];
  for (const file of files) {
    const specId = file.slice(0, -5);
    const raw = await fs.readFile(path.join(dir, file), 'utf8');
    specs.push({ id: specId, ...JSON.parse(raw) });
  }
  return specs;
}

async function inferLocales(specs) {
  const messagesSource = await fs.readFile(path.join(root, 'src', 'i18n', 'messages.ts'), 'utf8');
  const appLocales = extractLocalesFromMessages(messagesSource);
  const messagesByLocale = extractMessagesByLocale(messagesSource);
  const localesBySpec = new Map();
  for (const spec of specs) {
    const specLocales = collectSpecLocales(spec);
    const locales = appLocales.filter((locale) => specLocales.has(locale));
    if (locales.length === 0)
      throw new Error(`Spec ${spec.id} has no locale intersection with src/i18n/messages.ts`);
    localesBySpec.set(spec.id, locales);
  }
  const globalLocales = appLocales.filter((locale) =>
    specs.every((spec) => localesBySpec.get(spec.id)?.includes(locale)),
  );
  const rootLocales = globalLocales.length > 0 ? globalLocales : appLocales;
  return { rootLocales, localesBySpec, messagesByLocale };
}

async function buildAssets() {
  const appJsBuild = await esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    format: 'esm',
    legalComments: 'none',
    minify: true,
    outfile: 'app.js',
    write: false,
  });
  const appCssBuild = await esbuild.build({
    entryPoints: ['src/styles.css'],
    bundle: true,
    legalComments: 'none',
    minify: true,
    outfile: 'app.css',
    write: false,
  });
  const appJs = appJsBuild.outputFiles.find((file) => file.path.endsWith('.js'))?.text;
  const appCss = appCssBuild.outputFiles.find((file) => file.path.endsWith('.css'))?.text;
  if (!appJs) throw new Error('Unable to build app JavaScript bundle');
  if (!appCss) throw new Error('Unable to build app CSS bundle');
  return { appJs, appCss };
}

async function generateSpecPwaIcons(specs) {
  for (const spec of specs) {
    const logoDataUri = await readBrandingLogoDataUri(spec);
    const iconsDir = path.join(distDir, spec.id, 'icons');
    await fs.mkdir(iconsDir, { recursive: true });
    const favicon = buildPwaIconSvg({ size: 32, spec, logoDataUri });
    await fs.writeFile(path.join(iconsDir, 'favicon.svg'), favicon, 'utf8');
    await sharp(Buffer.from(favicon)).png().toFile(path.join(iconsDir, 'favicon-32.png'));
    for (const size of pngIconSizes) {
      const icon = buildPwaIconSvg({ size, spec, logoDataUri });
      await fs.writeFile(path.join(iconsDir, `icon-${size}.svg`), icon, 'utf8');
      await sharp(Buffer.from(icon))
        .png()
        .toFile(path.join(iconsDir, `icon-${size}.png`));
    }
  }
}

async function minifyGeneratedHtml(html) {
  return minifyHtml(html, {
    collapseBooleanAttributes: true,
    collapseWhitespace: true,
    decodeEntities: true,
    minifyCSS: true,
    minifyJS: true,
    removeAttributeQuotes: true,
    removeComments: true,
    sortAttributes: true,
    sortClassName: true,
  });
}

async function generateSpecLocalePages(specs, localesBySpec, messagesByLocale, assets) {
  const tplSrc = await fs.readFile(path.join(root, 'templates', 'index.hbs'), 'utf8');
  const tpl = Handlebars.compile(tplSrc);
  for (const spec of specs) {
    const locales = localesBySpec.get(spec.id) ?? [];
    for (const locale of locales) {
      const outDir = path.join(distDir, spec.id, locale);
      await fs.mkdir(outDir, { recursive: true });
      const localizedSpec = buildLocalizedPayload(spec, locale);
      const groups = [];
      let serial = 0;
      for (let si = 0; si < localizedSpec.sections.length; si += 1) {
        for (let gi = 0; gi < localizedSpec.sections[si].items.length; gi += 1) {
          const group = localizedSpec.sections[si].items[gi];
          const key = `${si}:${gi}`;
          const scopedId = `${si}-${group.id}-${gi}`;
          const items = group.items.map((item) => {
            const out = { serial, itemId: item.id, itemName: item.name };
            serial += 1;
            return out;
          });
          groups.push({
            key,
            order: groups.length,
            id: group.id,
            color: group.color ?? localizedSpec.sections[si].color ?? '',
            name: group.name,
            total: items.length,
            items,
            scopedId,
          });
        }
      }
      const html = tpl({
        locale,
        specId: spec.id,
        title: spec.branding.title,
        logoUrl: spec.branding.logoUrl,
        themeColor: spec.branding.colors.primary,
        appCss: assets.appCss,
        appJs: assets.appJs,
        decorationFontName: spec.branding.decorationFont.name,
        decorationFontUrl: spec.branding.decorationFont.url,
        uxFontName: spec.branding.uxFont.name,
        uxFontUrl: spec.branding.uxFont.url,
        specDataJson: JSON.stringify(localizedSpec),
        messagesJson: JSON.stringify(
          messagesByLocale[locale] ?? messagesByLocale[defaultLocale] ?? {},
        ),
        ui: messagesByLocale[locale] ?? messagesByLocale[defaultLocale] ?? {},
        lastSerial: serial,
        groups,
        cssVars: [
          ['background', spec.branding.colors.background],
          ['primary', spec.branding.colors.primary],
          ['secondary', spec.branding.colors.secondary],
          ['error', spec.branding.colors.error],
          ['badge', spec.branding.colors.badge],
          ['owned', spec.branding.colors.owned],
          ['missing', spec.branding.colors.missing],
          ['print-zoom', spec.branding.printZoom],
          ['decoration-font-family', `'${spec.branding.decorationFont.name.replace(/'/g, "\\'")}'`],
          ['ux-font-family', `'${spec.branding.uxFont.name.replace(/'/g, "\\'")}'`],
        ]
          .map(([name, value]) => `--${name}:${value}`)
          .join(';'),
      });
      await fs.writeFile(path.join(outDir, 'index.html'), await minifyGeneratedHtml(html), 'utf8');
      await fs.writeFile(
        path.join(outDir, 'manifest.webmanifest'),
        `${JSON.stringify(buildManifest({ spec, locale }), null, 2)}\n`,
        'utf8',
      );

      const brandingUrls = [
        spec.branding.logoUrl,
        spec.branding.decorationFont.url,
        spec.branding.uxFont.url,
      ].filter(Boolean);
      await esbuild.build({
        entryPoints: ['src/service-worker.ts'],
        bundle: true,
        format: 'iife',
        legalComments: 'none',
        minify: true,
        define: {
          BRANDING_URLS: JSON.stringify(brandingUrls),
        },
        outfile: path.join(outDir, 'service-worker.js'),
      });
    }
  }
}

async function generateRoot(specs, rootLocales) {
  const tplSrc = await fs.readFile(path.join(root, 'templates', 'root-index.hbs'), 'utf8');
  const tpl = Handlebars.compile(tplSrc);
  const defaultLocaleForRoot = rootLocales.includes(defaultLocale) ? defaultLocale : rootLocales[0];
  const html = tpl({
    specs,
    singleSpec: specs.length === 1 ? specs[0] : null,
    defaultLocale: defaultLocaleForRoot,
    localesJson: JSON.stringify(rootLocales),
  });
  await fs.writeFile(path.join(distDir, 'index.html'), await minifyGeneratedHtml(html), 'utf8');
}

async function main() {
  await import('./validate-specs.mjs');
  await ensureCleanDist();
  await copyPublicAssets();
  const specs = await readSpecs();
  const { rootLocales, localesBySpec, messagesByLocale } = await inferLocales(specs);
  const assets = await buildAssets();
  await generateSpecPwaIcons(specs);
  await generateSpecLocalePages(specs, localesBySpec, messagesByLocale, assets);
  await generateRoot(specs, rootLocales);
  console.log(`Built ${specs.length} spec(s) to dist/<spec-id>/<locale>/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
