import './styles.css';
import QRCode from 'qrcode';
import type { MessageKey } from './i18n/messages';
import { decodeSerials, encodeSerials } from './services/codec';
import {
  exportDuplicates,
  exportMissing,
  formatTextStickerList,
  parseSharedData,
  parseTextStickerList,
  type TextShareEntry,
} from './services/share-service';
import { loadSpec, resolveName, type SpecRuntime } from './services/spec-service';
import { normalizeStickerCode } from './services/sticker-code';
import { keyFor, loadCollection, saveCollection } from './services/storage';
import type { CollectionState } from './types';

type TabId = 'album' | 'duplicates' | 'search' | 'share' | 'config' | 'about';
type Cfg = {
  albumName: string;
  sort: 'spec' | 'alpha';
  hideOwned: boolean;
  hideCompleted: boolean;
  showDup: boolean;
};
type RuntimeData = {
  spec: string;
  owned: Set<number>;
  duplicates: Map<number, number>;
};
type RouteRuntimeContext = {
  path: string;
  lock: boolean;
  showShareScreen: (id: string) => void;
  setTab: (tab: TabId, syncHash?: boolean) => void;
  lockRoute: (path: string | null) => void;
  openShareExchangeReceive: (query: URLSearchParams) => void;
  openShareExchangedReceive: (query: URLSearchParams) => void;
  openShareExchangeSendback: (query: URLSearchParams) => void;
  openShareQrCode: (query: URLSearchParams) => void;
  openShareTextExchange: () => void;
  openShareTextPaste: () => void;
  openShareTextSendbackPaste: () => void;
};

export function handleExchangeReceive(context: RouteRuntimeContext, query: URLSearchParams): void {
  if (context.lock) context.lockRoute(context.path);
  context.setTab('share', false);
  context.showShareScreen('share-receive-screen');
  context.openShareExchangeReceive(query);
}

export function handleExchangedReceive(context: RouteRuntimeContext, query: URLSearchParams): void {
  if (context.lock) context.lockRoute(context.path);
  context.setTab('share', false);
  context.showShareScreen('share-exchanged-receive-screen');
  context.openShareExchangedReceive(query);
}

export function handleExchangeSendback(context: RouteRuntimeContext, query: URLSearchParams): void {
  if (context.lock) context.lockRoute(context.path);
  context.setTab('share', false);
  context.showShareScreen('share-exchange-sendback-screen');
  context.openShareExchangeSendback(query);
}

export function handleShareQrCode(context: RouteRuntimeContext, query: URLSearchParams): void {
  context.setTab('share', false);
  context.showShareScreen('share-qrcode-screen');
  context.openShareQrCode(query);
}

export function handleShareTextExchange(context: RouteRuntimeContext): void {
  if (context.lock) context.lockRoute(context.path);
  context.setTab('share', false);
  context.showShareScreen('share-text-exchange-screen');
  context.openShareTextExchange();
}

export function handleShareTextPaste(context: RouteRuntimeContext): void {
  if (context.lock) context.lockRoute(context.path);
  context.setTab('share', false);
  context.showShareScreen('share-text-paste-screen');
  context.openShareTextPaste();
}

export function handleShareTextSendbackPaste(context: RouteRuntimeContext): void {
  if (context.lock) context.lockRoute(context.path);
  context.setTab('share', false);
  context.showShareScreen('share-text-sendback-paste-screen');
  context.openShareTextSendbackPaste();
}

const state: {
  tab: TabId;
  search: string;
  quick: string;
  cfg: Cfg;
  expanded: Set<string>;
  data: RuntimeData;
} = {
  tab: 'album',
  search: '',
  quick: '',
  expanded: new Set(),
  cfg: {
    albumName: 'default',
    sort: 'spec',
    hideOwned: false,
    hideCompleted: false,
    showDup: true,
  },
  data: { spec: '', owned: new Set(), duplicates: new Map() },
};
const cfgKey = (spec: string): string => `sticker-collection:v1:config:${spec}`;

const dupCount = (serial: number): number => state.data.duplicates.get(serial) ?? 0;
const isOwned = (serial: number): boolean => state.data.owned.has(serial);
const toPersisted = (): CollectionState => ({
  spec: state.data.spec,
  name: state.cfg.albumName,
  owned: Array.from(state.data.owned.values()).sort((a, b) => a - b),
  duplicates: Array.from(state.data.duplicates.entries())
    .flatMap(([serial, count]) => Array.from({ length: count }, () => serial))
    .sort((a, b) => a - b),
});
const save = (): void => {
  if (state.data.spec) saveCollection(toPersisted());
};
const saveCfg = (): void => {
  if (!state.data.spec) return;
  localStorage.setItem(cfgKey(state.data.spec), JSON.stringify(state.cfg));
};
const normalizeText = (input: string): string =>
  input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/-/g, '');

const normalizeCodeInput = (input: string): string =>
  input
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 12);

const collapseAutocompletePrefix = (group: string, groups: string[]): string => {
  for (let i = 1; i <= group.length; i += 1) {
    const prefix = group.slice(0, i);
    const matches = groups.filter((id) => id.startsWith(prefix));
    if (matches.length === 1) return group.slice(0, i - 1);
  }
  return group.slice(0, Math.max(0, group.length - 1));
};

const t = (translationId: MessageKey): string =>
  window.__APP_CONFIG__?.messages[translationId] ?? `t(${translationId})`;

const safePrompt = (message: string): string => {
  try {
    return prompt(message)?.trim() ?? '';
  } catch {
    return '';
  }
};

const stickerLabelText = (
  ref: NonNullable<ReturnType<SpecRuntime['byNumber']>>,
  locale: string,
): string =>
  `${ref.group.id}-${ref.item.id} <span class="share-change-name">${resolveName(ref.item.name, locale)}</span>`;

const formatPrintTimestamp = (locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());

async function boot(): Promise<void> {
  const specId = window.__APP_CONFIG__?.specId ?? '';
  const locale = window.__APP_CONFIG__?.locale ?? 'en-US';
  const runtime = await loadSpec(specId);
  const maxSerial = runtime.serials.length - 1;
  const rawCfg = localStorage.getItem(cfgKey(specId));
  if (rawCfg) {
    try {
      const parsed = JSON.parse(rawCfg) as Partial<Cfg>;
      state.cfg = {
        albumName: typeof parsed.albumName === 'string' ? parsed.albumName.trim() : 'default',
        sort: parsed.sort === 'alpha' ? 'alpha' : 'spec',
        hideOwned: Boolean(parsed.hideOwned),
        hideCompleted: Boolean(parsed.hideCompleted),
        showDup: Boolean(parsed.showDup),
      };
    } catch {
      // ignore malformed persisted config
    }
  }
  const configuredName = state.cfg.albumName || 'default';
  const loaded = loadCollection(specId, configuredName) ?? loadCollection(specId, 'default');
  if (loaded) {
    const dup = new Map<number, number>();
    loaded.duplicates.forEach((serial) => {
      dup.set(serial, (dup.get(serial) ?? 0) + 1);
    });
    state.data = {
      spec: loaded.spec,
      owned: new Set(loaded.owned),
      duplicates: dup,
    };
  } else {
    const prompted = safePrompt(t('promptAlbumName'));
    const albumName = prompted || configuredName || 'default';
    state.cfg.albumName = albumName;
    state.data = { spec: specId, owned: new Set(), duplicates: new Map() };
  }
  save();

  const tabIds = Array.from(document.querySelectorAll<HTMLElement>('.tab-pane[id^="tab-"]'))
    .map((el) => el.id.replace(/^tab-/, ''))
    .filter((id): id is TabId => id.length > 0);
  const navTabIds = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.bottom button[data-tab]'),
  )
    .map((button) => button.getAttribute('data-tab'))
    .filter((id): id is TabId => Boolean(id && id.length > 0));
  const defaultTab: TabId = navTabIds.find((id) => tabIds.includes(id)) ?? tabIds[0] ?? 'album';
  const validTabs = new Set<TabId>(tabIds);
  let lockedShareRoute: string | null = null;
  let didAutoPrint = false;
  let isPreparingNativePrint = false;
  let hashBeforeNativePrint: string | null = null;
  const setTab = (tab: TabId, syncHash = true): void => {
    state.tab = tab;
    for (const id of tabIds) {
      document.getElementById(`tab-${id}`)?.classList.toggle('hidden', id !== tab);
      document.querySelector(`button[data-tab="${id}"]`)?.classList.toggle('active', id === tab);
    }
    if (syncHash && location.hash !== `#${tab}`) location.hash = tab;
    apply();
    const focusTargetId = document
      .querySelector<HTMLButtonElement>(`.bottom button[data-tab="${tab}"]`)
      ?.getAttribute('data-tab-focus-element');
    if (focusTargetId) {
      const focusTarget = document.getElementById(focusTargetId) as HTMLInputElement | null;
      focusTarget?.focus();
      const len = focusTarget?.value.length ?? 0;
      focusTarget?.setSelectionRange(len, len);
    }
  };

  const bottomNav = document.querySelector('.bottom');
  if (bottomNav) {
    bottomNav.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const button = target.closest('button[data-tab]') as HTMLButtonElement | null;
      if (!button) return;
      const raw = button.getAttribute('data-tab');
      if (!raw || !validTabs.has(raw as TabId)) return;
      if (lockedShareRoute) return;
      setTab(raw as TabId);
    });
  }

  const exchangeLink = (params: URLSearchParams): string =>
    `${location.origin}${location.pathname}#share/receive?${params.toString()}`;
  const textEntries = (): TextShareEntry[] =>
    runtime.serials.map(({ serial, groupId, itemId }) => ({ serial, groupId, itemId }));
  const clipboardErrorDetails = (error: unknown): string => {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return String(error);
  };
  const readClipboardText = async (): Promise<string> => {
    if (navigator.clipboard?.readText) return navigator.clipboard.readText();
    return safePrompt(t('textSharePastePlaceholder'));
  };
  const writeClipboardText = async (text: string): Promise<void> => {
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch (error) {
        console.warn('clipboard.writeText failed', error);
      }
    }
    if (!copied) window.prompt(t('promptCopyManually'), text);
  };
  const sendPlainTextBy = async (
    text: string,
    channel: 'sms' | 'whatsapp' | 'clipboard',
  ): Promise<void> => {
    if (channel === 'clipboard') {
      await writeClipboardText(text);
      return;
    }
    const phone = prompt(t('promptPhoneNumber'))?.trim();
    if (!phone) return;
    const encoded = encodeURIComponent(text);
    if (channel === 'sms') location.href = `sms:${phone}?body=${encoded}`;
    else window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encoded}`, '_blank');
  };
  const exchangeTextBlocks = (): { missing: string; duplicates: string } => {
    const missing = runtime.serials
      .filter(({ serial }) => !isOwned(serial))
      .map(({ serial }) => serial);
    const duplicates = Array.from(state.data.duplicates.entries()).flatMap(([serial, count]) =>
      Array.from({ length: count }, () => serial),
    );
    return {
      missing: formatTextStickerList(textEntries(), missing),
      duplicates: formatTextStickerList(textEntries(), duplicates),
    };
  };
  const openQrCode = (link: string): void => {
    const params = new URLSearchParams();
    params.set('url', link);
    location.hash = `share/qrcode?${params.toString()}`;
  };

  const openShareExchangeReceive = (query: URLSearchParams): void => {
    document.getElementById('share-exchange-list-screen')?.classList.add('hidden');
    document.getElementById('share-export-list-screen')?.classList.add('hidden');
    document.getElementById('share-exchange-sendback-screen')?.classList.add('hidden');
    document.getElementById('share-exchanged-receive-screen')?.classList.add('hidden');
    const screen = document.getElementById('share-receive-screen');
    const needList = document.getElementById('share-need-list');
    const needDuplicateList = document.getElementById('share-need-duplicate-list');
    const peerList = document.getElementById('share-peer-list');
    const peerDuplicateList = document.getElementById('share-peer-duplicate-list');
    const sourceName = document.getElementById('share-receive-source-name');
    if (!screen || !needList || !needDuplicateList || !peerList || !peerDuplicateList) return;
    screen.classList.remove('hidden');
    if (sourceName) sourceName.textContent = query.get('name') || t('unknownAlbumName');
    void (async () => {
      let parsed: Awaited<ReturnType<typeof parseSharedData>>;
      try {
        parsed = await parseSharedData(query, maxSerial);
      } catch (e) {
        console.log('Error parsing', query.toString(), e);
        alert(t('alertPasteInvalidUrl'));
        lockedShareRoute = null;
        setTab('share');
        return;
      }
      if (parsed.spec && parsed.spec !== state.data.spec) {
        alert(t('alertSpecMismatch'));
        lockedShareRoute = null;
        setTab('share');
        return;
      }
      if (sourceName)
        sourceName.textContent = parsed.name || query.get('name') || t('unknownAlbumName');
      const need: number[] = [];
      const needDuplicates: number[] = [];
      const takenNewSerials = new Set<number>();
      for (const serial of parsed.duplicates ?? []) {
        if (!runtime.byNumber(serial)) continue;
        if (!isOwned(serial) && !takenNewSerials.has(serial)) {
          need.push(serial);
          takenNewSerials.add(serial);
        } else {
          needDuplicates.push(serial);
        }
      }
      const peerMissing = new Set(parsed.missing ?? []);
      const ownedDuplicates = Array.from(state.data.duplicates.entries()).flatMap(
        ([serial, count]) => Array.from({ length: count }, () => serial),
      );
      const peer: number[] = [];
      const peerDuplicates: number[] = [];
      const givenNewSerials = new Set<number>();
      for (const serial of ownedDuplicates) {
        if (!runtime.byNumber(serial)) continue;
        if (peerMissing.has(serial) && !givenNewSerials.has(serial)) {
          peer.push(serial);
          givenNewSerials.add(serial);
        } else {
          peerDuplicates.push(serial);
        }
      }
      const selectedCount = (target: HTMLElement, attr: string): number =>
        target.querySelectorAll(`input[${attr}]:checked`).length;
      const changeDuplicateCount = (serial: number, delta: number): void => {
        const next = Math.max(0, dupCount(serial) + delta);
        if (next === 0) state.data.duplicates.delete(serial);
        else state.data.duplicates.set(serial, next);
      };
      const receiveSticker = (serial: number): void => {
        if (isOwned(serial)) changeDuplicateCount(serial, 1);
        else state.data.owned.add(serial);
      };
      const giveSticker = (serial: number): void => {
        changeDuplicateCount(serial, -1);
      };
      const render = (
        target: HTMLElement,
        attr: string,
        serials: number[],
        ownedClass = '',
        checked = true,
      ): void => {
        target.innerHTML = serials
          .map((serial) => {
            const ref = runtime.byNumber(serial);
            if (!ref) return '';
            return `<label class="share-change ${ownedClass}"><input type="checkbox" ${attr}="${serial}" ${checked ? 'checked' : ''}/> ${stickerLabelText(ref, locale)}</label>`;
          })
          .join('');
      };
      render(needList, 'data-need', need, 'owned');
      render(needDuplicateList, 'data-need-duplicate', needDuplicates, '', false);
      render(peerList, 'data-peer', peer);
      render(peerDuplicateList, 'data-peer-duplicate', peerDuplicates, '', false);
      const refresh = (): void => {
        const needCount = selectedCount(needList, 'data-need');
        const needDuplicateCount = selectedCount(needDuplicateList, 'data-need-duplicate');
        const peerCount = selectedCount(peerList, 'data-peer');
        const peerDuplicateCount = selectedCount(peerDuplicateList, 'data-peer-duplicate');
        const needNode = document.getElementById('share-need-count');
        const needDuplicateNode = document.getElementById('share-need-duplicate-count');
        const peerNode = document.getElementById('share-peer-count');
        const peerDuplicateNode = document.getElementById('share-peer-duplicate-count');
        const diffNode = document.getElementById('share-count-diff');
        if (needNode) needNode.textContent = String(needCount);
        if (needDuplicateNode) needDuplicateNode.textContent = String(needDuplicateCount);
        if (peerNode) peerNode.textContent = String(peerCount);
        if (peerDuplicateNode) peerDuplicateNode.textContent = String(peerDuplicateCount);
        if (diffNode)
          diffNode.textContent = String(
            needCount + needDuplicateCount - peerCount - peerDuplicateCount,
          );
      };
      needList.onchange = refresh;
      needDuplicateList.onchange = refresh;
      peerList.onchange = refresh;
      peerDuplicateList.onchange = refresh;
      refresh();
      const cancel = document.getElementById('share-exchange-cancel') as HTMLButtonElement | null;
      const applyBtn = document.getElementById('share-exchange-apply') as HTMLButtonElement | null;
      const needSection = document.getElementById('share-need-section');
      const needDuplicateSection = document.getElementById('share-need-duplicate-section');
      const peerSection = document.getElementById('share-peer-section');
      const peerDuplicateSection = document.getElementById('share-peer-duplicate-section');
      const diffRow = document.getElementById('share-diff-row');
      const configureExchangeSection = (listId: string): void => {
        const toggle = document.querySelector<HTMLButtonElement>(
          `[data-exchange-section-toggle="${listId}"]`,
        );
        const list = document.getElementById(listId);
        const chevron = document.querySelector<HTMLElement>(
          `[data-exchange-section-chevron="${listId}"]`,
        );
        if (!toggle || !list || !chevron) return;
        toggle.setAttribute('aria-expanded', String(!list.classList.contains('hidden')));
        chevron.textContent = list.classList.contains('hidden') ? 'expand_more' : 'expand_less';
        toggle.onclick = () => {
          const hidden = list.classList.toggle('hidden');
          toggle.setAttribute('aria-expanded', String(!hidden));
          chevron.textContent = hidden ? 'expand_more' : 'expand_less';
        };
      };
      const hasChanges =
        need.length > 0 ||
        needDuplicates.length > 0 ||
        peer.length > 0 ||
        peerDuplicates.length > 0;
      if (!hasChanges) {
        if (needSection) needSection.classList.remove('hidden');
        if (needDuplicateSection) needDuplicateSection.classList.add('hidden');
        if (peerSection) peerSection.classList.add('hidden');
        if (peerDuplicateSection) peerDuplicateSection.classList.add('hidden');
        if (diffRow) diffRow.classList.add('hidden');
        needList.innerHTML = `<p>${t('nothingToExchange')}</p>`;
        needDuplicateList.innerHTML = '';
        peerList.innerHTML = '';
        peerDuplicateList.innerHTML = '';
      } else {
        if (needSection) needSection.classList.toggle('hidden', need.length === 0);
        if (needDuplicateSection)
          needDuplicateSection.classList.toggle('hidden', needDuplicates.length === 0);
        if (peerSection) peerSection.classList.toggle('hidden', peer.length === 0);
        if (peerDuplicateSection)
          peerDuplicateSection.classList.toggle('hidden', peerDuplicates.length === 0);
        if (diffRow) diffRow.classList.remove('hidden');
      }
      [
        'share-need-list',
        'share-need-duplicate-list',
        'share-peer-list',
        'share-peer-duplicate-list',
      ].forEach((listId) => {
        document.getElementById(listId)?.classList.remove('hidden');
        configureExchangeSection(listId);
      });
      if (cancel) cancel.textContent = hasChanges ? t('cancel') : t('dismiss');
      if (applyBtn) applyBtn.classList.toggle('hidden', !hasChanges);
      if (cancel)
        cancel.onclick = () => {
          lockedShareRoute = null;
          setTab('share');
        };
      if (applyBtn)
        applyBtn.onclick = () => {
          const taken: number[] = [];
          const given: number[] = [];
          needList.querySelectorAll<HTMLInputElement>('input[data-need]:checked').forEach((cb) => {
            const serial = Number.parseInt(cb.getAttribute('data-need') ?? '-1', 10);
            if (serial >= 0) {
              receiveSticker(serial);
              taken.push(serial);
            }
          });
          needDuplicateList
            .querySelectorAll<HTMLInputElement>('input[data-need-duplicate]:checked')
            .forEach((cb) => {
              const serial = Number.parseInt(cb.getAttribute('data-need-duplicate') ?? '-1', 10);
              if (serial >= 0) {
                receiveSticker(serial);
                taken.push(serial);
              }
            });
          peerList.querySelectorAll<HTMLInputElement>('input[data-peer]:checked').forEach((cb) => {
            const serial = Number.parseInt(cb.getAttribute('data-peer') ?? '-1', 10);
            if (serial < 0) return;
            giveSticker(serial);
            given.push(serial);
          });
          peerDuplicateList
            .querySelectorAll<HTMLInputElement>('input[data-peer-duplicate]:checked')
            .forEach((cb) => {
              const serial = Number.parseInt(cb.getAttribute('data-peer-duplicate') ?? '-1', 10);
              if (serial < 0) return;
              giveSticker(serial);
              given.push(serial);
            });
          save();
          void (async () => {
            const params = new URLSearchParams();
            params.set('spec', state.data.spec);
            params.set('name', state.cfg.albumName);
            params.set(
              'taken',
              await encodeSerials(
                taken.sort((a, b) => a - b),
                maxSerial,
              ),
            );
            params.set(
              'given',
              await encodeSerials(
                given.sort((a, b) => a - b),
                maxSerial,
              ),
            );
            lockedShareRoute = null;
            location.hash = `share/exchange-sendback?${params.toString()}`;
          })();
        };
    })();
  };
  const openShareExchangedReceive = (query: URLSearchParams): void => {
    document.getElementById('share-exchange-list-screen')?.classList.add('hidden');
    document.getElementById('share-export-list-screen')?.classList.add('hidden');
    document.getElementById('share-receive-screen')?.classList.add('hidden');
    document.getElementById('share-exchange-sendback-screen')?.classList.add('hidden');
    const screen = document.getElementById('share-exchanged-receive-screen');
    const takenList = document.getElementById('share-exchanged-taken-list');
    const givenList = document.getElementById('share-exchanged-given-list');
    const sourceName = document.getElementById('share-exchanged-source-name');
    if (!screen || !takenList || !givenList) return;
    screen.classList.remove('hidden');
    if (sourceName) sourceName.textContent = query.get('name') || t('unknownAlbumName');
    void (async () => {
      try {
        const spec = query.get('spec') ?? '';
        if (spec && spec !== state.data.spec) {
          alert(t('alertSpecMismatch'));
          lockedShareRoute = null;
          setTab('share');
          return;
        }
        const taken = (
          query.get('taken') ? await decodeSerials(query.get('taken') ?? '', maxSerial) : []
        ).sort((a, b) => a - b);
        const given = (
          query.get('given') ? await decodeSerials(query.get('given') ?? '', maxSerial) : []
        ).sort((a, b) => a - b);
        const render = (target: HTMLElement, attr: string, serials: number[]): void => {
          target.innerHTML = serials
            .map((serial) => {
              const ref = runtime.byNumber(serial);
              if (!ref) return '';
              return `<label class="share-change"><input type="checkbox" ${attr}="${serial}" checked/> ${stickerLabelText(ref, locale)}</label>`;
            })
            .join('');
        };
        render(takenList, 'data-taken', taken);
        render(givenList, 'data-given', given);
        const takenNode = document.getElementById('share-exchanged-taken-count');
        const givenNode = document.getElementById('share-exchanged-given-count');
        if (takenNode) takenNode.textContent = String(taken.length);
        if (givenNode) givenNode.textContent = String(given.length);
        const cancel = document.getElementById(
          'share-exchanged-cancel',
        ) as HTMLButtonElement | null;
        const applyBtn = document.getElementById(
          'share-exchanged-apply',
        ) as HTMLButtonElement | null;
        if (cancel)
          cancel.onclick = () => {
            lockedShareRoute = null;
            setTab('share');
          };
        if (applyBtn)
          applyBtn.onclick = () => {
            takenList
              .querySelectorAll<HTMLInputElement>('input[data-taken]:checked')
              .forEach((cb) => {
                const serial = Number.parseInt(cb.getAttribute('data-taken') ?? '-1', 10);
                if (serial < 0) return;
                const next = Math.max(0, dupCount(serial) - 1);
                if (next === 0) state.data.duplicates.delete(serial);
                else state.data.duplicates.set(serial, next);
              });
            givenList
              .querySelectorAll<HTMLInputElement>('input[data-given]:checked')
              .forEach((cb) => {
                const serial = Number.parseInt(cb.getAttribute('data-given') ?? '-1', 10);
                if (serial < 0) return;
                if (isOwned(serial)) {
                  const next = dupCount(serial) + 1;
                  state.data.duplicates.set(serial, next);
                } else {
                  state.data.owned.add(serial);
                }
              });
            save();
            lockedShareRoute = null;
            setTab('album');
          };
      } catch {
        alert(t('alertPasteInvalidUrl'));
        lockedShareRoute = null;
        setTab('share');
      }
    })();
  };
  const openShareExchangeSendback = (query: URLSearchParams): void => {
    const screen = document.getElementById('share-exchange-sendback-screen');
    if (!screen) return;
    screen.classList.remove('hidden');
    const closeBtn = document.getElementById(
      'share-exchanged-sendback-close',
    ) as HTMLButtonElement | null;
    if (closeBtn)
      closeBtn.onclick = () => {
        screen.classList.add('hidden');
        lockedShareRoute = null;
        setTab('album');
      };
    void (async () => {
      let taken: number[] = [];
      let given: number[] = [];
      try {
        taken = query.get('taken') ? await decodeSerials(query.get('taken') ?? '', maxSerial) : [];
        given = query.get('given') ? await decodeSerials(query.get('given') ?? '', maxSerial) : [];
      } catch {
        alert(t('alertPasteInvalidUrl'));
      }
      const takenText = formatTextStickerList(textEntries(), taken);
      const givenText = formatTextStickerList(textEntries(), given);
      const takenArea = document.getElementById(
        'share-exchanged-taken-text',
      ) as HTMLTextAreaElement | null;
      const givenArea = document.getElementById(
        'share-exchanged-given-text',
      ) as HTMLTextAreaElement | null;
      if (takenArea) takenArea.value = takenText;
      if (givenArea) givenArea.value = givenText;
      const bindText = (
        prefix: string,
        getText: () => string,
        channel: 'sms' | 'whatsapp' | 'clipboard',
      ): void => {
        const button = document.getElementById(`${prefix}-${channel}`) as HTMLButtonElement | null;
        if (button) button.onclick = () => void sendPlainTextBy(getText(), channel);
      };
      bindText('share-exchanged-taken', () => takenArea?.value ?? takenText, 'sms');
      bindText('share-exchanged-taken', () => takenArea?.value ?? takenText, 'whatsapp');
      bindText('share-exchanged-taken', () => takenArea?.value ?? takenText, 'clipboard');
      bindText('share-exchanged-given', () => givenArea?.value ?? givenText, 'sms');
      bindText('share-exchanged-given', () => givenArea?.value ?? givenText, 'whatsapp');
      bindText('share-exchanged-given', () => givenArea?.value ?? givenText, 'clipboard');
    })();
  };
  const openShareTextExchange = (): void => {
    const screen = document.getElementById('share-text-exchange-screen');
    const missingArea = document.getElementById('share-text-need') as HTMLTextAreaElement | null;
    const duplicateArea = document.getElementById(
      'share-text-duplicates',
    ) as HTMLTextAreaElement | null;
    if (!screen || !missingArea || !duplicateArea) return;
    screen.classList.remove('hidden');
    const blocks = exchangeTextBlocks();
    missingArea.value = blocks.missing;
    duplicateArea.value = blocks.duplicates;
    const closeBtn = document.getElementById(
      'share-text-exchange-close',
    ) as HTMLButtonElement | null;
    if (closeBtn)
      closeBtn.onclick = () => {
        lockedShareRoute = null;
        setTab('share');
      };
    const bindText = (
      prefix: string,
      getText: () => string,
      channel: 'sms' | 'whatsapp' | 'clipboard',
    ): void => {
      const button = document.getElementById(`${prefix}-${channel}`) as HTMLButtonElement | null;
      if (button) button.onclick = () => void sendPlainTextBy(getText(), channel);
    };
    bindText('share-text-need', () => missingArea.value, 'sms');
    bindText('share-text-need', () => missingArea.value, 'whatsapp');
    bindText('share-text-need', () => missingArea.value, 'clipboard');
    bindText('share-text-duplicates', () => duplicateArea.value, 'sms');
    bindText('share-text-duplicates', () => duplicateArea.value, 'whatsapp');
    bindText('share-text-duplicates', () => duplicateArea.value, 'clipboard');
  };
  const openShareTextPaste = (): void => {
    const screen = document.getElementById('share-text-paste-screen');
    const missingArea = document.getElementById(
      'share-text-paste-need',
    ) as HTMLTextAreaElement | null;
    const duplicateArea = document.getElementById(
      'share-text-paste-duplicates',
    ) as HTMLTextAreaElement | null;
    if (!screen || !missingArea || !duplicateArea) return;
    screen.classList.remove('hidden');
    const closeBtn = document.getElementById('share-text-paste-cancel') as HTMLButtonElement | null;
    const applyBtn = document.getElementById('share-text-paste-apply') as HTMLButtonElement | null;
    const pasteNeed = document.getElementById(
      'share-text-paste-need-clipboard',
    ) as HTMLButtonElement | null;
    const pasteDuplicates = document.getElementById(
      'share-text-paste-duplicates-clipboard',
    ) as HTMLButtonElement | null;
    if (closeBtn)
      closeBtn.onclick = () => {
        lockedShareRoute = null;
        setTab('share');
      };
    if (pasteNeed)
      pasteNeed.onclick = async () => {
        try {
          missingArea.value = await readClipboardText();
        } catch (error) {
          alert(`${t('alertPasteFailed')} (${clipboardErrorDetails(error)})`);
        }
      };
    if (pasteDuplicates)
      pasteDuplicates.onclick = async () => {
        try {
          duplicateArea.value = await readClipboardText();
        } catch (error) {
          alert(`${t('alertPasteFailed')} (${clipboardErrorDetails(error)})`);
        }
      };
    if (applyBtn)
      applyBtn.onclick = async () => {
        const params = new URLSearchParams();
        params.set('spec', state.data.spec);
        params.set('name', t('unknownAlbumName'));
        params.set(
          'missing',
          await encodeSerials(parseTextStickerList(textEntries(), missingArea.value), maxSerial),
        );
        params.set(
          'duplicates',
          await encodeSerials(parseTextStickerList(textEntries(), duplicateArea.value), maxSerial),
        );
        lockedShareRoute = null;
        location.hash = `share/receive?${params.toString()}`;
      };
  };
  const openShareTextSendbackPaste = (): void => {
    const screen = document.getElementById('share-text-sendback-paste-screen');
    const takenArea = document.getElementById(
      'share-text-paste-taken',
    ) as HTMLTextAreaElement | null;
    const givenArea = document.getElementById(
      'share-text-paste-given',
    ) as HTMLTextAreaElement | null;
    if (!screen || !takenArea || !givenArea) return;
    screen.classList.remove('hidden');
    const closeBtn = document.getElementById(
      'share-text-sendback-paste-cancel',
    ) as HTMLButtonElement | null;
    const applyBtn = document.getElementById(
      'share-text-sendback-paste-apply',
    ) as HTMLButtonElement | null;
    if (closeBtn)
      closeBtn.onclick = () => {
        lockedShareRoute = null;
        setTab('share');
      };
    if (applyBtn)
      applyBtn.onclick = async () => {
        const params = new URLSearchParams();
        params.set('spec', state.data.spec);
        params.set('name', t('unknownAlbumName'));
        params.set(
          'taken',
          await encodeSerials(parseTextStickerList(textEntries(), takenArea.value), maxSerial),
        );
        params.set(
          'given',
          await encodeSerials(parseTextStickerList(textEntries(), givenArea.value), maxSerial),
        );
        lockedShareRoute = null;
        location.hash = `share/exchanged?${params.toString()}`;
      };
  };
  const openShareQrCode = (query: URLSearchParams): void => {
    const screen = document.getElementById('share-qrcode-screen');
    const content = document.getElementById('share-qrcode-content');
    const closeBtn = document.getElementById('share-qrcode-dismiss') as HTMLButtonElement | null;
    if (!screen || !content) return;
    screen.classList.remove('hidden');
    content.innerHTML = '';
    const url = query.get('url') ?? '';
    if (!url) {
      content.innerHTML = `<p>${t('alertPasteInvalidUrl')}</p>`;
    } else {
      const canvas = document.createElement('canvas');
      void QRCode.toCanvas(canvas, url, {
        errorCorrectionLevel: 'L',
        margin: 1,
        width: 320,
      });
      content.appendChild(canvas);
    }
    if (closeBtn)
      closeBtn.onclick = () => {
        lockedShareRoute = null;
        setTab('share');
      };
  };
  const routeHandlers: Record<
    string,
    (context: RouteRuntimeContext, query: URLSearchParams) => void
  > = {
    handleExchangeReceive,
    handleExchangedReceive,
    handleExchangeSendback,
    handleShareQrCode,
    handleShareTextExchange,
    handleShareTextPaste,
    handleShareTextSendbackPaste,
  };
  const showPrintRoute = (): void => {
    tabIds.forEach((id) => {
      document.getElementById(`tab-${id}`)?.classList.add('hidden');
      document.querySelector(`button[data-tab="${id}"]`)?.classList.remove('active');
    });
    document.getElementById('tab-print')?.classList.remove('hidden');
    apply();
  };
  const applyTabFromHash = (): void => {
    const raw = location.hash.replace(/^#/, '');
    const [fragmentPath = '', fragmentQuery = ''] = raw.split('?', 2);
    if (lockedShareRoute && fragmentPath !== lockedShareRoute) {
      location.hash = lockedShareRoute;
      return;
    }
    const hideAllShareScreens = (): void => {
      [
        'share-exchange-list-screen',
        'share-export-list-screen',
        'share-receive-screen',
        'share-exchange-sendback-screen',
        'share-exchanged-receive-screen',
        'share-qrcode-screen',
        'share-text-exchange-screen',
        'share-text-paste-screen',
        'share-text-sendback-paste-screen',
      ].forEach((id) => {
        document.getElementById(id)?.classList.add('hidden');
      });
      ['exchange-list', 'export-list'].forEach((route) => {
        const chevron = document.querySelector(
          `[data-share-chevron="${route}"]`,
        ) as HTMLElement | null;
        if (chevron) chevron.textContent = 'expand_more';
      });
    };
    const showShareScreen = (id: string): void => {
      hideAllShareScreens();
      document.getElementById(id)?.classList.remove('hidden');
      const openRoute = id.replace('share-', '').replace('-screen', '').replace('-list', '-list');
      ['exchange-list', 'export-list'].forEach((route) => {
        const chevron = document.querySelector(
          `[data-share-chevron="${route}"]`,
        ) as HTMLElement | null;
        if (chevron) chevron.textContent = route === openRoute ? 'expand_less' : 'expand_more';
      });
    };
    const routeElement = document.querySelector<HTMLElement>(`[data-route-path="${fragmentPath}"]`);
    const routeHandlerName = routeElement?.getAttribute('data-route-handler') ?? '';
    const routeHandler = routeHandlers[routeHandlerName];
    if (fragmentPath === 'print') {
      showPrintRoute();
      if (!didAutoPrint && !isPreparingNativePrint) {
        didAutoPrint = true;
        setTimeout(() => window.print(), 0);
      }
      return;
    }
    document.getElementById('tab-print')?.classList.add('hidden');
    if (routeElement && routeHandler) {
      routeHandler(
        {
          path: fragmentPath,
          lock: routeElement.getAttribute('data-route-lock') === 'true',
          showShareScreen,
          setTab,
          lockRoute: (path) => {
            lockedShareRoute = path;
          },
          openShareExchangeReceive,
          openShareExchangedReceive,
          openShareExchangeSendback,
          openShareQrCode,
          openShareTextExchange,
          openShareTextPaste,
          openShareTextSendbackPaste,
        },
        new URLSearchParams(fragmentQuery),
      );
      return;
    }
    lockedShareRoute = null;
    const tabToken = fragmentPath.split('/')[0] as TabId;
    if (validTabs.has(tabToken)) {
      setTab(tabToken, false);
      if (tabToken === 'share') {
        const shareRoute = fragmentPath.split('/')[1] ?? '';
        if (shareRoute === 'exchange-list') showShareScreen('share-exchange-list-screen');
        else if (shareRoute === 'export-list') showShareScreen('share-export-list-screen');
        else hideAllShareScreens();
      }
    } else setTab(defaultTab, true);
  };
  window.addEventListener('hashchange', applyTabFromHash);

  window.addEventListener('beforeprint', () => {
    const currentHash = location.hash;
    const currentPath = currentHash.replace(/^#/, '').split('?', 2)[0] ?? '';
    if (currentPath !== 'print') {
      isPreparingNativePrint = true;
      hashBeforeNativePrint = currentHash;
      location.hash = 'print';
    }
    showPrintRoute();
  });

  window.addEventListener('afterprint', () => {
    if (!isPreparingNativePrint) return;
    isPreparingNativePrint = false;
    const restoreHash = hashBeforeNativePrint;
    hashBeforeNativePrint = null;
    if (restoreHash) location.hash = restoreHash;
    else {
      document.getElementById('tab-print')?.classList.add('hidden');
      setTab(state.tab, false);
    }
  });

  const apply = (): void => {
    const active = document.activeElement as HTMLInputElement | null;
    const activeId = active?.id ?? '';
    const caret = active?.selectionStart ?? null;
    const total = runtime.serials.length;
    const owned = state.data.owned.size;
    const remaining = Math.max(0, total - owned);
    const pct = total ? Math.round((owned / total) * 100) : 0;
    const needle = normalizeText(state.search);

    const totalNode = document.getElementById('current-total');
    const pctNode = document.getElementById('current-percentage');
    const remainingNode = document.getElementById('current-remaining');
    const dupTotalNode = document.getElementById('duplicates-total');
    const totalDuplicates = Array.from(state.data.duplicates.values()).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (totalNode) totalNode.textContent = String(owned);
    if (pctNode) pctNode.textContent = `${pct}%`;
    if (remainingNode) remainingNode.textContent = String(remaining);
    if (dupTotalNode) dupTotalNode.textContent = String(totalDuplicates);

    const printTimestampNode = document.getElementById('print-generated-at');
    const printAlbumNameNode = document.getElementById('print-album-name');
    const printTableNode = document.getElementById('print-table');
    if (printTimestampNode) printTimestampNode.textContent = formatPrintTimestamp(locale);
    if (printAlbumNameNode) printAlbumNameNode.textContent = state.cfg.albumName;
    if (printTableNode) {
      const maxVisibleItemsLength = runtime.spec.sections.reduce(
        (acc, section) =>
          section.items.reduce((acc2, group) => Math.max(acc2, group.items.length), acc),
        0,
      );

      const sectionRows = runtime.spec.sections.map((section) => {
        const useSectionLabel = section.items.length > 1;
        const groupRows = section.items
          .map((group) => {
            const visibleItems = group.items.map((item) => {
              const normalized = normalizeStickerCode(`${group.id}-${item.id}`);
              const serial = runtime.serialByCode.get(normalized);
              if (typeof serial !== 'number') return null;
              const ownedFlag = isOwned(serial);
              return {
                id: item.id,
                hidden: state.cfg.hideOwned && ownedFlag,
                owned: ownedFlag,
              };
            });
            return { group, visibleItems };
          })
          .filter(({ visibleItems }) => visibleItems.some((item) => item !== null));
        if (groupRows.length === 0) return '';
        return groupRows
          .map(({ group, visibleItems }, index) => {
            const isGroupCompleted = visibleItems.every((item) => Boolean(item?.owned));
            const rowClass = state.cfg.hideCompleted && isGroupCompleted ? 'print-completed' : '';
            const cells = visibleItems
              .map((item) => {
                if (!item) return '';
                const classes = ['print-cell'];
                if (item.hidden) classes.push('print-cell-hidden');
                if (item.owned) classes.push('print-cell-owned');
                return `<td class="${classes.join(' ')}">${item.id}</td>`;
              })
              .join('');
            const sectionCell =
              useSectionLabel && index === 0
                ? `<th class="print-section-cell" rowspan="${groupRows.length}"><span>${resolveName(section.name, locale)}</span></th>`
                : '';
            const groupCell = useSectionLabel
              ? `<th class="print-group-cell">${group.id}</th>`
              : `<th class="print-group-cell print-group-cell-double" colspan="2">${group.id}</th>`;
            const fillerLength = maxVisibleItemsLength - visibleItems.length;
            const fillerCell =
              fillerLength > 0 ? `<td class="print-filler" colspan="${fillerLength}" ></td>` : '';
            return `<tr class="${rowClass}">${sectionCell}${groupCell}${cells}${fillerCell}${groupCell}${sectionCell}</tr>`;
          })
          .join('');
      });
      printTableNode.innerHTML = sectionRows
        .filter((row) => row.length > 0)
        .map((row) => `<tbody class="print-section-block">${row}</tbody>`)
        .join('');
    }

    const byRoot = (root: string): HTMLElement[] =>
      Array.from(document.querySelectorAll(`${root} .group`));
    const refreshRoot = (root: '#album-groups' | '#dup-groups', dupMode: boolean): void => {
      const groups = byRoot(root);
      let allCollapsed = true;
      let allExpanded = groups.length > 0;
      groups.forEach((groupEl) => {
        const key = groupEl.getAttribute('data-group-key') ?? '';
        const groupId = groupEl.getAttribute('data-group-id') ?? '';
        const scopedId = groupEl.getAttribute('data-group-scoped-id') ?? '';
        const groupName = groupEl.getAttribute('data-group-name') ?? '';
        const groupColor = groupEl.getAttribute('data-group-color') ?? '';
        const groupIdNode = groupEl.querySelector<HTMLElement>('.group-id');
        if (groupIdNode) groupIdNode.style.color = groupColor || 'var(--primary, #000)';
        const groupMatches =
          needle.length === 0 ||
          normalizeText(groupId).startsWith(needle) ||
          normalizeText(groupName).startsWith(needle);

        const items = Array.from(groupEl.querySelectorAll<HTMLElement>('.item'));
        let visibleCount = 0;
        let ownedCount = 0;
        let dupTotal = 0;
        let allCount = 0;
        let allOwnedCount = 0;
        items.forEach((itemEl) => {
          const toggle = itemEl.querySelector<HTMLElement>(
            '.item-toggle[data-serial], .item-label[data-serial]',
          );
          const serial = Number.parseInt(toggle?.getAttribute('data-serial') ?? '-1', 10);
          if (serial < 0) return;
          const ref = runtime.byNumber(serial);
          if (!ref) return;
          const itemMatches =
            needle.length === 0 ||
            normalizeStickerCode(`${ref.group.id}-${ref.item.id}`).toUpperCase().includes(needle) ||
            normalizeText(resolveName(ref.item.name, locale)).includes(needle);
          const ownedFlag = isOwned(serial);
          const dup = dupCount(serial);
          allCount += 1;
          if (ownedFlag) allOwnedCount += 1;
          const visible =
            groupMatches &&
            itemMatches &&
            (dupMode ? !state.cfg.hideOwned || ownedFlag : !state.cfg.hideOwned || !ownedFlag);
          itemEl.classList.toggle('hidden', !visible);
          toggle?.classList.toggle('owned', ownedFlag);
          if (state.cfg.showDup && dup > 0)
            itemEl.querySelector('[data-dup-badge="1"]')?.classList.remove('hidden');
          else itemEl.querySelector('[data-dup-badge="1"]')?.classList.add('hidden');
          if (dupMode) itemEl.querySelector('[data-dup-badge="1"]')?.classList.add('hidden');
          const badge = itemEl.querySelector('[data-dup-badge="1"]');
          if (badge) badge.textContent = String(dup);
          const counter = itemEl.querySelector('[data-dup-count="1"]');
          if (counter) {
            counter.textContent = String(dup);
            counter.classList.toggle('dup-count-zero', dup === 0);
          }
          const decBtn = itemEl.querySelector<HTMLButtonElement>('button[data-op="dec"]');
          if (decBtn) decBtn.disabled = dup === 0;
          if (visible) {
            visibleCount += 1;
            if (ownedFlag) ownedCount += 1;
            dupTotal += dup;
          }
        });

        const expanded = state.expanded.has(key);
        groupEl.querySelector('.grid')?.classList.toggle('hidden', !expanded);
        if (expanded) allCollapsed = false;
        else allExpanded = false;

        const groupCompleted = allCount > 0 && allOwnedCount === allCount;
        groupEl.classList.toggle('completed', !dupMode && groupCompleted);
        const hideGroup = dupMode
          ? !groupMatches || visibleCount === 0
          : !groupMatches ||
            visibleCount === 0 ||
            (state.cfg.hideCompleted && visibleCount > 0 && ownedCount === visibleCount);
        groupEl.classList.toggle('hidden', hideGroup);

        if (!dupMode) {
          const albumCurrent = document.getElementById(`album-${scopedId}-current-total`);
          if (albumCurrent) albumCurrent.textContent = String(ownedCount);
        } else {
          const dupCurrent = document.getElementById(`duplicates-${scopedId}-current-total`);
          if (dupCurrent) dupCurrent.textContent = String(dupTotal);
        }

        void dupMode;
      });

      const collapseAll = document.getElementById(
        root === '#album-groups' ? 'collapse-all' : 'collapse-all-dups',
      ) as HTMLButtonElement | null;
      const expandAll = document.getElementById(
        root === '#album-groups' ? 'expand-all' : 'expand-all-dups',
      ) as HTMLButtonElement | null;
      if (collapseAll) collapseAll.disabled = allCollapsed;
      if (expandAll) expandAll.disabled = allExpanded;

      const host = document.querySelector(root);
      if (host)
        Array.from(host.querySelectorAll<HTMLElement>('.group'))
          .sort((a, b) => {
            if (state.cfg.sort === 'alpha') {
              return (a.getAttribute('data-group-id') ?? '').localeCompare(
                b.getAttribute('data-group-id') ?? '',
              );
            }
            return (
              Number(a.getAttribute('data-group-order') ?? '0') -
              Number(b.getAttribute('data-group-order') ?? '0')
            );
          })
          .forEach((el) => {
            host.appendChild(el);
          });
    };

    refreshRoot('#album-groups', false);
    refreshRoot('#dup-groups', true);

    const serial = runtime.serialByCode.get(normalizeStickerCode(state.quick));
    const help = document.getElementById('quick-help');
    const quickEntry = document.getElementById('quick-entry');
    const quickToggle = document.getElementById('quick-toggle') as HTMLButtonElement | null;
    const quickSectionName = document.getElementById('quick-section-name');
    const quickStickerGroupId = document.getElementById('quick-group-id');
    const quickStickerGroupName = document.getElementById('quick-group-name');
    const quickStickerName = document.getElementById('quick-sticker-name');
    const quickEditor = document.getElementById('quick-dup-editor');
    const quickDupCount = document.getElementById('quick-dup-count');
    const quickDec = quickEditor?.querySelector(
      'button[data-op="dec"]',
    ) as HTMLButtonElement | null;
    const quickInc = quickEditor?.querySelector(
      'button[data-op="inc"]',
    ) as HTMLButtonElement | null;
    if (typeof serial !== 'number') {
      help?.classList.remove('hidden');
      quickEntry?.classList.add('hidden');
    } else {
      const ref = runtime.byNumber(serial);
      if (ref) {
        const displayCode = `${ref.group.id}-${ref.item.id}`;
        help?.classList.add('hidden');
        if (quickToggle) {
          quickEntry?.classList.remove('hidden');
          quickToggle.classList.toggle('owned', isOwned(serial));
          quickToggle.setAttribute('data-serial', String(serial));
          quickToggle.style.setProperty(
            '--quick-section-color',
            ref.section.color ?? 'var(--primary, #000)',
          );
          quickToggle.style.setProperty(
            '--quick-group-color',
            ref.group.color ?? ref.section.color ?? 'var(--primary, #000)',
          );
          if (quickSectionName)
            quickSectionName.textContent = resolveName(ref.section.name, locale);
          if (quickStickerGroupId) quickStickerGroupId.textContent = displayCode;
          if (
            quickStickerGroupName &&
            resolveName(ref.section.name, locale) !== resolveName(ref.group.name, locale)
          )
            quickStickerGroupName.textContent = resolveName(ref.group.name, locale);
          if (quickStickerName) quickStickerName.textContent = resolveName(ref.item.name, locale);
        }
        if (quickDupCount) {
          const duplicateCount = dupCount(serial);
          quickDupCount.textContent = String(duplicateCount);
          quickDupCount.classList.toggle('dup-count-zero', duplicateCount === 0);
        }
        if (quickDec) quickDec.setAttribute('data-serial', String(serial));
        if (quickInc) quickInc.setAttribute('data-serial', String(serial));
        if (quickDec) quickDec.disabled = dupCount(serial) === 0;
      }
    }

    const search = document.getElementById('search-input') as HTMLInputElement | null;
    const searchD = document.getElementById('search-dups') as HTMLInputElement | null;
    if (search && search.value !== state.search) search.value = state.search;
    if (searchD && searchD.value !== state.search) searchD.value = state.search;

    wire();
    if (activeId) {
      const next = document.getElementById(activeId) as HTMLInputElement | null;
      if (next) {
        next.focus();
        if (caret !== null) next.setSelectionRange(caret, caret);
      }
    }
  };

  const wire = (): void => {
    document.querySelectorAll<HTMLButtonElement>('[data-expand]').forEach((b) => {
      b.onclick = () => {
        const k = b.getAttribute('data-expand') ?? '';
        if (state.expanded.has(k)) state.expanded.delete(k);
        else state.expanded.add(k);
        apply();
      };
    });
    document
      .querySelectorAll<HTMLButtonElement>(
        '#tab-album .item-toggle[data-serial], [data-quick-toggle="1"]',
      )
      .forEach((b) => {
        b.onclick = () => {
          const inDuplicatesTab = Boolean(b.closest('#tab-duplicates'));
          if (inDuplicatesTab) return;
          const serial = Number.parseInt(b.getAttribute('data-serial') ?? '-1', 10);
          if (serial < 0) return;
          if (state.data.owned.has(serial)) {
            if (dupCount(serial) > 0) {
              alert(t('alertRemoveDuplicatesFirst'));
              return;
            }
            state.data.owned.delete(serial);
          } else state.data.owned.add(serial);
          save();
          apply();
        };
      });
    document.querySelectorAll<HTMLButtonElement>('button[data-op]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        const serial = Number.parseInt(b.getAttribute('data-serial') ?? '-1', 10);
        if (serial < 0) return;
        const op = b.getAttribute('data-op');
        if (op === 'dec' && dupCount(serial) === 0) return;
        if (op === 'inc' && !isOwned(serial)) {
          if (confirm(t('confirmAddOwnedInstead'))) {
            state.data.owned.add(serial);
            save();
            apply();
          }
          return;
        }
        const next = Math.max(0, dupCount(serial) + (op === 'inc' ? 1 : -1));
        if (next === 0) state.data.duplicates.delete(serial);
        else state.data.duplicates.set(serial, next);
        save();
        apply();
      };
    });
    const search = document.getElementById('search-input') as HTMLInputElement | null;
    if (search)
      search.oninput = () => {
        state.search = search.value;
        apply();
      };
    const searchD = document.getElementById('search-dups') as HTMLInputElement | null;
    if (searchD)
      searchD.oninput = () => {
        state.search = searchD.value;
        apply();
      };
    const quick = document.getElementById('quick-input') as HTMLInputElement | null;
    if (quick)
      quick.oninput = (event) => {
        const inputEvent = event as InputEvent;
        const prev = state.quick;
        const nextRaw = normalizeCodeInput(quick.value);
        const hadDash = nextRaw.includes('-');
        const [rawGroup, rawItemPart = ''] = nextRaw.split('-', 2);
        const typedGroup = (rawGroup ?? '').replace(/[^A-Z]/g, '').slice(0, 3);
        let rest = rawItemPart.replace(/[^0-9]/g, '');
        const groups = runtime.spec.sections
          .flatMap((section) => section.items)
          .map((g) => g.id.toUpperCase());
        let base = typedGroup;

        const deletingDashFromCompletedGroup =
          inputEvent.inputType === 'deleteContentBackward' &&
          prev.length === 3 &&
          prev === typedGroup &&
          !hadDash &&
          rest.length === 0;
        if (deletingDashFromCompletedGroup) {
          base = collapseAutocompletePrefix(base, groups);
        }

        const baseMatches = groups.filter((id) => id.startsWith(base));
        if (base && baseMatches.length === 0) {
          const prevGroup = prev.split('-', 1)[0] ?? '';
          quick.value = prevGroup.length === 3 ? `${prevGroup}-` : prevGroup;
          return;
        }
        if (base.length >= 1 && baseMatches.length === 1) {
          const onlyGroup = baseMatches[0];
          if (onlyGroup && onlyGroup.length === 3) base = onlyGroup;
        }

        const groupExact = groups.includes(base);
        if (groupExact && rest.length > 0) {
          const matchingGroups = runtime.spec.sections
            .flatMap((section) => section.items)
            .filter((g) => g.id.toUpperCase() === base);
          if (matchingGroups.length === 0) {
            quick.value = prev;
            return;
          }
          const itemMatches = matchingGroups
            .flatMap((g) => g.items.map((i) => i.id.toUpperCase()))
            .filter((id) => id.startsWith(rest));
          if (itemMatches.length === 0) {
            quick.value = `${base}-`;
            return;
          }
          if (itemMatches.length === 1) {
            const onlyItem = itemMatches[0];
            if (onlyItem) rest = onlyItem;
          }
        }

        state.quick = rest.length > 0 ? `${base}-${rest}` : base;
        const visualGroupDone = base.length === 3;
        if (!visualGroupDone) quick.value = base;
        else if (rest.length > 0) quick.value = `${base}-${rest}`;
        else quick.value = deletingDashFromCompletedGroup ? base : `${base}-`;
        apply();
      };
    const quickClear = document.getElementById('quick-clear') as HTMLButtonElement | null;
    if (quickClear)
      quickClear.onclick = () => {
        state.quick = '';
        const input = document.getElementById('quick-input') as HTMLInputElement | null;
        if (input) input.value = '';
        apply();
        input?.focus();
      };
    const collapseAll = document.getElementById('collapse-all') as HTMLButtonElement | null;
    if (collapseAll)
      collapseAll.onclick = () => {
        state.expanded.clear();
        apply();
      };
    const expandAll = document.getElementById('expand-all') as HTMLButtonElement | null;
    if (expandAll)
      expandAll.onclick = () => {
        document.querySelectorAll<HTMLElement>('#album-groups .group:not(.hidden)').forEach((g) => {
          state.expanded.add(g.getAttribute('data-group-key') ?? '');
        });
        apply();
      };
    const collapseAllDups = document.getElementById(
      'collapse-all-dups',
    ) as HTMLButtonElement | null;
    if (collapseAllDups)
      collapseAllDups.onclick = () => {
        state.expanded.clear();
        apply();
      };
    const expandAllDups = document.getElementById('expand-all-dups') as HTMLButtonElement | null;
    if (expandAllDups)
      expandAllDups.onclick = () => {
        document.querySelectorAll<HTMLElement>('#dup-groups .group:not(.hidden)').forEach((g) => {
          state.expanded.add(g.getAttribute('data-group-key') ?? '');
        });
        apply();
      };
    const sort = document.getElementById('cfg-sort') as HTMLSelectElement | null;
    if (sort) {
      sort.value = state.cfg.sort;
      sort.onchange = () => {
        state.cfg.sort = sort.value as 'spec' | 'alpha';
        saveCfg();
        apply();
      };
    }
    const chk = (id: string, key: keyof Omit<Cfg, 'sort' | 'albumName'>): void => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (!el) return;
      el.checked = state.cfg[key];
      el.onchange = () => {
        state.cfg[key] = el.checked;
        saveCfg();
        apply();
      };
    };
    chk('cfg-hide-owned', 'hideOwned');
    chk('cfg-hide-complete', 'hideCompleted');
    chk('cfg-show-dup', 'showDup');
    const cfgName = document.getElementById('cfg-name') as HTMLInputElement | null;
    if (cfgName) {
      cfgName.value = state.cfg.albumName;
      cfgName.onchange = () => {
        const nextName = cfgName.value.trim();
        if (!nextName) {
          cfgName.value = state.cfg.albumName;
          return;
        }
        const prevName = state.cfg.albumName;
        if (nextName === prevName) return;
        localStorage.removeItem(keyFor(state.data.spec, prevName));
        state.cfg.albumName = nextName;
        save();
        saveCfg();
      };
    }
    const resetPersisted = document.getElementById(
      'cfg-reset-persisted',
    ) as HTMLButtonElement | null;
    if (resetPersisted)
      resetPersisted.onclick = () => {
        if (!confirm(t('confirmResetPersistedState'))) return;
        localStorage.removeItem(keyFor(state.data.spec, state.cfg.albumName));
        localStorage.removeItem(cfgKey(state.data.spec));
        const registryKey = 'sticker-collection:v1:registry';
        const rawRegistry = localStorage.getItem(registryKey);
        if (rawRegistry) {
          try {
            const filtered = (
              JSON.parse(rawRegistry) as Array<{ spec: string; name: string }>
            ).filter(
              (entry) => !(entry.spec === state.data.spec && entry.name === state.cfg.albumName),
            );
            localStorage.setItem(registryKey, JSON.stringify(filtered));
          } catch {
            // ignore malformed registry
          }
        }
        state.data = {
          spec: state.data.spec,
          owned: new Set(),
          duplicates: new Map(),
        };
        state.cfg = {
          albumName: state.cfg.albumName,
          sort: 'spec',
          hideOwned: false,
          hideCompleted: false,
          showDup: true,
        };
        state.search = '';
        state.quick = '';
        state.expanded.clear();
        save();
        saveCfg();
        apply();
      };
    const sendBy = async (
      params: URLSearchParams,
      channel: 'sms' | 'whatsapp' | 'clipboard',
    ): Promise<void> => {
      const link = exchangeLink(params);
      if (channel === 'clipboard') {
        let copied = false;
        if (navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(link);
            copied = true;
          } catch (error) {
            // Fall through to legacy iOS-compatible copy path.
            console.warn('clipboard.writeText failed', error);
          }
        }
        if (!copied) {
          const ta = document.createElement('textarea');
          ta.value = link;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          let fallbackError: unknown = null;
          try {
            copied = document.execCommand('copy');
          } catch (error) {
            fallbackError = error;
            copied = false;
          } finally {
            document.body.removeChild(ta);
          }
          if (!copied && fallbackError) {
            alert(`${t('alertCopyFailed')} (${clipboardErrorDetails(fallbackError)})`);
            window.prompt(t('promptCopyManually'), link);
            return;
          }
        }
        if (!copied) {
          alert(t('alertCopyFailed'));
          window.prompt(t('promptCopyManually'), link);
        }
        return;
      }
      const phone = prompt(t('promptPhoneNumber'))?.trim();
      if (!phone) return;
      const encoded = encodeURIComponent(link);
      if (channel === 'sms') location.href = `sms:${phone}?body=${encoded}`;
      else window.open(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encoded}`, '_blank');
    };
    const exportExchangeParams = async (): Promise<URLSearchParams> => {
      const missing = runtime.serials
        .filter(({ serial }) => !isOwned(serial))
        .map(({ serial }) => serial);
      const duplicates = Array.from(state.data.duplicates.entries()).flatMap(([serial, count]) =>
        Array.from({ length: count }, () => serial),
      );
      const params = await exportMissing(state.data.spec, state.cfg.albumName, missing, maxSerial);
      const dupParams = await exportDuplicates(
        state.data.spec,
        state.cfg.albumName,
        duplicates,
        maxSerial,
      );
      dupParams.forEach((value, key) => {
        params.set(key, value);
      });
      return params;
    };
    const bindClick = (id: string, handler: () => void | Promise<void>): void => {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (!el) return;
      el.onclick = () => {
        void handler();
      };
    };
    const bindPaste = (id: string): void => {
      const el = document.getElementById(id) as HTMLButtonElement | null;
      if (!el) return;
      el.onclick = async () => {
        let text: string;
        if (navigator.clipboard?.readText) {
          try {
            text = await navigator.clipboard.readText();
          } catch (error) {
            alert(`${t('alertPasteFailed')} (${clipboardErrorDetails(error)})`);
            return;
          }
        } else {
          const manual = prompt(t('shareLinkPrompt'))?.trim();
          if (!manual) return;
          text = manual;
        }
        const trimmed = text.trim();
        let hash = '';
        try {
          hash = new URL(trimmed).hash;
        } catch {
          hash = trimmed.startsWith('#')
            ? trimmed
            : trimmed.includes('#')
              ? trimmed.slice(trimmed.indexOf('#'))
              : '';
        }
        if (!hash.startsWith('#') || hash.length <= 1) {
          console.log('Error parsing hash:', hash);
          alert(t('alertPasteInvalidUrl'));
          return;
        }
        location.hash = hash.slice(1);
      };
    };
    bindClick('share-exchange-send-sms', async () => sendBy(await exportExchangeParams(), 'sms'));
    bindClick('share-exchange-send-whatsapp', async () =>
      sendBy(await exportExchangeParams(), 'whatsapp'),
    );
    {
      const el = document.getElementById('share-exchange-send-copy') as HTMLButtonElement | null;
      if (el) {
        el.onclick = async () => {
          await sendBy(await exportExchangeParams(), 'clipboard');
        };
      }
    }
    bindPaste('share-exchange-receive-paste');
    bindClick('share-export-printer', async () => {
      const url = `${location.origin}${location.pathname}#print`;
      window.open(url, '_blank', 'noopener,noreferrer');
    });
    bindClick('share-exchange-send-qr', async () => {
      openQrCode(exchangeLink(await exportExchangeParams()));
    });
    bindClick('share-exchange-text-open', () => {
      location.hash = 'share/text-exchange';
    });
    bindClick('share-exchange-text-paste', () => {
      location.hash = 'share/text-paste';
    });
    bindClick('share-exchange-text-sendback-paste', () => {
      location.hash = 'share/text-sendback-paste';
    });
    document.querySelectorAll<HTMLButtonElement>('[data-share-accordion]').forEach((b) => {
      b.onclick = () => {
        const route = b.getAttribute('data-share-accordion');
        if (!route) return;
        const current = location.hash.replace(/^#/, '');
        if (current === `share/${route}`) location.hash = 'share';
        else location.hash = `share/${route}`;
      };
    });
  };

  applyTabFromHash();
}

void boot();
