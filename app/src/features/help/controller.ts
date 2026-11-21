// The state of the Help panel: the page it shows, the history, the contents tree and its filter.
// Plain TypeScript, no React and no DOM, so that it is tested under Node. Owner: H1.
//
// One controller exists per application (per window). The commands of this feature and the panel
// both reach it through `helpControllerOf(ctx)`; neither passes it around.

import type { AppContext } from '../../contracts';
import {
  ENTRY_PAGES,
  ancestorKeys,
  findPage,
  parseSitemap,
  splitTarget,
  titleOfPage,
  type HelpTarget,
  type NodeKey,
  type SitemapNode,
} from '../../core/help';

export interface HelpState {
  /** The page the frame shows (or is about to show). */
  readonly current: HelpTarget;
  /** The pages visited, oldest first; `index` is the one shown. */
  readonly history: readonly HelpTarget[];
  readonly index: number;
  /** Counts navigations. The frame loads `current` again when it changes. */
  readonly navigation: number;
  /** The title of the page: from its own <title> once the frame has loaded it, else the contents'. */
  readonly title: string;
  readonly contentsOpen: boolean;
  /** The contents tree; null until it has been read. */
  readonly contents: readonly SitemapNode[] | null;
  readonly contentsError: string | null;
  readonly filter: string;
  /** Open books of the contents tree. */
  readonly open: ReadonlySet<NodeKey>;
}

type Listener = () => void;

export interface FetchLike {
  (url: string): Promise<{ ok: boolean; status: number; text(): Promise<string> }>;
}

const sameTarget = (a: HelpTarget, b: HelpTarget): boolean => a.page === b.page && a.fragment === b.fragment;

export class HelpController {
  private state: HelpState;
  private readonly listeners = new Set<Listener>();
  private loading: Promise<void> | null = null;
  /** The page that the controller has asked the frame to load and that has not arrived yet. */
  private expected: HelpTarget | null = null;

  /**
   * @param base address of the application's folder, ending in '/' (help pages are below `help/`).
   * @param fetchText how the contents file is read (the global fetch in the browser).
   */
  constructor(
    readonly base: string,
    private readonly fetchText: FetchLike,
  ) {
    const start: HelpTarget = { page: ENTRY_PAGES.contents, fragment: '' };
    this.state = {
      current: start,
      history: [start],
      index: 0,
      navigation: 0,
      title: '',
      contentsOpen: true,
      contents: null,
      contentsError: null,
      filter: '',
      open: new Set(),
    };
  }

  getState = (): HelpState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private update(change: Partial<HelpState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of [...this.listeners]) listener();
  }

  /** The books above the page's entry in the contents are opened, so that the entry is visible. */
  private opened(
    target: HelpTarget,
    contents: readonly SitemapNode[] | null = this.state.contents,
  ): ReadonlySet<NodeKey> {
    const key = contents === null ? null : findPage(contents, target.page);
    if (key === null) return this.state.open;
    return new Set([...this.state.open, ...ancestorKeys(key)]);
  }

  private titleFor(target: HelpTarget): string {
    return this.state.contents === null ? '' : (titleOfPage(this.state.contents, target) ?? '');
  }

  /** Shows a page (a path, or a target) and records it in the history. */
  show(page: HelpTarget | string, options: { contentsOpen?: boolean } = {}): void {
    const target = typeof page === 'string' ? splitTarget(page) : page;
    const { history, index } = this.state;
    const unchanged = sameTarget(history[index]!, target);
    this.expected = target;
    const kept = history.slice(0, index + 1);
    this.update({
      current: target,
      history: unchanged ? history : [...kept, target],
      index: unchanged ? index : kept.length,
      navigation: this.state.navigation + 1,
      title: this.titleFor(target),
      open: this.opened(target),
      ...(options.contentsOpen === undefined ? {} : { contentsOpen: options.contentsOpen }),
    });
  }

  get canGoBack(): boolean {
    return this.state.index > 0;
  }

  get canGoForward(): boolean {
    return this.state.index < this.state.history.length - 1;
  }

  back(): void {
    this.go(-1);
  }

  forward(): void {
    this.go(1);
  }

  private go(step: number): void {
    const index = this.state.index + step;
    const target = this.state.history[index];
    if (!target) return;
    this.expected = target;
    this.update({
      index,
      current: target,
      navigation: this.state.navigation + 1,
      title: this.titleFor(target),
      open: this.opened(target),
    });
  }

  /**
   * The frame finished loading `target`. Three cases:
   *  - the page the controller asked for: only the title is taken;
   *  - a page the controller did not ask for while it is waiting for another one: an older load
   *    arriving late; ignored;
   *  - a page the controller did not ask for, with nothing pending: the user followed a link that
   *    the panel could not intercept (a browser that does not run listeners in a script-less frame,
   *    Safari); it is a new page of the history.
   */
  noteLoaded(target: HelpTarget, title: string): void {
    const { current, history, index } = this.state;
    const expected = this.expected;
    if (expected !== null) {
      if (expected.page !== target.page) return;
      this.expected = null;
    } else if (target.page !== current.page) {
      const kept = history.slice(0, index + 1);
      this.update({
        current: target,
        history: [...kept, target],
        index: kept.length,
        title: title.trim() || this.titleFor(target),
        open: this.opened(target),
      });
      return;
    }
    this.update({ title: title.trim() || this.titleFor(target) });
  }

  toggleContents(): void {
    this.update({ contentsOpen: !this.state.contentsOpen });
  }

  setFilter(filter: string): void {
    this.update({ filter });
  }

  toggleBook(key: NodeKey): void {
    const open = new Set(this.state.open);
    if (!open.delete(key)) open.add(key);
    this.update({ open });
  }

  /** Reads contents.hhc once. */
  ensureContents(): Promise<void> {
    if (this.state.contents !== null) return Promise.resolve();
    this.loading ??= this.fetchText(`${this.base}help/contents.hhc`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contents = parseSitemap(await response.text());
        this.update({
          contents,
          contentsError: null,
          title: this.state.title || (titleOfPage(contents, this.state.current) ?? ''),
          open: this.opened(this.state.current, contents),
        });
      })
      .catch((error: unknown) => {
        this.loading = null;
        this.update({ contentsError: error instanceof Error ? error.message : String(error) });
      });
    return this.loading;
  }
}

const controllers = new WeakMap<AppContext, HelpController>();

/** The base address of the page the application runs in, ending in '/'. */
export function applicationBase(): string {
  const document = (globalThis as { document?: { baseURI?: string } }).document;
  return new URL('./', document?.baseURI ?? 'http://localhost/').href;
}

/** The controller of an application; created on first use. */
export function helpControllerOf(ctx: AppContext, fetchText?: FetchLike): HelpController {
  let controller = controllers.get(ctx);
  if (!controller) {
    const fetcher: FetchLike = fetchText ?? ((url) => (globalThis as unknown as { fetch: FetchLike }).fetch(url));
    controller = new HelpController(applicationBase(), fetcher);
    controllers.set(ctx, controller);
  }
  return controller;
}
