import type { ToolDefinition } from '../types.js';

export const SkillTool: ToolDefinition = {
  name: 'Skill',
  description:
    'Load the full instructions of a specified skill. Call this when the user\'s request matches a known skill from the available skills list.',
  input_schema: {
    type: 'object',
    properties: {
      skill: {
        type: 'string',
        description: 'Skill name (from the available skills list)',
      },
      args: {
        type: 'string',
        description: 'Optional arguments for the skill',
      },
    },
    required: ['skill'],
  },

  async execute(input, context) {
    const skillName = input.skill as string;
    const skillDef = context.skillManager.getSkill(skillName, context.userId);

    if (!skillDef) {
      return {
        type: 'error',
        error: `Skill "${skillName}" not found. Available skills: ${context.skillManager.listSkillNames().join(', ')}`,
      };
    }

    return {
      type: 'text',
      text: skillDef.content,
    };
  },
};
