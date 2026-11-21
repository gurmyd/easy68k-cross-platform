import { describe, expect, it } from 'vitest';
import { galleryRequest } from './route';

describe('galleryRequest', () => {
  it('is null for the application', () => {
    expect(galleryRequest('')).toBeNull();
    expect(galleryRequest('?open=demo.X68')).toBeNull();
  });

  it('recognises ?gallery with an optional theme', () => {
    expect(galleryRequest('?gallery')).toEqual({ theme: 'system' });
    expect(galleryRequest('?gallery&theme=dark')).toEqual({ theme: 'dark' });
    expect(galleryRequest('?theme=light&gallery=1')).toEqual({ theme: 'light' });
    expect(galleryRequest('?gallery&theme=purple')).toEqual({ theme: 'system' });
  });
});
