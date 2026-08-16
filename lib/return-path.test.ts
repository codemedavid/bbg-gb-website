// Where a customer is sent after logging in.
//
// The value arrives in the URL, so it is attacker-controllable: a link like
// /login?next=https://evil.example lands someone on a page that has just asked
// them for a password. These tests pin the shape we accept — our own paths,
// nothing that can leave the site.
import { describe, it, expect } from 'vitest';
import { safeReturnPath, DEFAULT_AFTER_LOGIN } from './return-path';

describe('safeReturnPath', () => {
  it('keeps an in-app path so an emailed order link survives the login', () => {
    expect(safeReturnPath('/orders/8f1c2d3e')).toBe('/orders/8f1c2d3e');
  });

  it('keeps the query string of an in-app path', () => {
    expect(safeReturnPath('/orders?filter=shipped')).toBe('/orders?filter=shipped');
  });

  it('falls back to the home page when there is no next', () => {
    expect(safeReturnPath(undefined)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeReturnPath(null)).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeReturnPath('')).toBe(DEFAULT_AFTER_LOGIN);
  });

  // An absolute URL is the plain form of the attack.
  it('rejects an absolute URL to another origin', () => {
    expect(safeReturnPath('https://evil.example/phish')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeReturnPath('http://evil.example')).toBe(DEFAULT_AFTER_LOGIN);
  });

  // '//evil.example' is protocol-relative: the browser reads it as another host
  // even though it starts with a slash, which is why a bare startsWith('/')
  // check is not enough on its own.
  it('rejects a protocol-relative path', () => {
    expect(safeReturnPath('//evil.example')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeReturnPath('//evil.example/orders')).toBe(DEFAULT_AFTER_LOGIN);
  });

  // Some browsers normalise a backslash to a forward slash, making '/\' another
  // spelling of '//'.
  it('rejects a backslash-escaped host', () => {
    expect(safeReturnPath('/\\evil.example')).toBe(DEFAULT_AFTER_LOGIN);
  });

  it('rejects a javascript: URL', () => {
    expect(safeReturnPath('javascript:alert(1)')).toBe(DEFAULT_AFTER_LOGIN);
  });

  // A control character can split a header or hide the real target from a human
  // reading the link.
  it('rejects control characters', () => {
    expect(safeReturnPath('/orders\n/evil')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeReturnPath('/orders ')).toBe(DEFAULT_AFTER_LOGIN);
  });

  // Returning to /login after logging in shows the form to someone who has just
  // finished with it.
  it('rejects a return trip to the login screen', () => {
    expect(safeReturnPath('/login')).toBe(DEFAULT_AFTER_LOGIN);
    expect(safeReturnPath('/login?next=/orders')).toBe(DEFAULT_AFTER_LOGIN);
  });

  // '/loginsomething' is a different page and must not be caught by the guard above.
  it('does not reject a path that merely starts with the same letters', () => {
    expect(safeReturnPath('/login-help')).toBe('/login-help');
  });
});
