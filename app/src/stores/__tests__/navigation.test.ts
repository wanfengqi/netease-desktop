import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useNavigationStore } from '../navigation';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('navigation shell integration', () => {
  it('opens discover as a root route and clears child routes', () => {
    const nav = useNavigationStore();
    nav.push({ name: 'player' });
    nav.goNav('discover');

    expect(nav.current).toEqual({ name: 'discover' });
    expect(nav.activeNav).toBe('discover');
    expect(nav.canGoBack).toBe(false);
  });

  it('opens player as a child and returns to the originating root', () => {
    const nav = useNavigationStore();
    nav.goNav('search');
    nav.openPlayer();

    expect(nav.current).toEqual({ name: 'player' });
    expect(nav.activeNav).toBe('search');
    expect(nav.canGoBack).toBe(true);

    nav.back();
    expect(nav.current).toEqual({ name: 'search' });
    expect(nav.canGoBack).toBe(false);
  });
});
