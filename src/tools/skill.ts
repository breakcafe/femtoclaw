import type { ToolDefinition } from '../types.js';

export const SkillTool: ToolDefinition = {
  name: 'Skill',
  description: `Execute a skill within the main conversation

When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.

When users reference a "slash command" or "/<something>" (e.g., "/commit", "/review-pr"), they are referring to a skill. Use this tool to invoke it.

How to invoke:
- Use this tool with the skill name and optional arguments
- Examples:
  - skill: "data-query"
  - skill: "web-research", args: "Azure Functions"
  - skill: "example"

Important:
- Available skills are listed in system-reminder messages in the conversation
- When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task
- NEVER mention a skill without actually calling this tool
- Do not invoke a skill that is already running
- If you see a <command-name> tag in the current conversation turn, the skill has ALREADY been loaded - follow the instructions directly instead of calling this tool again`,

  input_schema: {
    type: 'object',
    properties: {
      skill: {
        type: 'string',
        description: 'The skill name (from the available skills list)',
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

    // Also check aliases
    let skillDef = context.skillManager.getSkill(skillName, context.userId);
    if (!skillDef) {
      // Try finding by alias
      const allSkills = context.skillManager.getSkillManifest(context.userId);
      for (const s of allSkills) {
        const full = context.skillManager.getSkill(s.name, context.userId);
        if (full?.aliases?.includes(skillName)) {
          skillDef = full;
          break;
        }
      }
    }

    if (!skillDef) {
      return {
        type: 'error',
        error: `Skill "${skillName}" not found. Available skills: ${context.skillManager.listSkillNames().join(', ')}`,
      };
    }

    // Match Claude Code's output format: "Launching skill: {name}\n{content}"
    return {
      type: 'text',
      text: `Launching skill: ${skillDef.name}\n${skillDef.content}`,
    };
  },
};
