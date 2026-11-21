#!/usr/bin/env node
// L3 of the test strategy (ARCHITECTURE.md 6.1, 6.2.4): a second opinion on the assembler's logic.
//
//     node tests/oracle/asm-cli/run.mjs [--no-build] [--only text]
//
// Builds `asy68k.exe`, the command-line port of the EASy68K assembler v5.15.4, with MSVC
// (tools/build-asm-oracle.ps1, docs/porting/toolchain.md section 4) and assembles the tracked
// example sets (tests/corpus/official, tests/corpus/github) with it and with the port's WebAssembly
// assembler: the same text (the editor's load of the file), the same options, both option sets of
// the corpus. The two must agree except for the documented differences between the command-line
// port and v5.16.1 (classify.ts). A difference no class explains fails the run.
//
// Windows with MSVC only (the CI job `windows-oracles` calls it); elsewhere it says so and exits 0.
// The sources of the command-line port are not in the repository: when
// reference/easy68k-asm-cli/ is missing, they are cloned from GitHub at the pinned commit.
// Needs engine/dist. Writes build/reports/asm-cli-vs-port.json.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalListing, canonicalSRecord, editorLoad } from '../../conformance/asm/compare.ts';
import { REPO, SET_DIRECTORIES, readProgram } from '../../corpus/index.ts';
import { planPrograms } from '../wine/asm/regenerate.mjs';
import { CORPUS_OPTION_SETS } from '../wine/asm/settings.ts';
import { classify } from './classify.ts';

const CLI_REPOSITORY = 'https://github.com/rayarachelian/EASy68K-asm';
const CLI_COMMIT = '7102f270282266d6c9d29b80ff5a98182c3cedff';
const CLI_SOURCES = join(REPO, 'reference', 'easy68k-asm-cli');
const CLI_EXE = join(REPO, 'build', 'oracle', 'asm-cli-5.15.4', 'bin', 'asy68k.exe');
const WORK = join(REPO, 'build', 'oracle', 'asm-cli-run');
const REPORT = join(REPO, 'build', 'reports', 'asm-cli-vs-port.json');
/** The switches of asy68k.exe for the options that are off by default (toolchain §4). */
const CLI_SWITCHES = { macrosExpanded: '--macroexpand', structuredExpanded: '--structureexpan', constantsExpanded: '--expandconstants' };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error) throw new Error(`${command} could not be started: ${result.error.message}`);
  return result;
}

/** The sources of the command-line port at the pinned commit, cloned when they are not there. */
function ensureCliSources() {
  if (existsSync(join(CLI_SOURCES, 'ASM68Kv5.15.4', 'ASSEMBLE.CPP'))) return;
  console.log(`cloning ${CLI_REPOSITORY} at ${CLI_COMMIT} into reference/easy68k-asm-cli`);
  mkdirSync(CLI_SOURCES, { recursive: true });
  const git = (...args) => {
    // Bytes as committed: the build checks the sources against the patch.
    const result = run('git', ['-c', 'core.autocrlf=false', '-C', CLI_SOURCES, ...args], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`git ${args[0]} failed`);
  };
  git('init', '--quiet');
  git('fetch', '--quiet', '--depth', '1', CLI_REPOSITORY, CLI_COMMIT);
  git('checkout', '--quiet', 'FETCH_HEAD');
}

function buildCli() {
  const result = run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(REPO, 'tools', 'build-asm-oracle.ps1')], {
    stdio: 'inherit',
  });
  if (result.status !== 0 || !existsSync(CLI_EXE)) throw new Error('tools/build-asm-oracle.ps1 did not produce asy68k.exe');
}

/** Assembles `mainName` of the folder `directory` with asy68k.exe; returns the two outputs or nulls. */
function assembleWithCli(directory, mainName, options) {
  const folder = join(directory, ...dirname(mainName).split('/'));
  const name = mainName.split('/').pop();
  const stem = name.replace(/\.[^.]*$/, '');
  for (const extension of ['.L68', '.S68']) rmSync(join(folder, stem + extension), { force: true });
  const switches = Object.entries(CLI_SWITCHES).flatMap(([option, flag]) => (options[option] ? [flag] : []));
  // In the source's folder, like the editor, so that INCLUDE finds its files. The exit status
  // says nothing (it is 1 after a normal run).
  run(CLI_EXE, [...switches, name], { cwd: folder, timeout: 600_000 });
  const read = (extension) => {
    const path = join(folder, stem + extension);
    return existsSync(path) ? new Uint8Array(readFileSync(path)) : null;
  };
  return { listing: read('.L68'), sRecord: read('.S68') };
}

async function main() {
  const argv = process.argv.slice(2);
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  if (process.platform !== 'win32') {
    console.log('tests/oracle/asm-cli/run.mjs: the command-line oracle is built with MSVC; nothing to do on this system.');
    return 0;
  }
  const engine = join(REPO, 'engine', 'dist', 'asm68k.wasm');
  if (!existsSync(engine)) {
    const required = process.env.EASY68K_REQUIRE_ENGINES === '1';
    console.log(`engine/dist/asm68k.wasm is missing (npm run build:engines)${required ? '' : ': skipped'}`);
    return required ? 1 : 0;
  }
  if (!argv.includes('--no-build') || !existsSync(CLI_EXE)) {
    ensureCliSources();
    buildCli();
  }
  const { assemble } = await import(pathToFileURL(join(REPO, 'engine', 'asm', 'asm68k.mjs')).href);

  rmSync(WORK, { recursive: true, force: true });
  const programs = planPrograms(['official', 'github-mit']).filter((program) => !only || program.id.includes(only));
  const results = [];
  for (const program of programs) {
    const { mainName, files } = readProgram(program);
    const load = editorLoad(files.get(mainName));
    // The command-line port has no editor: it gets the text the editor would hand over.
    files.set(mainName, load.text);
    const directory = join(WORK, ...program.id.split('/'));
    cpSync(join(REPO, SET_DIRECTORIES[program.set], ...program.root.split('/').filter(Boolean)), directory, { recursive: true });
    writeFileSync(join(directory, ...mainName.split('/')), load.text);
    const sources = [...files.entries()].filter(([name]) => /\.x68$/i.test(name)).map(([, bytes]) => Buffer.from(bytes).toString('latin1'));
    for (const [label, options] of Object.entries(CORPUS_OPTION_SETS)) {
      const cli = assembleWithCli(directory, mainName, options);
      // The command-line port always lists with Assembly tabs (assembler §8.2).
      const ours = await assemble(mainName, files, { ...options, tabType: 'assembly' }, new Date(2026, 10, 20, 12, 0, 0));
      const verdict = classify(cli, { listing: ours.listing, sRecord: ours.sRecord }, sources, { canonicalListing, canonicalSRecord });
      results.push({ id: program.id, label, ...verdict });
      if (verdict.verdict === 'unexplained') console.log(`UNEXPLAINED ${program.id} (${label})\n${verdict.detail}`);
    }
  }

  const count = (verdict) => results.filter((result) => result.verdict === verdict).length;
  const byClass = {};
  for (const result of results) for (const name of result.classes) byClass[name] = (byClass[name] ?? 0) + 1;
  const summary = { runs: results.length, identical: count('identical'), explained: count('explained'), unexplained: count('unexplained'), byClass };
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify({ summary, runs: results }, null, 1)}\n`);
  console.log(
    `${summary.runs} runs, command-line port v5.15.4 against the port: ${summary.identical} identical, ` +
      `${summary.explained} with documented differences ${JSON.stringify(byClass)}, ${summary.unexplained} unexplained`,
  );
  return summary.unexplained === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(
    (status) => process.exit(status),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
