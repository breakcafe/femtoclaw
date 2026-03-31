import { describe, it, expect } from 'vitest';
import { renderTemplate } from './template.js';

describe('renderTemplate', () => {
  it('should replace template variables', () => {
    const result = renderTemplate('Hello {{name}}!', { name: 'World' });
    expect(result).toBe('Hello World!');
  });

  it('should replace multiple variables', () => {
    const result = renderTemplate('{{greeting}} {{name}}', {
      greeting: 'Hi',
      name: 'User',
    });
    expect(result).toBe('Hi User');
  });

  it('should replace undefined variables with empty string', () => {
    const result = renderTemplate('Hello {{name}}!', {});
    expect(result).toBe('Hello !');
  });

  it('should handle no variables', () => {
    const result = renderTemplate('No variables here', {});
    expect(result).toBe('No variables here');
  });
});
