import { describe, expect, it } from 'vitest';
import {
  imageHeaderPlausible,
  isAllowedTextType,
  looksLikeText,
  mimeOf,
  sniffImage,
} from '../src/sniff.ts';
import { fileWith } from './helpers.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe('sniffImage', () => {
  it('recognises each allowed signature', () => {
    expect(sniffImage(fileWith([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffImage(fileWith([0x89, 0x50, 0x4e, 0x47]))).toBe('png');
    expect(sniffImage(fileWith(ascii('GIF89a')))).toBe('gif');
    expect(sniffImage(fileWith(ascii('GIF87a')))).toBe('gif');
    expect(sniffImage(fileWith([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBPVP8 ')]))).toBe('webp');
    expect(sniffImage(fileWith([0, 0, 0, 0x20, ...ascii('ftypavif')]))).toBe('avif');
    expect(sniffImage(fileWith([0, 0, 0, 0x20, ...ascii('ftypavis')]))).toBe('avif');
    expect(sniffImage(fileWith([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]))).toBe('ico');
    expect(sniffImage(fileWith([0x42, 0x4d, 0x36, 0, 0, 0, 0, 0, 0, 0]))).toBe('bmp');
  });

  it('does not mistake other RIFF or ISO-BMFF files for images', () => {
    expect(sniffImage(fileWith([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVEfmt ')]))).toBeNull();
    expect(sniffImage(fileWith([0, 0, 0, 0x20, ...ascii('ftypisom')]))).toBeNull();
    expect(sniffImage(enc('BMW is a car maker'))).toBeNull();
  });

  it('rejects HTML, JSON, PDF and empty input', () => {
    expect(sniffImage(enc('<!doctype html><html></html>'))).toBeNull();
    expect(sniffImage(enc('{"a":1}'))).toBeNull();
    expect(sniffImage(fileWith(ascii('%PDF-1.7')))).toBeNull();
    expect(sniffImage(new Uint8Array(0))).toBeNull();
  });

  describe('svg', () => {
    it.each([
      ['plain', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>'],
      ['leading whitespace', '\n  \t<svg width="1" height="1"/>'],
      ['xml declaration', '<?xml version="1.0" encoding="UTF-8"?>\n<svg width="1" height="1"/>'],
      ['comment first', '<!-- made by hand -->\n<svg width="1" height="1"/>'],
      [
        'xml, comment, doctype',
        '<?xml version="1.0"?><!-- c --><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg/>',
      ],
      ['upper case', '<SVG width="1"></SVG>'],
    ])('accepts %s', (_name, text) => {
      expect(sniffImage(enc(text))).toBe('svg');
    });

    it('accepts a UTF-8 BOM', () => {
      expect(sniffImage(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('<svg width="1"/>')]))).toBe(
        'svg',
      );
    });

    it.each([
      ['html page', '<!doctype html><html><body><svg></svg></body></html>'],
      ['svg after the first KB', `<!-- ${'x'.repeat(1100)} --><svg/>`],
      ['look-alike tag', '<svgfoo/>'],
      ['doctype with internal subset', '<!DOCTYPE svg [<!ENTITY a "b">]><svg/>'],
      ['unterminated comment', '<!-- never closed <svg/>'],
    ])('rejects %s', (_name, text) => {
      expect(sniffImage(enc(text))).toBeNull();
    });
  });
});

describe('content types', () => {
  it('allows exactly the documented text types, ignoring parameters and case', () => {
    for (const t of [
      'text/html',
      'text/html; charset=ISO-8859-1',
      'TEXT/HTML',
      'application/xhtml+xml',
      'text/xml',
      'application/xml',
      'application/rss+xml',
      'application/atom+xml',
      'application/rdf+xml',
      'application/json',
      'application/ld+json',
      'application/manifest+json',
      'application/json+oembed',
      'text/plain',
    ]) {
      expect(isAllowedTextType(t), t).toBe(true);
    }
    for (const t of [
      'image/png',
      'application/pdf',
      'application/octet-stream',
      'text/css',
      '',
      null,
    ]) {
      expect(isAllowedTextType(t), String(t)).toBe(false);
    }
  });

  it('extracts the bare mime type', () => {
    expect(mimeOf('Text/HTML; charset=utf-8')).toBe('text/html');
    expect(mimeOf(null)).toBe('');
  });

  it('sniffs untyped text by its first significant byte', () => {
    expect(looksLikeText(enc('  \n<html>'))).toBe(true);
    expect(looksLikeText(enc('{"name":"x"}'))).toBe(true);
    expect(looksLikeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('<rss/>')]))).toBe(true);
    expect(looksLikeText(enc('MZ binary'))).toBe(false);
    expect(looksLikeText(new Uint8Array(0))).toBe(false);
    expect(looksLikeText(enc('     '))).toBe(false);
  });

  it('accepts image headers, generic binary headers and missing headers for images', () => {
    for (const t of [
      'image/png',
      'image/jpg',
      'image/x-icon',
      'application/octet-stream',
      '',
      null,
    ]) {
      expect(imageHeaderPlausible(t), String(t)).toBe(true);
    }
    for (const t of ['text/html', 'application/json', 'text/plain']) {
      expect(imageHeaderPlausible(t), t).toBe(false);
    }
  });
});
