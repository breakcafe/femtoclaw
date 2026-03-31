import type { SkillDefinition, SkillManifestEntry, SkillManagerInterface } from '../types.js';
import { loadSkillsFromDirectory } from './loader.js';
import { logger } from '../utils/logger.js';

export class SkillManager implements SkillManagerInterface {
  private skills = new Map<string, SkillDefinition>();
  private builtinDir: string;
  private orgSkillsDir?: string;
  private userSkillsDir?: string;

  constructor(builtinDir: string, orgSkillsDir?: string, userSkillsDir?: string) {
    this.builtinDir = builtinDir;
    this.orgSkillsDir = orgSkillsDir;
    this.userSkillsDir = userSkillsDir;
  }

  /**
   * Load and merge skills from all tiers.
   * Priority: org > builtin > user (additive only)
   */
  async loadSkills(): Promise<void> {
    this.skills.clear();

    // 1. Load built-in skills (base layer)
    const builtinSkills = loadSkillsFromDirectory(this.builtinDir, 'builtin');
    for (const skill of builtinSkills) {
      this.skills.set(skill.name, skill);
    }

    // 2. Load org skills (can override built-in)
    if (this.orgSkillsDir) {
      const orgSkills = loadSkillsFromDirectory(this.orgSkillsDir, 'org');
      for (const skill of orgSkills) {
        this.skills.set(skill.name, skill);
      }
    }

    // 3. Load user skills (additive only — cannot override org or builtin)
    if (this.userSkillsDir) {
      const userSkills = loadSkillsFromDirectory(this.userSkillsDir, 'user');
      for (const skill of userSkills) {
        if (!this.skills.has(skill.name)) {
          this.skills.set(skill.name, skill);
        } else {
          logger.debug(
            { name: skill.name },
            'User skill skipped (same name exists in org/builtin)',
          );
        }
      }
    }

    logger.info(
      {
        total: this.skills.size,
        builtin: builtinSkills.length,
        org: this.orgSkillsDir ? 'configured' : 'none',
        user: this.userSkillsDir ? 'configured' : 'none',
      },
      'Skills loaded',
    );
  }

  getSkill(name: string, _userId?: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  getSkillManifest(_userId?: string): SkillManifestEntry[] {
    return Array.from(this.skills.values()).map((s) => ({
      name: s.name,
      description: s.description,
      whenToUse: s.whenToUse,
      triggers: s.triggers,
      safetyWarnings: s.safetyWarnings,
    }));
  }

  listSkillNames(): string[] {
    return Array.from(this.skills.keys());
  }
}
