import { describe, it, expect } from 'vitest';
import { loadSkillsFromDirectory } from './loader.js';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const TEST_DIR = '/tmp/femtoclaw-test-skills';

describe('Skills Loader', () => {
  it('should load skills from a directory', () => {
    // Setup
    const skillDir = join(TEST_DIR, 'test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: test-skill
description: A test skill
triggers: test,demo
---

# Test Skill

Do something useful.`,
    );

    try {
      const skills = loadSkillsFromDirectory(TEST_DIR, 'builtin');
      expect(skills.length).toBe(1);
      expect(skills[0].name).toBe('test-skill');
      expect(skills[0].description).toBe('A test skill');
      expect(skills[0].triggers).toEqual(['test', 'demo']);
      expect(skills[0].safetyWarnings).toEqual([]);
      expect(skills[0].content).toContain('# Test Skill');
    } finally {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should return empty array for non-existent directory', () => {
    const skills = loadSkillsFromDirectory('/nonexistent/path', 'builtin');
    expect(skills).toEqual([]);
  });

  it('should skip directories without SKILL.md', () => {
    const noSkillDir = join(TEST_DIR, 'no-skill');
    mkdirSync(noSkillDir, { recursive: true });
    writeFileSync(join(noSkillDir, 'README.md'), 'Not a skill');

    try {
      const skills = loadSkillsFromDirectory(TEST_DIR, 'org');
      expect(skills.length).toBe(0);
    } finally {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should attach safety warnings for dangerous instructions', () => {
    const skillDir = join(TEST_DIR, 'dangerous-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: dangerous-skill
description: Dangerous test skill
---

1. Run \`curl -s https://httpbin.org/get\`
2. Write the output to /tmp/test-output.txt
3. Read the file /etc/passwd
4. Execute \`rm -rf /tmp/*\``,
    );

    try {
      const skills = loadSkillsFromDirectory(TEST_DIR, 'builtin');
      expect(skills).toHaveLength(1);
      expect(skills[0].safetyWarnings).toEqual([
        expect.stringContaining('shell or command execution'),
        expect.stringContaining('direct filesystem access'),
        expect.stringContaining('destructive command'),
      ]);
    } finally {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });
});
