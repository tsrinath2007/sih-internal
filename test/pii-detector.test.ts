import { describe, it, expect } from 'vitest';
import { detectDOMPII, luhnCheck } from '../extension/content/pii-detector-dom';
import { DOMSnapshot } from '../extension/content/dom-reader';

describe('PIIDetectorDOM Unit Tests', () => {
  it('correctly validates credit card numbers using Luhn checksum', () => {
    expect(luhnCheck('4532015012345671')).toBe(true);
    expect(luhnCheck('4532 0150 1234 5671')).toBe(true);
    expect(luhnCheck('4532015012345675')).toBe(false); // Invalid checksum (ends in 5 instead of 1)
  });

  it('detects all known PII on a sample signup form snapshot', () => {
    const fixtureSnapshot: DOMSnapshot = {
      url: 'http://localhost:3001/checkout-form.html',
      title: 'Checkout & Registration',
      timestamp: Date.now(),
      elements: [
        {
          id: 'field-name',
          tag: 'input',
          type: 'text',
          name: 'fullname',
          autocomplete: 'name',
          placeholder: 'Full Name',
          text: 'Ankita Sharma',
          value: 'Ankita Sharma',
          selector: '#field-name',
          bbox: { x: 100, y: 150, width: 220, height: 35 },
          isInteractive: true
        },
        {
          id: 'field-email',
          tag: 'input',
          type: 'email',
          name: 'email',
          autocomplete: 'email',
          placeholder: 'Email Address',
          text: 'ankita@gmail.com',
          value: 'ankita@gmail.com',
          selector: '#field-email',
          bbox: { x: 100, y: 200, width: 220, height: 35 },
          isInteractive: true
        },
        {
          id: 'field-phone',
          tag: 'input',
          type: 'tel',
          name: 'phone',
          autocomplete: 'tel',
          placeholder: 'Mobile Number',
          text: '+91 98765 43210',
          value: '+91 98765 43210',
          selector: '#field-phone',
          bbox: { x: 100, y: 250, width: 220, height: 35 },
          isInteractive: true
        },
        {
          id: 'field-card',
          tag: 'input',
          type: 'text',
          name: 'ccnumber',
          autocomplete: 'cc-number',
          placeholder: 'Card Number',
          text: '4532 0150 1234 5671',
          value: '4532 0150 1234 5671',
          selector: '#field-card',
          bbox: { x: 100, y: 300, width: 220, height: 35 },
          isInteractive: true
        },
        {
          id: 'btn-submit',
          tag: 'button',
          text: 'Submit Order',
          selector: '#btn-submit',
          bbox: { x: 100, y: 360, width: 140, height: 40 },
          isInteractive: true
        }
      ]
    };

    const detections = detectDOMPII(fixtureSnapshot);

    expect(detections.length).toBe(4);

    const types = detections.map(d => d.type);
    expect(types).toContain('NAME');
    expect(types).toContain('EMAIL');
    expect(types).toContain('PHONE');
    expect(types).toContain('CARD');

    const emailDetection = detections.find(d => d.type === 'EMAIL');
    expect(emailDetection?.originalValue).toBe('ankita@gmail.com');
    expect(emailDetection?.surrogateValue).toContain('@example.com');

    const cardDetection = detections.find(d => d.type === 'CARD');
    expect(cardDetection?.originalValue).toBe('4532 0150 1234 5671');
    expect(cardDetection?.surrogateValue).toBe('**** **** **** 1234');
  });

  it('detects AVATAR and text PII correctly in PIIDetector core engine', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    const sampleWords = [
      { text: '[PHOTO_AVATAR]', isAvatar: true, confidence: 99, bbox: { x: 50, y: 50, width: 64, height: 64 } },
      { text: 'Google', confidence: 95, bbox: { x: 120, y: 50, width: 45, height: 16 } },
      { text: 'Account:', confidence: 95, bbox: { x: 170, y: 50, width: 55, height: 16 } },
      { text: 'john.doe@gmail.com', confidence: 98, bbox: { x: 230, y: 50, width: 140, height: 16 } },
      { text: 'Copyright', confidence: 95, bbox: { x: 50, y: 150, width: 60, height: 16 } },
      { text: '2026', confidence: 95, bbox: { x: 115, y: 150, width: 35, height: 16 } },
      { text: 'Call', confidence: 95, bbox: { x: 50, y: 200, width: 30, height: 16 } },
      { text: '+91', confidence: 95, bbox: { x: 85, y: 200, width: 25, height: 16 } },
      { text: '9876543210', confidence: 98, bbox: { x: 115, y: 200, width: 80, height: 16 } }
    ];

    const result = PIIDetector.detectPII(sampleWords);

    expect(result.matches.length).toBe(3);
    const types = result.matches.map((m: any) => m.type);
    expect(types).toContain('AVATAR');
    expect(types).toContain('EMAIL');
    expect(types).toContain('PHONE');
    expect(types).not.toContain('OTP'); // 2026 should NOT be flagged as OTP

    const avatarMatch = result.matches.find((m: any) => m.type === 'AVATAR');
    expect(avatarMatch?.bbox).toEqual({ x: 50, y: 50, width: 64, height: 64 });

    const emailMatch = result.matches.find((m: any) => m.type === 'EMAIL');
    expect(emailMatch?.matchedText).toBe('john.doe@gmail.com');
  });

  it('refines large photo bounding boxes to pinpoint the face region', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    const matches = [
      {
        type: 'AVATAR',
        bbox: { x: 100, y: 100, width: 600, height: 450 },
        confidence: 98.0
      }
    ];

    const dummyImg = { width: 1280, height: 800 };
    const refined = PIIDetector.refineFaceBoundingBoxes(matches, dummyImg, 1280, 800);

    expect(refined.length).toBe(1);
    // Face bbox should be much smaller than the 600x450 photo container
    expect(refined[0].bbox.width).toBeLessThan(600);
    expect(refined[0].bbox.height).toBeLessThan(450);
  });

  it('detects Unicode small-caps, superscript, and subscript obfuscated PII', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PIIDetector = require('../pii-detector');

    // Test unwrapper
    expect(PIIDetector.unwrapUnicodeSmallText('ᵗˢʳᶦⁿᵃᵗʰ@ᵗᵒᵐᵃᵗᵒ.ᶜᵒᵐ')).toBe('tsrinath@tomato.com');
    expect(PIIDetector.unwrapUnicodeSmallText('ᴛsʀɪɴᴀᴛʜ@ᴛᴏᵐᴀᴛᴏ.ᴄᴏᴍ')).toBe('tsrinath@tomato.com');
    expect(PIIDetector.unwrapUnicodeSmallText('⁺⁹¹ ⁹⁸⁷⁶⁵ ⁴³²¹⁰')).toBe('+91 98765 43210');

    // Test detector on stylized words
    const stylizedWords = [
      { text: 'Email:', confidence: 95, bbox: { x: 50, y: 50, width: 50, height: 16 } },
      { text: 'ᵗˢʳᶦⁿᵃᵗʰ@ᵗᵒᵐᵃᵗᵒ.ᶜᵒᵐ', confidence: 98, bbox: { x: 110, y: 50, width: 120, height: 16 } },
      { text: 'Phone:', confidence: 95, bbox: { x: 50, y: 100, width: 50, height: 16 } },
      { text: '⁺⁹¹', confidence: 95, bbox: { x: 110, y: 100, width: 25, height: 16 } },
      { text: '⁹⁸⁷⁶⁵⁴³²¹⁰', confidence: 98, bbox: { x: 140, y: 100, width: 80, height: 16 } }
    ];

    const result = PIIDetector.detectPII(stylizedWords);
    expect(result.matches.length).toBe(2);

    const emailMatch = result.matches.find((m: any) => m.type === 'EMAIL');
    expect(emailMatch).toBeDefined();

    const phoneMatch = result.matches.find((m: any) => m.type === 'PHONE');
    expect(phoneMatch).toBeDefined();
  });
});


