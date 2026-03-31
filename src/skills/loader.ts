import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { SkillDefinition } from '../types.js';
import { logger } from '../utils/logger.js';

/**
 * Parse YAML-like frontmatter from SKILL.md content.
 */
function parseFrontmatter(content: string): {
  metadata: Record<string, string>;
  body: string;
} {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    return { metadata: {}, body: content };
  }

  const metadata: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      metadata[key] = value;
    }
  }

  return { metadata, body: match[2] };
}

/**
 * Load all skills from a directory.
 * Each subdirectory should contain a SKILL.md file.
 */
export function loadSkillsFromDirectory(
  dirPath: string,
  source: SkillDefinition['source'],
): SkillDefinition[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  const skills: SkillDefinition[] = [];

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = join(dirPath, entry.name, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;

      try {
        const raw = readFileSync(skillMdPath, 'utf-8');
        const { metadata, body } = parseFrontmatter(raw);

        const name = metadata.name ?? entry.name;
        const description = metadata.description ?? '';
        const whenToUse = metadata.whenToUse ?? metadata.when_to_use ?? undefined;
        const argumentHint = metadata.argumentHint ?? metadata.argument_hint ?? undefined;
        const aliases = metadata.aliases
          ? metadata.aliases
              .replace(/[\[\]]/g, '')
              .split(',')
              .map((a) => a.trim())
              .filter(Boolean)
          : undefined;
        const triggers = metadata.triggers
          ? metadata.triggers
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [];

        skills.push({
          name,
          description,
          whenToUse,
          argumentHint,
          aliases,
          triggers,
          content: raw,
          source,
        });

        logger.debug({ name, source }, 'Loaded skill');
      } catch (err) {
        logger.warn({ err, path: skillMdPath }, 'Failed to load skill');
      }
    }
  } catch (err) {
    logger.warn({ err, dirPath }, 'Failed to read skills directory');
  }

  return skills;
}
