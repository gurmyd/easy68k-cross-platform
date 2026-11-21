// Showing a help page: in the desktop app's help window when the platform has one, else in the Help
// panel (a drawer in every mode). Owner: H1.

import type { AppContext } from '../../contracts';
import { ENTRY_PAGES, targetText, type HelpTarget } from '../../core/help';
import { showPanel } from '../../state/panels';
import { helpControllerOf } from './controller';

/**
 * Opens `page` (a path below the help folder, optionally with "#fragment"). `contents` says whether
 * the contents tree is shown beside the page: it is for the introduction, not for a page that a
 * keyword or a panel asked for.
 */
export function openHelp(ctx: AppContext, page: HelpTarget | string = ENTRY_PAGES.contents): void {
  const target = typeof page === 'string' ? page : targetText(page);
  if (ctx.platform.showHelp(target)) return;
  const controller = helpControllerOf(ctx);
  controller.show(target, { contentsOpen: target === ENTRY_PAGES.contents });
  showPanel(ctx, 'help');
}
