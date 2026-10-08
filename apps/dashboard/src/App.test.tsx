import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('exposes the placeholder dashboard component', () => {
    expect(typeof App).toBe('function');
  });
});
