// The toolbar of the current mode (ARCHITECTURE.md 2.1-2.3, 1.3.2, 1.3.5). Owner: W3.
//
// Buttons, separators and the simulator's LOGGING label come from
// app/src/commands/tables/toolbars.ts. Each button's accessible name is its hint with the
// platform's shortcut appended; a command without a handler is disabled. The theme button stands
// at the right end of the row in every mode.

import type { Mode } from '../../contracts';
import { MODE_CAPTIONS } from '../../commands/shell-commands';
import { IconButton, Toolbar, ToolbarSeparator, ToolbarSpacer, Tooltip, type IconName } from '../components';
import { ThemeButton } from './ThemeButton';
import { useResolvedToolbar, useRunCommand } from './use-commands';

export function ShellToolbar({ mode }: { mode: Mode }) {
  const items = useResolvedToolbar(mode);
  const run = useRunCommand();
  return (
    <Toolbar label={`${MODE_CAPTIONS[mode]} toolbar`} className="e68-shell__toolbar">
      {items.map((item, index) => {
        if (item.type === 'separator') return <ToolbarSeparator key={index} />;
        if (item.type === 'logging') {
          // Present from the start so that screen readers announce the change (2.11).
          return (
            <span key={index} role="status" className="e68-shell__logging">
              {item.visible && <span className="e68-toolbar__logging">LOGGING</span>}
            </span>
          );
        }
        const button = (
          <IconButton
            key={item.id}
            icon={item.icon as IconName}
            label={item.label}
            disabled={!item.enabled}
            tooltip={item.disabledReason === null}
            data-command={item.id}
            {...(item.pressed !== null ? { pressed: item.pressed } : {})}
            onClick={() => run(item.id)}
          />
        );
        // After a halt the run commands explain why they are disabled (1.4 note 22).
        return item.disabledReason === null ? (
          button
        ) : (
          <Tooltip key={item.id} text={item.disabledReason} describes>
            {button}
          </Tooltip>
        );
      })}
      <ToolbarSpacer />
      <ThemeButton />
    </Toolbar>
  );
}
