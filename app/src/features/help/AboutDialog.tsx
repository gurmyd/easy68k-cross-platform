// The two About boxes (dialog ids `about.editor` and `about.sim`). Owner: H1.
// ARCHITECTURE.md 1.4 note 11; editor-ui §15.4; sim-ui §16.2.
//
// The original's texts, letter for letter; below them the port's name, version, repository link and
// the statement that it is unofficial. The editor's box has the original's `Check for update?` and
// `Check` button; here it asks the port's latest GitHub release (the one network request the
// application makes, and only when the button is pressed). The B-M-W Easter egg is dropped.

import { useRef, useState } from 'react';
import type { DialogProps } from '../../contracts';
import {
  CHECK_BUTTON,
  CHECK_LABEL,
  CHECK_NETWORK_ERROR,
  CHECK_UPDATE_AVAILABLE,
  CHECK_UP_TO_DATE,
  DEFAULT_REPOSITORY,
  EDITOR_ABOUT,
  PORT_NAME,
  PORT_STATEMENT,
  PORT_SUBTITLE,
  SIMULATOR_ABOUT,
  latestReleaseUrl,
  portVersionFromTitle,
  repositoryUrl,
  updateAnswer,
  type AboutText,
} from '../../core/help';
import { useAppContext } from '../../state/context';
import { Button, Dialog } from '../../ui/components';
import './about.css';

/** Asks GitHub for the latest release tag of the port; the text of the answer the original shows. */
export async function checkForUpdate(
  installed: string,
  fetchJson: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>,
  repository: string = DEFAULT_REPOSITORY,
): Promise<string> {
  try {
    const response = await fetchJson(latestReleaseUrl(repository));
    if (!response.ok) return CHECK_NETWORK_ERROR;
    const release = (await response.json()) as { tag_name?: unknown };
    if (typeof release.tag_name !== 'string') return CHECK_NETWORK_ERROR;
    // The original compares the whole text: equal is up to date, anything else is an update.
    return (
      updateAnswer(installed, release.tag_name) ??
      (release.tag_name === installed ? CHECK_UP_TO_DATE : CHECK_UPDATE_AVAILABLE)
    );
  } catch {
    return CHECK_NETWORK_ERROR;
  }
}

function AboutBox({
  about,
  withCheck,
  close,
}: {
  about: AboutText;
  withCheck: boolean;
  close(result: undefined): void;
}) {
  const ctx = useAppContext();
  const version = ctx.build?.version ?? portVersionFromTitle(globalThis.document?.title ?? '');
  const repository = ctx.build?.repository ?? DEFAULT_REPOSITORY;
  const [answer, setAnswer] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const okButton = useRef<HTMLButtonElement>(null);

  const check = async () => {
    setChecking(true);
    setAnswer(
      await checkForUpdate(
        version,
        (url) => fetch(url, { headers: { Accept: 'application/vnd.github+json' } }),
        repository,
      ),
    );
    setChecking(false);
  };

  const openLink = (url: string) => ctx.platform.openExternal(url);

  return (
    <Dialog
      title={about.windowTitle}
      width={480}
      onCancel={() => close(undefined)}
      initialFocus={okButton}
      footer={
        <>
          {withCheck && (
            <span className="e68-about__check">
              <span id="e68-about-check-label">{CHECK_LABEL}</span>
              <Button
                caption={CHECK_BUTTON}
                disabled={checking}
                aria-describedby="e68-about-check-label"
                onClick={() => void check()}
              />
              <span role="status" className="e68-about__answer">
                {answer ?? ''}
              </span>
            </span>
          )}
          <Button ref={okButton} caption="OK" isDefault onClick={() => close(undefined)} />
        </>
      }
    >
      <div className="e68-about">
        <p className="e68-about__title">{about.title}</p>
        {about.lines.map((line) =>
          line.kind === 'link' ? (
            <p key={line.text} className="e68-about__line">
              <a
                href={line.url}
                className="e68-about__link"
                onClick={(event) => {
                  event.preventDefault();
                  openLink(line.url);
                }}
              >
                {line.text}
              </a>
            </p>
          ) : (
            <p key={line.text} className="e68-about__line">
              {line.text}
            </p>
          ),
        )}
        <hr className="e68-about__rule" />
        <p className="e68-about__port">
          {PORT_NAME} <span className="e68-about__subtitle">{PORT_SUBTITLE}</span> {version}
        </p>
        <p className="e68-about__line">{PORT_STATEMENT}</p>
        <p className="e68-about__line">
          <a
            href={repositoryUrl(repository)}
            className="e68-about__link"
            onClick={(event) => {
              event.preventDefault();
              openLink(repositoryUrl(repository));
            }}
          >
            github.com/{repository}
          </a>
        </p>
      </div>
    </Dialog>
  );
}

export function EditorAboutDialog({ close }: DialogProps<Record<string, never>, undefined>) {
  return <AboutBox about={EDITOR_ABOUT} withCheck close={close} />;
}

export function SimulatorAboutDialog({ close }: DialogProps<Record<string, never>, undefined>) {
  return <AboutBox about={SIMULATOR_ABOUT} withCheck={false} close={close} />;
}
