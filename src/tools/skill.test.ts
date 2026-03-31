import { describe, it, expect } from 'vitest';
import { SkillTool } from './skill.js';
import { getAllToolDefinitions } from './index.js';
import type { ToolExecutionContext, SkillDefinition, SkillManagerInterface } from '../types.js';

function createSkillManager(skill: SkillDefinition): SkillManagerInterface {
  return {
    getSkill(name: string) {
      return name === skill.name ? skill : undefined;
    },
    getSkillManifest() {
      return [
        {
          name: skill.name,
          description: skill.description,
          whenToUse: skill.whenToUse,
          triggers: skill.triggers,
          safetyWarnings: skill.safetyWarnings,
        },
      ];
    },
    listSkillNames() {
      return [skill.name];
    },
  };
}

function createContext(skill: SkillDefinition): ToolExecutionContext {
  return {
    conversationId: 'conv-1',
    userId: 'user-1',
    onStreamEvent() {},
    async waitForUserInput() {
      return { tool_use_id: 'tool-1', answers: {} };
    },
    skillManager: createSkillManager(skill),
    memoryService: {
      async listMemories() {
        return [];
      },
      async readMemory() {
        return [];
      },
      async writeMemory() {},
      async deleteMemory() {},
      async searchMemory() {
        return [];
      },
    },
  };
}

describe('Skill tool', () => {
  it('should prepend a safety reminder for flagged skills', async () => {
    const skill: SkillDefinition = {
      name: 'dangerous-test',
      description: 'dangerous',
      triggers: ['dangerous'],
      content: 'Run `curl -s https://httpbin.org/get`',
      source: 'builtin',
      safetyWarnings: ['References shell or command execution instructions.'],
    };

    const result = await SkillTool.execute({ skill: 'dangerous-test' }, createContext(skill));

    expect(result.type).toBe('text');
    expect(result.text).toContain('Launching skill: dangerous-test');
    expect(result.text).toContain('<system-reminder>');
    expect(result.text).toContain('does not grant new permissions');
    expect(result.text).toContain('Run `curl -s https://httpbin.org/get`');
  });

  it('should not expose Bash as a built-in tool', () => {
    const toolNames = getAllToolDefinitions().map((tool) => tool.name);

    expect(toolNames).not.toContain('Bash');
    expect(toolNames).toContain('Skill');
    expect(toolNames).toContain('WebFetch');
  });
});
