import type { Block } from '../core/types';

export function indentOf(raw: string): string {
  return raw.match(/^[ \t]*/)?.[0] ?? '';
}

/** Removes the block's own indentation, so `  build:` becomes `build:`. */
export function dedent(raw: string): string {
  const indent = indentOf(raw);
  return raw
    .split('\n')
    .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()))
    .join('\n');
}

/** Replaces the block's lines in the file with `edited`, indented as the block was. */
export function spliceBlock(file: string, block: Block, edited: string): string {
  const indent = indentOf(block.raw);
  const lines = file.split('\n');
  const body = edited
    .replace(/\s+$/, '')
    .split('\n')
    .map((l) => (l.trim() ? indent + l : ''));
  lines.splice(block.startLine - 1, block.endLine - block.startLine + 1, ...body);
  return lines.join('\n');
}
